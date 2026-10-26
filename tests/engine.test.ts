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

// Builds a program with the runtime, the engine and the program all under AddressSanitizer, and
// runs it reporting leaks. ASan instruments only IR functions marked for it, and crashes on the
// empty struct accesses the IR makes, which touch nothing.
function sanitized(name: string, src: string) {
  const file = join(dir, `${name}.fsh`);
  writeFileSync(file, src);
  const ir = compile(src, file)
    .replaceAll(" uwtable ", " uwtable sanitize_address ")
    .replace(/^( *%[^ ]+) = load \{\}, ptr .*$/gm, "$1 = select i1 true, {} zeroinitializer, {} zeroinitializer")
    .replace(/^ *store \{\} .*$/gm, "");
  const [ll, c, out] = [join(dir, `${name}.ll`), join(dir, `${name}.c`), join(dir, name)];
  writeFileSync(ll, ir);
  writeFileSync(c, `${NATIVE}\n${JS_NATIVE}`);
  const built = Bun.spawnSync(["clang", "-w", "-g", "-funwind-tables", "-fsanitize=address", "-x", "ir", ll, "-x", "c", c, "-I", ENGINE, ...ENGINE_SOURCES, "-o", out, "-lm", "-pthread"]);
  expect(built.stderr.toString()).toBe("");
  const run = Bun.spawnSync([out], { env: { ...process.env, FISH_LEAKS: "1" } });
  return { stdout: run.stdout.toString(), stderr: run.stderr.toString(), exitCode: run.exitCode };
}

// Handles copied, held by tasks on other threads and dropped, and every box freed.
test("JS handles are counted, sent and freed", () => {
  expect(sanitized("handles", HANDLES)).toEqual({ stdout: "2\ndone\n", stderr: "", exitCode: 0 });
});

const NARROWING = `import { evaluate } from "fish:engine";

function describe(v: JsValue): string {
  if (typeof v === "string") return \`a string, \${v}, of length \${v.length}\`;
  if (typeof v === "number") return \`a number, \${v + 0.5}\`;
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "function") return "a function";
  if (v === undefined) return "undefined";
  if (v === null) return "null";
  return "an object";
}

function empty(v: Ref<JsValue>): boolean {
  return v === null || v === undefined;
}

function main() {
  const o = evaluate("export default { name: 'fish', n: 2, ok: true, list: [10, 'x'], f() {}, none: null, big: 1n };");
  for (const key of ["name", "n", "ok", "f", "missing", "none", "big"]) console.log(describe(o.get(key)));
  const list = o.get("list");
  console.log(describe(list.at(0)), describe(list.at(1)), describe(list.at(5)));
  console.log(o.has("name"), o.has("zzz"), list.has("length"), empty(o.get("none")), empty(list));
  const s = o.get("name");
  if (typeof s !== "string") return;
  const kept = s;
  const read = () => s;
  console.log(kept + read(), { s: s }.s);
}
`;

// typeof reads a string, number or boolean out of JS where it narrows, and the accessors read
// objects and arrays, each value read freed.
test("JsValues are narrowed and read", () => {
  expect(sanitized("narrowing", NARROWING)).toEqual({
    stdout: "a string, fish, of length 4\na number, 2.5\ntrue\na function\nundefined\nnull\nan object\na number, 10.5 a string, x, of length 1 undefined\ntrue false true true false\nfishfish fish\n",
    stderr: "",
    exitCode: 0,
  });
});

// Reading through undefined throws in JS, which is a panic here.
test("reading a property of undefined panics", async () => {
  const file = join(dir, "undefined.fsh");
  writeFileSync(file, `import { evaluate } from "fish:engine";\nfunction main() {\n  const v = evaluate("export default undefined;");\n  const w = v.get("x");\n}\n`);
  await buildAsync(file, `${file}.out`);
  const run = Bun.spawnSync([`${file}.out`]);
  expect(run.stderr.toString()).toBe(`panicked at ${file}:4:13:\nuncaught exception in JS: TypeError: cannot read property 'x' of undefined\n`);
  expect(run.exitCode).toBe(101);
});

// What a JsValue refuses, each naming what to write instead.
test.each([
  ["const v = evaluate(''); console.log(v.a);", "a 'JsValue' could be anything, as an 'unknown' could, so its properties are read with 'get': 'v.get(\"a\")'"],
  ["const v = evaluate(''); const x = v[0];", "a 'JsValue' could be anything, as an 'unknown' could, so its elements are read with 'at': 'v.at(i)'"],
  ["const v = evaluate(''); v.push(1);", "a 'JsValue' has no method 'push': its own are 'get', 'at' and 'has', and it is narrowed with 'typeof' to read it"],
  ["const v = evaluate(''); const x = v.get(1);", "'get' takes a key, as a 'string', not 'i64'"],
  ["const v = evaluate(''); const x = v.at();", "'at' takes an index, as an 'i64'"],
  ["const v = evaluate(''); const x = typeof v === 'nope';", "'typeof' can only be compared with \"number\", \"boolean\", \"string\", \"object\", \"undefined\", \"function\", \"bigint\", \"symbol\" here"],
  ["const v = evaluate(''); if (typeof v === 'string') { const o = { v }; }", "'v' is read out of JS as a 'string' here; write 'v: v'"],
])("refused: %s", (body, message) => {
  const [file, src] = [join(dir, `refused-${Bun.hash(body)}.fsh`), `import { evaluate } from "fish:engine";\nfunction main() { ${body} }\n`];
  writeFileSync(file, src);
  expect(() => compile(src, file)).toThrow(message);
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
