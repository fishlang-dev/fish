// A function that didn't change emits the same IR whatever else in the program did: no name in the
// IR is built from a program-wide counter or a source offset. Each test builds a program to IR,
// edits it somewhere else, builds it again, and compares the functions the edit didn't touch. An
// edit keeps every line where it was, as a panic's location is rightly its line.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fishc, removed, scratch } from "./support.fsh";

function write(path: string, contents: string): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents);
  } catch (e) {
    assert(false, `can't write ${path}: ${e.message}`);
  }
}

// Each function in `ir` by its symbol, with its text.
function functions(ir: string): Map<string, string> {
  let out = new Map<string, string>();
  let name = "";
  let body: string[] = [];
  for (const line of ir.split("\n")) {
    if (name === "" && line.startsWith("define ")) {
      const at = line.indexOf("@");
      const open = line.indexOf("(", at);
      name = line.slice(at, open);
      body = [line];
      continue;
    }
    if (name === "") continue;
    body.push(line);
    if (line.startsWith("}")) {
      out.set(name, body.join("\n"));
      name = "";
    }
  }
  return out;
}

// The program's IR, built in `dir` from `main.fsh`.
function irOf(dir: string, src: string): Map<string, string> {
  write(join(dir, "main.fsh"), src);
  const built = fishc(dir, ["build", "main.fsh", "--emit-llvm"]);
  assert(built.code === 0, `the build failed:\n${built.err}`);
  return functions(built.out);
}

// The functions named in `names` whose IR differs between `before` and `after`, said for a failure.
function differing(before: Ref<Map<string, string>>, after: Ref<Map<string, string>>, names: Ref<string[]>): string {
  let wrong: string[] = [];
  for (const n of names) {
    const a = before.get(n);
    const b = after.get(n);
    if (a === undefined || b === undefined) wrong.push(`${n} is missing from ${a === undefined ? "the first" : "the second"} build`);
    else if (a !== b) wrong.push(`${n} changed:\n--- before\n${a}\n--- after\n${b}`);
  }
  return wrong.join("\n\n");
}

// Every function in `ir` whose symbol starts with one of `prefixes`.
function named(ir: Ref<Map<string, string>>, prefixes: Ref<string[]>): string[] {
  let out: string[] = [];
  for (const k of ir.keys()) if (prefixes.some((p) => k.startsWith(p))) out.push(k);
  out.sort();
  return out;
}

const APPLY = `function before(): i64 { return 3; }

function apply(f: (x: i64) => i64, x: i64): i64 {
  return f(x);
}

function main() {
  console.log(apply((x) => x + 1, 1), apply((x) => x * 2, 2));
}
`;

test("a function sharing its code among callbacks names its slots without the program's locals", () => {
  const dir = scratch("fish-irnames-");
  const before = irOf(dir, APPLY);
  // More locals before it, which a slot named by the program's local count would move with.
  const after = irOf(dir, APPLY.replace("function before(): i64 { return 3; }", "function before(): i64 { const a = 1; const b = 2; return a + b; }"));
  const shared = named(before, ['@"fsh.apply']);
  assert(shared.length > 0, "no instance of apply was found");
  const wrong = differing(before, after, shared);
  removed(dir);
  assert(wrong === "", wrong);
});

const SORTED = `function other(): i64 { return 7; }

function sorted(xs: i64[]): i64[] {
  let ys = xs.slice();
  ys.sort((a, b) => a - b);
  return ys;
}

function main() {
  console.log(sorted([3, 1, 2]));
}
`;

test("a sort's comparator is named by its function, not by where the file puts it", () => {
  const dir = scratch("fish-irnames-");
  const before = irOf(dir, SORTED);
  const after = irOf(dir, SORTED.replace("{ return 7; }", "{ return 7000000; }"));
  const comparators = named(before, ["@fsh.sort.compare.", '@"fsh.sorted']);
  assert(comparators.length > 1, `the comparator or its caller wasn't found: ${comparators.join(", ")}`);
  const wrong = differing(before, after, comparators);
  removed(dir);
  assert(wrong === "", wrong);
});

// A package with a promise and a callback, for the shims JS calls go through.
function jsPackage(dir: string): void {
  write(join(dir, "node_modules", "p", "package.json"), '{"name":"p","type":"module","exports":{".":{"types":"./index.d.ts","import":"./index.js"}}}');
  write(join(dir, "node_modules", "p", "index.js"), "export async function twice(n) { return n * 2; }\nexport function each(xs, f) { for (const x of xs) f(x); }\nexport async function plusOne(p) { return (await p) + 1; }\n");
  write(join(dir, "node_modules", "p", "index.d.ts"), "export declare function twice(n: number): Promise<number>;\nexport declare function each(xs: number[], f: (x: number) => void): void;\nexport declare function plusOne(p: Promise<number>): Promise<number>;\n");
}

const JS = `import { twice, each, plusOne } from "p";

function unused(): i64 { return 1; }

async function three(): Promise<f64> {
  return 3;
}

async function use(): Promise<void> throws JsError {
  const n = await twice(2);
  const m = await plusOne(three());
  console.log(m);
  each([1, 2], (x) => console.log(x + n));
}

async function main(): Promise<void> throws JsError {
  await use();
}
`;

test("the shims a JS promise and a JS callback go through are named by their function", () => {
  const dir = scratch("fish-irnames-");
  jsPackage(dir);
  const before = irOf(dir, JS);
  const after = irOf(dir, JS.replace("{ return 1; }", "{ const k = 1; return k + 1; }"));
  const shims = named(before, ["@fsh.js.settle.", "@fsh.js.callback."]);
  assert(shims.some((s) => s.startsWith("@fsh.js.settle.")) && shims.some((s) => s.startsWith("@fsh.js.callback.")), `the shims weren't found: ${shims.join(", ")}`);
  const wrong = differing(before, after, shims);
  removed(dir);
  assert(wrong === "", wrong);
}, { timeout: 30_000 });

const BOXED = `class Box {
  a: i64 = 1;
}

function pass(b: Box): Box {
  return b;
}

function main() {
  console.log(pass(new Box()).a);
}
`;

test("a function passing an instance on keeps its IR when the class gains a field", () => {
  const dir = scratch("fish-irnames-");
  const before = irOf(dir, BOXED);
  // On the same line, so no line moves.
  const after = irOf(dir, BOXED.replace("  a: i64 = 1;", "  a: i64 = 1; z: i64 = 0;"));
  const passing = named(before, ['@"fsh.pass"', "@fsh.pass("]);
  assert(passing.length > 0, `pass wasn't found: ${[...before.keys()].join(", ")}`);
  const wrong = differing(before, after, passing);
  removed(dir);
  assert(wrong === "", wrong);
});
