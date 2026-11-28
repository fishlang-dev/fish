// `--target js`: the module and `.d.ts` a build writes, the forms it refuses, and, with
// FISH_TEST_NODE=1 and node, what the module does under Node: its output, a panic's lines and its
// exit code. Without them the runs are skipped.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { heldAs, jsName, memberOf, memberText } from "../../src/jsgen.fsh";
import { fishc, removed, same, scratch, text } from "./support.fsh";

function write(path: string, contents: string): void {
  try {
    writeFileSync(path, contents);
  } catch (e) {
    assert(false, `can't write ${path}: ${e.message}`);
  }
}

function contents(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (e) {
    assert(false, `can't read ${path}: ${e.message}`);
    return "";
  }
}

// `source` built as `main.fsh` in a fresh directory with `--target js` and `flags`, giving the directory.
function builtJs(source: string, flags: string[]): string {
  const dir = scratch("fish-js-");
  write(join(dir, "main.fsh"), source);
  const run = fishc(dir, ["build", "main.fsh", "--target", "js", ...flags]);
  same(run.err, "", "the js build's stderr");
  assert(run.code === 0, `the js build exited with ${run.code}`);
  return dir;
}

function nodeReady(): boolean {
  return process.env.FISH_TEST_NODE === "1" && Bun.which("node") !== null;
}

type NodeRun = { code: i64; out: string; err: string };

function node(dir: string, file: string): NodeRun {
  const run = spawnSync("node", [file], { cwd: dir });
  return { code: run.status ?? -1, out: text(run.stdout), err: text(run.stderr) };
}

const PROGRAM = `class Counter {
  n: i64 = 0;
  bump(this: Mut<this>): void {
    this.n += 1;
  }
}

function add<T>(a: T, b: T, f: (x: T, y: T) => T): T {
  return f(a, b);
}

function main() {
  let c = new Counter();
  c.bump();
  c.bump();
  const big: u64 = 18446744073709551615;
  const xs = [1, 2, 3];
  console.log(add(2, 3, (x: i64, y: i64) => x + y), c.n);
  console.log(big, 7 / 2, -7 % 3, 1.5 * 2);
  console.log(xs.map((x) => x * 2).join(","), \`\${xs.length} items\`);
}
`;

test("an integer type is held as a number or a BigInt", () => {
  same(heldAs("i64"), "number", "i64");
  same(heldAs("usize"), "number", "usize");
  same(heldAs("u32"), "number", "u32");
  same(heldAs("u64"), "big", "u64");
  same(heldAs("i128"), "big", "i128");
  same(heldAs("bigint"), "big", "bigint");
});

test("names and members as the module writes them", () => {
  same(jsName("count", "$v1"), "count", "an identifier");
  same(jsName("[a, b]", "$v1"), "$v1", "a pattern's made-up name");
  same(jsName("$fshTaken", "$v2"), "$v2", "a name the helpers keep");
  same(memberText("x", false), ".x", "a field");
  same(memberText("#secret@Sub", false), ".#secret", "a subclass's copy of a private name");
  same(memberText("0", true), '?.["0"]', "a tuple's field, optionally");
  const m = memberOf("Shape.static get unit");
  assert(m !== undefined && m!.name === "unit" && m!.static && m!.accessor === "get", "a static getter");
  const it = memberOf("List.[Symbol.iterator]");
  assert(it !== undefined && it!.name === "[Symbol.iterator]" && !it!.static && it!.accessor === undefined, "a computed method name");
  assert(memberOf("main") === undefined, "a function's name is no member");
});

test("a js build writes a module that runs main, with its integers checked", () => {
  const dir = builtJs(PROGRAM, []);
  assert(existsSync(join(dir, "main.d.ts")), "the .d.ts is written");
  const js = contents(join(dir, "main.js"));
  assert(js.startsWith("const $fsh = (() => {"), "the module starts with its helpers");
  assert(js.includes("class Counter {"), "the class");
  assert(js.includes("function main() {"), "main");
  assert(js.includes('$fsh.ar("+", '), "checked addition");
  assert(js.includes("18446744073709551615n"), "a u64 as a BigInt");
  assert(js.endsWith("$fsh.main(main);\n"), "main runs last");
  same(contents(join(dir, "main.d.ts")), "export {};\n", "a program exporting nothing");
  removed(dir);
});

