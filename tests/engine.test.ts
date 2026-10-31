import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CompileError } from "../src/diag.ts";
import { buildAsync, callsEngine, compile, ENGINE, ENGINE_SOURCES } from "../src/main.ts";
import { sanitized as sanitize } from "./sanitized.ts";
import { newSession } from "../src/compilation.ts";

// Programs here may import the compiler's own test hook.
const session = newSession();
session.engineHook = true;

// Each test builds a program with the JS engine, whose sources take several seconds to compile.
setDefaultTimeout(30_000);

const dir = mkdtempSync(join(tmpdir(), "fish-engine-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

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

function sanitized(name: string, src: string) {
  return sanitize(session, join(dir, `${name}.fsh`), src);
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

function length(s: Ref<string>): usize {
  return s.length;
}

function twice(x: Ref<f64>): f64 {
  return x * 2;
}

function not(b: Ref<boolean>): boolean {
  return !b;
}

// Narrowed to several kinds, it stays the JsValue, out of the Option and through the reference.
function kinds(u: Ref<JsValue | null>): boolean {
  if (u !== null && (typeof u === "string" || typeof u === "number")) {
    const held = { u };
    return typeof held.u === "number";
  }
  return false;
}

// A borrowed JsValue narrows too, read through the reference.
function lent(v: Ref<JsValue>): string {
  if (typeof v === "string") return v;
  if (typeof v === "number") return \`\${twice(v)}\`;
  if (typeof v === "boolean") return \`\${not(v)}\`;
  return "other";
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
  console.log(kept + read(), { s: s }.s, length(s));
  const parts = [o.get("n"), o.get("ok"), o.get("name"), list];
  for (const part of parts) console.log(lent(part));
  // A JsValue taken out of an Option narrows as one held on its own does.
  const found: JsValue | null = o.get("name");
  if (found !== null && typeof found === "string") console.log(found.length);
  const shaped: { a: JsValue; b?: JsValue } = { a: o.get("n") };
  console.log(shaped.b === null);
  const [n, none]: [JsValue | null, JsValue | null] = [o.get("n"), null];
  console.log(kinds(n), kinds(none));
}
`;

// typeof reads a string, number or boolean out of JS where it narrows, and the accessors read
// objects and arrays, each value read freed.
test("JsValues are narrowed and read", () => {
  expect(sanitized("narrowing", NARROWING)).toEqual({
    stdout: "a string, fish, of length 4\na number, 2.5\ntrue\na function\nundefined\nnull\nan object\na number, 10.5 a string, x, of length 1 undefined\ntrue false true true false\nfishfish fish 4\n4\nfalse\nfish\nother\n4\ntrue\ntrue false\n",
    stderr: "",
    exitCode: 0,
  });
});

// Reading through undefined throws in JS, which is a panic here.
test("reading a property of undefined panics", async () => {
  const file = join(dir, "undefined.fsh");
  writeFileSync(file, `import { evaluate } from "fish:engine";\nfunction main() {\n  const v = evaluate("export default undefined;");\n  const w = v.get("x");\n}\n`);
  await buildAsync(session, file, `${file}.out`);
  const run = Bun.spawnSync([`${file}.out`]);
  expect(run.stderr.toString()).toBe(`panicked at ${file}:4:13:\nuncaught exception in JS: TypeError: cannot read property 'x' of undefined\n`);
  expect(run.exitCode).toBe(101);
});

// What a JsValue refuses, each naming what to write instead.
test.each([
  ["const v = evaluate(''); console.log(v.a);", "a 'JsValue' could be anything, as an 'unknown' could, so it has no property 'a' to use; read one with 'v.get(\"a\")'"],
  ["const v = evaluate(''); const x = v[0];", "a 'JsValue' could be anything, as an 'unknown' could, so its elements are read with 'at': 'v.at(i)'"],
  ["const v = evaluate(''); v.push(1);", "a 'JsValue' has no method 'push': its own are 'get', 'at' and 'has', and it is narrowed with 'typeof' to read it"],
  ["const v = evaluate(''); const x = v.get(1);", "'get' takes a key, as a 'string', not 'i64'"],
  ["const v = evaluate(''); const x = v.at();", "'at' takes an index, as an 'i64'"],
  ["const v = evaluate(''); const x = typeof v === 'nope';", "'typeof' can only be compared with \"number\", \"boolean\", \"string\", \"object\", \"undefined\", \"function\", \"bigint\", \"symbol\" here"],
  ["const v = evaluate(''); if (typeof v === 'string') { const o = { v }; }", "'v' is read out of JS as a 'string' here; write 'v: v'"],
  ["const v = evaluate(''); const u: JsValue | string = v; const s = typeof u === 'string';", "'typeof' can't tell what a 'JsValue' in a union holds yet; test the 'JsValue' on its own"],
  ["const v = evaluate(''); const xs: (JsValue | string)[] = [v, 's']; const ys: JsValue[] = xs;", "turning a Fish value into a JS value isn't supported yet, outside a call or a write that gives it to JS; a 'JsValue' or a package's object comes only from JS"],
  ["const v = evaluate(''); if (typeof v === 'string') { const r: Ref<string> = v; }", "'r' would keep borrowing what 'v' gives here, which is read out of JS anew at each use"],
  ["const v = evaluate(''); v.x = 1;", "writing a JS value's properties isn't supported yet; a 'JsValue' is read with 'get'"],
  ["const v = evaluate(''); v[0] = 1;", "writing a JS value's elements isn't supported yet; a 'JsValue' is read with 'at'"],
  ["const v = evaluate(''); const g = v.get;", "'get' is a method of a 'JsValue'; call it, as in 'v.get(...)'"],
])("refused: %s", (body, message) => {
  const [file, src] = [join(dir, `refused-${Bun.hash(body)}.fsh`), `import { evaluate } from "fish:engine";\nfunction main() { ${body} }\n`];
  writeFileSync(file, src);
  expect(() => compile(session, src, file)).toThrow(message);
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
  await buildAsync(session, file, `${file}.out`);
  const run = Bun.spawnSync([`${file}.out`], { env: { ...process.env, FISH_LEAKS: "1" } });
  expect(run.stdout.toString()).toBe("before\n");
  expect(run.stderr.toString()).toBe(`panicked at fish:engine:3:10:\nuncaught exception in JS: ${reason}\n`);
  expect(run.exitCode).toBe(101);
});

test("a program can't import the test hook", () => {
  const [file, src] = [join(dir, "hook.fsh"), `import { evaluate } from "fish:engine";\nfunction main() {}\n`];
  writeFileSync(file, src);
  expect(() => compile(newSession(), src, file)).toThrow(
    new CompileError("'fish:engine' is the compiler's own test hook, which a program can't import; JS runs only as a package's code", 0, 0),
  );
});

test("a program with no JS doesn't build the engine in", () => {
  const [file, src] = [join(dir, "plain.fsh"), 'function main() { console.log("  call void @fsh_rt_js_release(ptr %v)"); }\n'];
  writeFileSync(file, src);
  expect(callsEngine(compile(session, src, file))).toBe(false);
});
