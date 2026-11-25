// `fishc repl`: how a line is sorted and assembled, in process through the compiler's repl module,
// and whole sessions through the fishc binary with the lines on its standard input.
import { readdirSync } from "node:fs";
import { complete, entries, program, thrownBy, type ReplState } from "../../src/repl.fsh";
import { fishc, removed, same, scratch } from "./support.fsh";

// What a session printed, with each prompt taken out so the answers stand alone.
function answers(lines: string[]): { out: string; err: string; code: i64; left: string[] } {
  const dir = scratch("repl");
  const got = fishc(dir, ["repl"], lines.join("\n") + "\n");
  let left: string[] = [];
  try {
    left = readdirSync(dir);
  } catch (_e) {}
  removed(dir);
  return { out: got.out.replaceAll("fish> ", "").replaceAll("....> ", ""), err: got.err, code: got.code, left };
}

test("the repl takes input as complete once every bracket, string, template and comment is closed", () => {
  for (const whole of ["a + 1", "f(1, [2])", "'it'", "`a ${b} c`", "x /* y */", "// {\n1", "'a\\'b'"]) assert(complete(whole), `'${whole}' is complete`);
  for (const open of ["function f() {", "f(1,", "[1, 2", "`a ${", "`a ${b", "x /* y", "{ a: `}`"]) assert(!complete(open), `'${open}' is still open`);
});

test("the repl sorts a line's statements into what is kept, printed or run", () => {
  let shown: string[] = [];
  try {
    for (const e of entries("const a = 1; function f(x: i64): i64 { return x; }\nf(a) + 1;\na = 2; type P = { x: i64 }\nawait g(); let b = await h(); const [c, d] = pair; (1)")) shown.push(`${e.kind} ${e.constant} ${e.awaits} [${e.names.join(",")}] ${e.text}`);
  } catch (e) {
    assert(false, `the line doesn't parse: ${e.message}`);
  }
  same(shown.join("\n"), [
    "binding true false [a] const a = 1;",
    "declaration false false [] function f(x: i64): i64 { return x; }",
    "expression false false [] f(a) + 1",
    "statement false false [] a = 2;",
    "declaration false false [] type P = { x: i64 }",
    "expression false true [] await g()",
    "binding false true [b] let b = await h();",
    "binding true false [] const [c, d] = pair;",
    "expression false false [] (1)",
  ].join("\n"), "the entries");
});

test("the repl's program for a line holds the kept declarations, then main with the kept bindings and the line", () => {
  const kept: ReplState = { top: ["function f(): i64 { return 1; }"], bindings: ["const a = 1;"], awaits: false, throws: ["IoError"] };
  const run = program(kept, "", "console.log(f() + a);", true, false);
  same(run.source, "function f(): i64 { return 1; }\nfunction main(): void throws IoError {\nconst a = 1;\nconsole.log(f() + a);\n}\n", "a line run in main");
  same(run.source.slice(run.at as i64, (run.at as i64) + 11), "console.log", "where the line starts");
  const top = program(kept, "const b = 2;", "", false, true);
  same(top.source, "function f(): i64 { return 1; }\nconst b = 2;\nasync function main(): Promise<void> throws IoError {\n\n}\n", "a line at the top level");
  same(top.source.slice(top.at as i64, (top.at as i64) + 7), "const b", "where the top-level line starts");
});

test("the repl reads the errors main must declare from the check's message", () => {
  same(thrownBy("'main' must declare 'throws IoError | JsonError' after its return type since 'f' can throw 'IoError', or catch it with try/catch").join(","), "IoError,JsonError", "two errors");
  same(thrownBy("'work' must declare 'throws IoError' after its return type since 'f' can throw 'IoError'").join(","), "", "another function's");
});

test("the repl keeps declarations and bindings, and answers pure expressions without a build", () => {
  const got = answers([
    "1 + 2",
    "\"a\" + \"b\"",
    "[1, 2, 3].map((x) => x * 2)",
    "({ b: \"x\", a: 1.5 })",
    "function double(x: i64): i64 { return x * 2; }",
    "double(21)",
    "const rate = 0.5",
    "function price(x: f64): f64 { return x * (1.0 + rate); }",
    "price(10.0)",
  ]);
  same(got.err, "", "stderr");
  same(got.out, "3\nab\n[ 2, 4, 6 ]\n{ a: 1.5, b: 'x' }\n42\n15\n", "the answers");
  same(String(got.code), "0", "the exit code");
  same(got.left.join(","), "", "what the session left in its directory");
});

test("the repl builds and runs a line that isn't pure once, and doesn't keep a let's assignment", () => {
  const got = answers([
    "let n = 1",
    "n += 5",
    "n",
    "console.log(\"hi\", n)",
    "Date.now() > 0",
    "function f(): i64 {",
    "  return 7;",
    "}",
    "f() + n",
    "await sleep(1)",
    "await (async (): Promise<i64> => 40 + n)()",
    "[1, 2, 3, 4, 5, 6, 7, 8]",
    ".exit",
    "never read",
  ]);
  same(got.err, "", "stderr");
  same(got.out, "1\nhi 1\ntrue\n8\n41\n[\n  1, 2, 3, 4,\n  5, 6, 7, 8\n]\n", "the answers");
});

test("the repl places an error in its line and loses nothing kept", () => {
  const got = answers(["const a = 2", "1 +", "nope(a)", "a * 2"]);
  same(got.out, "4\n", "the answer after the errors");
  assert(got.err.includes("repl:1:"), `the errors name the line:\n${got.err}`);
  assert(got.err.includes("nope"), `the unknown name is reported:\n${got.err}`);
});

test("the repl declares the error a line throws, and reports it when it escapes", () => {
  const got = answers(["import { readFileSync } from \"node:fs\"", "readFileSync(\"/no/such/file\", \"utf8\")", "2"]);
  same(got.out, "2\n", "the answer after the throw");
  assert(got.err.includes("/no/such/file"), `the escaped error is printed:\n${got.err}`);
});