test("a js library exports its functions, typed in its .d.ts", () => {
  const dir = scratch("fish-js-lib-");
  write(join(dir, "lib.fsh"), `export function scale(x: f64, by: i64): f64 {
  return x * (by as f64);
}

export function half(n: u64): u64 {
  return n / 2;
}
`);
  const run = fishc(dir, ["build", "lib.fsh", "--target", "js", "--lib"]);
  same(run.err, "", "the library build's stderr");
  const js = contents(join(dir, "lib.js"));
  assert(js.includes("export { "), "an export list");
  assert(!js.includes("$fsh.main("), "a library runs nothing");
  const dts = contents(join(dir, "lib.d.ts"));
  assert(dts.includes("export declare function scale(x: number, by: number): number;"), `scale's declaration in:\n${dts}`);
  assert(dts.includes("export declare function half(n: bigint): bigint;"), `half's declaration in:\n${dts}`);
  if (nodeReady()) {
    write(join(dir, "package.json"), '{ "type": "module" }\n');
    write(join(dir, "use.js"), 'import { scale, half } from "./lib.js";\nconsole.log(scale(1.5, 2), half(9n));\n');
    const ran = node(dir, "use.js");
    same(ran.out, "3 4n\n", `node's output, with stderr ${ran.err}`);
  }
  removed(dir);
});

test("a form the js target can't compile is refused at its span", () => {
  const dir = scratch("fish-js-refused-");
  write(join(dir, "main.fsh"), `function main() {
  const n: i64 = 2;
  const s = match (n) {
    case 1 => "one",
    case _ => "many",
  };
  console.log(s);
}
`);
  const run = fishc(dir, ["build", "main.fsh", "--target", "js"]);
  assert(run.code === 1, `exited with ${run.code}`);
  assert(run.err.includes("main.fsh:3:13: error[E0803]: 'match' expressions are not supported on the js target yet"), `stderr:\n${run.err}`);
  assert(!existsSync(join(dir, "main.js")), "nothing is written");
  const flags = fishc(dir, ["build", "main.fsh", "--target", "js", "--emit-llvm"]);
  assert(flags.code === 2 && flags.err.includes("a js build is a JavaScript module"), `--emit-llvm: ${flags.err}`);
  removed(dir);
});

test("a js module prints as the native build does under Node", () => {
  if (!nodeReady()) {
    console.log("skipped: running js modules needs FISH_TEST_NODE=1 and node");
    return;
  }
  const dir = builtJs(PROGRAM, []);
  const ran = node(dir, "main.js");
  same(ran.err, "", "node's stderr");
  same(ran.out, "5 2\n18446744073709551615 3 -1 3\n2,4,6 3 items\n", "node's output");
  removed(dir);
});

test("an i64 past the safe-integer range panics as an overflow under Node", () => {
  if (!nodeReady()) {
    console.log("skipped: running js modules needs FISH_TEST_NODE=1 and node");
    return;
  }
  const dir = builtJs(`function next(n: i64): i64 {
  return n + 1;
}

function main() {
  console.log(next(9007199254740990));
  console.log(next(9007199254740991));
}
`, []);
  const ran = node(dir, "main.js");
  same(ran.out, "9007199254740991\n", "what printed before the panic");
  same(ran.err, "panicked at main.fsh:2:10:\nattempt to add with overflow\n", "the panic's lines");
  assert(ran.code === 101, `exited with ${ran.code}`);
  removed(dir);
});

test("division by zero, an index past the end and an empty unwrap panic under Node", () => {
  if (!nodeReady()) {
    console.log("skipped: running js modules needs FISH_TEST_NODE=1 and node");
    return;
  }
  const cases: [string, string][] = [
    ["console.log(div(10, 0));", "attempt to divide by zero"],
    ["console.log(pick([1, 2, 3], 5));", "index out of bounds: the len is 3 but the index is 5"],
    ["const m = new Map<string, i64>();\n  console.log(m.get(\"a\")!);", "called `Option::unwrap()` on a `None` value"],
  ];
  const helpers = "function div(a: i64, b: i64): i64 {\n  return a / b;\n}\n\nfunction pick(xs: i64[], i: i64): i64 {\n  return xs[i];\n}\n\n";
  for (const [body, reason] of cases) {
    const dir = builtJs(`${helpers}function main() {\n  ${body}\n}\n`, []);
    const ran = node(dir, "main.js");
    assert(ran.code === 101 && ran.err.startsWith("panicked at main.fsh:") && ran.err.endsWith(`:\n${reason}\n`), `${reason}: exited with ${ran.code}, stderr:\n${ran.err}`);
    removed(dir);
  }
});

test("a panic passes a catch the program wrote under Node", () => {
  if (!nodeReady()) {
    console.log("skipped: running js modules needs FISH_TEST_NODE=1 and node");
    return;
  }
  const dir = builtJs(`class Oops {
  message: string;
  constructor(message: string) {
    this.message = message;
  }
}

function risky(n: i64): i64 throws Oops {
  if (n < 0) throw new Oops("negative");
  return n * 1000000000;
}

function main() {
  try {
    console.log(risky(-1));
  } catch (e) {
    console.log("caught", e.message);
  }
  try {
    console.log(risky(10000000000));
  } catch (e) {
    console.log("not this", e.message);
  }
}
`, []);
  const ran = node(dir, "main.js");
  same(ran.out, "caught negative\n", "what printed");
  assert(ran.code === 101 && ran.err.endsWith(":\nattempt to multiply with overflow\n"), `exited with ${ran.code}, stderr:\n${ran.err}`);
  removed(dir);
});
