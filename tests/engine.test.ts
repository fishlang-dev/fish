import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CompileError } from "../src/diag.ts";
import { JS_NATIVE } from "../src/js_native.ts";
import { buildAsync, compile, ENGINE, ENGINE_SOURCES } from "../src/main.ts";
import { allowEngineHook } from "../src/modules.ts";
import { NATIVE } from "../src/native.ts";

const dir = mkdtempSync(join(tmpdir(), "fish-engine-"));
beforeAll(() => allowEngineHook(true));
afterAll(() => {
  allowEngineHook(false);
  rmSync(dir, { recursive: true, force: true });
});

// The vendored engine on its own, as clang builds it into a program that calls it.
test("the vendored engine evaluates JS", () => {
  const main = join(dir, "main.c");
  writeFileSync(main, `#include "quickjs.h"
#include <stdio.h>
int main(void) {
  JSRuntime *rt = JS_NewRuntime();
  JSContext *cx = JS_NewContext(rt);
  JSValue v = JS_Eval(cx, "[1, 2, 3].map((x) => x * 2).join(',')", 36, "<test>", JS_EVAL_TYPE_GLOBAL);
  const char *s = JS_ToCString(cx, v);
  puts(s);
  JS_FreeCString(cx, s);
  JS_FreeValue(cx, v);
  JS_FreeContext(cx);
  JS_FreeRuntime(rt);
}
`);
  const out = join(dir, "main");
  const built = Bun.spawnSync(["clang", "-I", ENGINE, main, ...ENGINE_SOURCES, "-lm", "-pthread", "-o", out]);
  expect(built.exitCode).toBe(0);
  expect(Bun.spawnSync([out]).stdout.toString()).toBe("2,4,6\n");
});

const HANDLES = `import { evaluate } from "fish:engine";

function keep(v: JsValue): JsValue {
  const copy = v;
  return copy;
}

async function hold(v: JsValue): Promise<i64> {
  const mine = v;
  return 1;
}

async function main() {
  const v = evaluate("export default [1, 2, 3].map((x) => x * 2);");
  const w = keep(v.clone());
  const all = [v, w, evaluate("export default { a: 1 }")];
  const one = spawn(hold(all[0].clone()));
  const two = spawn(hold(all[2].clone()));
  const n = await one;
  const m = await two;
  console.log(n + m);
  const awaited = evaluate("const x = await Promise.resolve(41); export default x + 1;");
  console.log("done");
}
`;

// Handles copied, held by tasks on other threads and dropped, with the runtime, the engine and the
// program all under AddressSanitizer, and every box freed.
test("JS handles are counted, sent and freed", () => {
  const file = join(dir, "handles.fsh");
  writeFileSync(file, HANDLES);
  // ASan instruments only IR functions marked for it, and crashes on the empty struct accesses
  // the IR makes, which touch nothing.
  const ir = compile(HANDLES, file)
    .replaceAll(" uwtable ", " uwtable sanitize_address ")
    .replace(/^( *%[^ ]+) = load \{\}, ptr .*$/gm, "$1 = select i1 true, {} zeroinitializer, {} zeroinitializer")
    .replace(/^ *store \{\} .*$/gm, "");
  const [ll, c, out] = [join(dir, "handles.ll"), join(dir, "handles.c"), join(dir, "handles")];
  writeFileSync(ll, ir);
  writeFileSync(c, `${NATIVE}\n${JS_NATIVE}`);
  const built = Bun.spawnSync(["clang", "-w", "-g", "-funwind-tables", "-fsanitize=address", "-x", "ir", ll, "-x", "c", c, "-I", ENGINE, ...ENGINE_SOURCES, "-o", out, "-lm", "-pthread"]);
  expect(built.stderr.toString()).toBe("");
  const run = Bun.spawnSync([out], { env: { ...process.env, FISH_LEAKS: "1" } });
  expect(run.stderr.toString()).toBe("");
  expect(run.stdout.toString()).toBe("2\ndone\n");
  expect(run.exitCode).toBe(0);
});

// A throw while a module runs, or one that never parses, rejects or never settles, is a panic.
test.each([
  ["throw new TypeError('boom');", "TypeError: boom"],
  ["export default (;", "SyntaxError: unexpected token in expression: ';'"],
  ["export default await Promise.reject(new Error('later'));", "Error: later"],
  ["export default await new Promise(() => {});", "InternalError: the module awaits something that never settles"],
])("a module that fails panics: %s", async (source, reason) => {
  const file = join(dir, `fails-${Bun.hash(source)}.fsh`);
  writeFileSync(file, `import { evaluate } from "fish:engine";\nfunction main() {\n  console.log("before");\n  const v = evaluate(${JSON.stringify(source)});\n}\n`);
  await buildAsync(file, `${file}.out`);
  const run = Bun.spawnSync([`${file}.out`], { env: { ...process.env, FISH_LEAKS: "1" } });
  expect(run.stdout.toString()).toBe("before\n");
  expect(run.stderr.toString()).toBe(`panicked at fish:engine:3:10:\nuncaught exception in JS: ${reason}\n`);
  expect(run.exitCode).toBe(101);
});

test("a program can't import the test hook", () => {
  const [file, src] = [join(dir, "hook.fsh"), `import { evaluate } from "fish:engine";\nfunction main() {}\n`];
  writeFileSync(file, src);
  allowEngineHook(false);
  try {
    expect(() => compile(src, file)).toThrow(
      new CompileError("'fish:engine' is the compiler's own test hook, which a program can't import; JS runs only as a package's code", 0, 0),
    );
  } finally {
    allowEngineHook(true);
  }
});

test("a program with no JS doesn't build the engine in", () => {
  const [file, src] = [join(dir, "plain.fsh"), "function main() { console.log(1); }\n"];
  writeFileSync(file, src);
  expect(/call [^\n]*@fsh_rt_js_/.test(compile(src, file))).toBe(false);
});
