// The vendored JS engine, and programs that call it through the
// compiler's own test hook `std:engine`, which only a session that allows it compiles, so these
// programs are compiled in process. The build under AddressSanitizer is `sanitized`.
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { CompileError, formatError } from "../../src/diag.fsh";
import { JS_NATIVE } from "../../src/js_native.fsh";
import { buildAsync, callsEngine, compile, engineDir, engineSources } from "../../src/main.fsh";
import { mathObjects, type BuildSession } from "../../src/mathlib.fsh";
import { NATIVE } from "../../src/native.fsh";
import { cachedSession } from "../../src/mathlib.fsh";
import { removed, same, scratch, text } from "./support.fsh";

// A session whose programs may import the compiler's own test hook.
function hooked(): BuildSession {
  let session = cachedSession();
  session.engineHook = true;
  return session;
}

function write(path: string, contents: string): void {
  try {
    writeFileSync(path, contents);
  } catch (e) {
    assert(false, `can't write ${path}: ${e.message}`);
  }
}

function failure(e: CompileError | Error | IoError | JsonError, file: string, src: string): string {
  if (e instanceof CompileError) return formatError(e, file, src);
  return (e as { message: string }).message;
}

// The vendored engine on its own, as clang builds it into a program that calls it.
test("the vendored engine evaluates JS", () => {
  const dir = scratch("fish-engine-");
  const main = join(dir, "main.c");
  write(main, `#include "quickjs.h"
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
  const built = spawnSync("clang", ["-I", engineDir(), main, ...engineSources(), "-lm", "-pthread", "-o", out]);
  assert(built.status === 0, `clang failed:\n${text(built.stderr)}`);
  same(text(spawnSync(out, []).stdout), "2,4,6\n", "the program's output");
  removed(dir);
}, { timeout: 30_000 });

type Ran = { stdout: string; stderr: string; exitCode: i64 };

// Builds the program at `file` with the runtime, the engine and the program all under
// AddressSanitizer, and runs it reporting leaks. ASan instruments only IR functions marked for
// it, and crashes on the empty struct accesses the IR makes, nested ones too, which touch nothing.
function sanitized(file: string, src: string): Ran {
  write(file, src);
  let ir = "";
  try {
    const compiled = compile(hooked(), src, file);
    ir = compiled;
  } catch (e) {
    assert(false, failure(e, file, src));
  }
  ir = ir
    .replaceAll(" uwtable ", " uwtable sanitize_address ")
    .replace(/^( *%[^ ]+) = load (\{[{} ,]*\}), ptr .*$/gm, "$1 = select i1 true, $2 zeroinitializer, $2 zeroinitializer")
    .replace(/^ *store \{[{} ,]*\} .*$/gm, "");
  const ll = `${file}.ll`;
  const c = `${file}.c`;
  const out = `${file}.out`;
  write(ll, ir);
  write(c, `${NATIVE}\n${JS_NATIVE}`);
  let session = hooked();
  let math: string[] = [];
  try {
    const objects = mathObjects(session);
    math = objects;
  } catch (e) {
    assert(false, e instanceof Error ? e.message : (e as IoError).message);
  }
  const built = spawnSync("clang", ["-w", "-g", "-funwind-tables", "-fsanitize=address", "-x", "ir", ll, "-x", "c", c, "-I", engineDir(), ...engineSources(), "-x", "none", ...math, "-o", out, "-lm", "-pthread"]);
  same(text(built.stderr), "", "clang's stderr");
  const run = spawnSync("env", ["FISH_LEAKS=1", out]);
  return { stdout: text(run.stdout), stderr: text(run.stderr), exitCode: run.status ?? -1 };
}

function handles(): string {
  return `import { evaluate } from "std:engine";

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
}

function sameRun(got: Ref<Ran>, stdout: string, what: string): void {
  same(got.stdout, stdout, `${what}'s stdout`);
  same(got.stderr, "", `${what}'s stderr`);
  assert(got.exitCode === 0, `${what} exited with ${got.exitCode}`);
}

// Handles copied, held by tasks on other threads and dropped, and every box freed.
test("JS handles are counted, sent and freed", () => {
  const dir = scratch("fish-engine-");
  sameRun(sanitized(join(dir, "handles.fsh"), handles()), "2\ndone\n", "handles");
  removed(dir);
}, { timeout: 30_000 });

function narrowing(): string {
  return `import { evaluate } from "std:engine";

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
}

// typeof reads a string, number or boolean out of JS where it narrows, and the accessors read
// objects and arrays, each value read freed.
test("JsValues are narrowed and read", () => {
  const dir = scratch("fish-engine-");
  sameRun(
    sanitized(join(dir, "narrowing.fsh"), narrowing()),
    "a string, fish, of length 4\na number, 2.5\ntrue\na function\nundefined\nnull\nan object\na number, 10.5 a string, x, of length 1 undefined\ntrue false true true false\nfishfish fish 4\n4\nfalse\nfish\nother\n4\ntrue\ntrue false\n",
    "narrowing",
  );
  removed(dir);
}, { timeout: 30_000 });

// Builds `src` as `file` within a session allowing the test hook, into `file`.out.
async function hookBuilt(file: string, src: string): Promise<void> {
  write(file, src);
  try {
    const _warnings = await buildAsync(hooked(), file, `${file}.out`);
  } catch (e) {
    assert(false, failure(e, file, src));
  }
}

// Reading through undefined throws in JS, which is a panic here.
test("reading a property of undefined panics", async () => {
  const dir = scratch("fish-engine-");
  const file = join(dir, "undefined.fsh");
  await hookBuilt(file, `import { evaluate } from "std:engine";\nfunction main() {\n  const v = evaluate("export default undefined;");\n  const w = v.get("x");\n}\n`);
  const run = spawnSync(`${file}.out`, []);
  same(text(run.stderr), `panicked at ${file}:4:13:\nuncaught exception in JS: TypeError: cannot read property 'x' of undefined\nstack backtrace:\n   0: main at ${file}:4:13\n`, "stderr");
  assert(run.status === 101, `exited with ${run.status ?? -1}`);
  removed(dir);
}, { timeout: 30_000 });

// The message compiling `src` as `file` throws, or "" when it compiles.
function refusal(session: BuildSession, file: string, src: string): string {
  write(file, src);
  try {
    const _ir = compile(session, src, file);
    return "";
  } catch (e) {
    return e instanceof CompileError ? e.message : (e as { message: string }).message;
  }
}

// What a JsValue refuses, each naming what to write instead.
test("refused", () => {
  const cases: [string, string][] = [
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
  ];
  const dir = scratch("fish-engine-");
  let failed: string[] = [];
  for (let i: usize = 0; i < cases.length; i++) {
    const [body, message] = cases[i].clone();
    const got = refusal(hooked(), join(dir, `refused-${i}.fsh`), `import { evaluate } from "std:engine";\nfunction main() { ${body} }\n`);
    if (!got.includes(message)) failed.push(`refused: ${body}\n  expected: ${message}\n  got: ${got === "" ? "no error" : got}`);
  }
  removed(dir);
  assert(failed.length === 0, failed.join("\n"));
}, { timeout: 30_000 });

// A throw while a module runs, or one that never parses, rejects or never settles, is a panic.
test("a module that fails panics", async () => {
  const cases: [string, string][] = [
    ["throw new TypeError('boom');", "TypeError: boom"],
    ["export default (;", "SyntaxError: unexpected token in expression: ';'"],
    ["export default await Promise.reject(new Error('later'));", "Error: later"],
    ["export default await new Promise(() => {});", "InternalError: the module awaits something that never settles"],
  ];
  const dir = scratch("fish-engine-");
  let failed: string[] = [];
  for (let i: usize = 0; i < cases.length; i++) {
    const [source, reason] = cases[i].clone();
    const file = join(dir, `fails-${i}.fsh`);
    await hookBuilt(file, `import { evaluate } from "std:engine";\nfunction main() {\n  console.log("before");\n  const v = evaluate(${JSON.stringify(source)});\n}\n`);
    const run = spawnSync("env", ["FISH_LEAKS=1", `${file}.out`]);
    const want = `panicked at std:engine:3:10:\nuncaught exception in JS: ${reason}\nstack backtrace:\n   0: main at ${file}:4:13\n`;
    if (text(run.stdout) !== "before\n" || text(run.stderr) !== want || run.status !== 101) {
      failed.push(`a module that fails panics: ${source}\n  expected stdout "before\\n", exit 101 and stderr:\n${want}  got exit ${run.status ?? -1}, stdout ${JSON.stringify(text(run.stdout))} and stderr:\n${text(run.stderr)}`);
    }
  }
  removed(dir);
  assert(failed.length === 0, failed.join("\n"));
}, { timeout: 30_000 });

test("a program can't import the test hook", () => {
  const dir = scratch("fish-engine-");
  const got = refusal(cachedSession(), join(dir, "hook.fsh"), `import { evaluate } from "std:engine";\nfunction main() {}\n`);
  same(got, "'std:engine' is the compiler's own test hook, which a program can't import; JS runs only as a package's code", "the error");
  removed(dir);
}, { timeout: 30_000 });

test("a program with no JS doesn't build the engine in", () => {
  const dir = scratch("fish-engine-");
  const file = join(dir, "plain.fsh");
  const src = 'function main() { console.log("  call void @fsh_rt_js_release(ptr %v)"); }\n';
  write(file, src);
  try {
    const ir = compile(hooked(), src, file);
    assert(!callsEngine(ir), "the IR calls the engine");
  } catch (e) {
    assert(false, failure(e, file, src));
  }
  removed(dir);
}, { timeout: 30_000 });
