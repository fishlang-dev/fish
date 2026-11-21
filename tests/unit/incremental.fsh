// `fishc watch` keeps each build's check for the next: a rebuild of a program whose files all read
// as they did checks nothing again, and one after an edit checks afresh.
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Kept } from "../../src/incremental.fsh";
import { CompileError } from "../../src/diag.fsh";
import { builtKept, cleanDifference, compiledKept } from "../../src/main.fsh";
import { Queries } from "../../src/queries.fsh";
import { cachedSession } from "../../src/stdcache.fsh";
import { hostTarget } from "../../src/target.fsh";
import { removed, scratch, text } from "./support.fsh";

function write(path: string, contents: string): void {
  try {
    writeFileSync(path, contents);
  } catch (e) {
    assert(false, `can't write ${path}: ${e.message}`);
  }
}

function output(binary: string): string {
  const r = spawnSync(binary, []);
  return text(r.stdout);
}

// One of watch's builds of `entry` into `out`, from `kept`, giving what it keeps and the files it read.
function rebuild(entry: string, out: string, kept: Kept | undefined): [Kept, string[]] throws Error {
  let looked: string[] = [];
  try {
    let made = builtKept(cachedSession(), entry, out, false, "unwind", [], hostTarget(), false, false, looked, kept, undefined);
    return [made.kept, looked];
  } catch (e) {
    throw new Error(`the build failed: ${(e as { message: string }).message}`);
  }
}

const MAIN = `import { twice } from "./lib.fsh";

function main() {
  console.log(twice(21));
}
`;

test("a rebuild with every file as it was checks nothing again, and one after an edit checks the edit", () => {
  const dir = scratch("fish-incremental-");
  write(join(dir, "main.fsh"), MAIN);
  write(join(dir, "lib.fsh"), "export function twice(n: i64): i64 { return n * 2; }\n");
  const entry = join(dir, "main.fsh");
  const out = join(dir, "main");
  let [first, _looked] = rebuild(entry, out, undefined);
  assert(output(out) === "42\n", `the first build printed ${output(out)}`);
  const checks = first.checked.tables.counts.checks;
  assert(checks > 0, "the first build checked nothing");
  let [second, again] = rebuild(entry, out, first);
  assert(second.checked.tables.counts.checks === checks, `the rebuild checked ${second.checked.tables.counts.checks - checks} instances again`);
  assert(output(out) === "42\n", `the rebuild printed ${output(out)}`);
  assert(again.some((f) => f.endsWith("lib.fsh")), `the rebuild doesn't say it read lib.fsh: ${again.join(", ")}`);
  write(join(dir, "lib.fsh"), "export function twice(n: i64): i64 { return n + n + 1; }\n");
  let [third, _edited] = rebuild(entry, out, second);
  assert(third.checked.tables.counts.checks > 0, "the build after an edit checked nothing");
  assert(output(out) === "43\n", `the build after an edit printed ${output(out)}`);
  removed(dir);
}, { timeout: 120_000 });

// One of the driver's checks of `entry`, with the texts it holds standing in for the disk.
function driven(queries: Ref<Queries>, looked: Mut<string[]>, kept: Kept | undefined): Kept throws Error {
  try {
    return queries.checked(cachedSession(), looked, kept);
  } catch (e) {
    throw new Error(`the check failed: ${(e as { message: string }).message}`);
  }
}

// The text a driver is given stands in for the disk, as an editor's unsaved documents do.
test("a driver checks the text it is given, checks nothing again while that text holds, and rechecks one body when it changes", () => {
  const dir = scratch("fish-queries-");
  write(join(dir, "main.fsh"), MAIN);
  write(join(dir, "lib.fsh"), "export function twice(n: i64): i64 { return n * 2; }\n");
  const lib = join(dir, "lib.fsh");
  let open = new Map<string, string>();
  open.set(lib, "export function twice(n: i64): i64 { return n + n; }\n");
  let queries = new Queries(join(dir, "main.fsh"), undefined, open);
  let looked: string[] = [];
  let first = driven(queries, looked, undefined);
  const checks = first.checked.tables.counts.checks;
  assert(checks > 0, "the first check checked nothing");
  assert(first.checked.warnings.length === 0, `the first check warned: ${first.checked.warnings.length}`);
  let again: string[] = [];
  let second = driven(queries, again, first);
  const over = second.checked.tables.counts.checks;
  assert(over === checks, `the second check checked ${over - checks} instances again`);
  // An unused local in the text the driver holds is warned about, though the file on disk has
  // none: the check followed the driver's text rather than reading the file.
  queries.open.set(lib, "export function twice(n: i64): i64 { const spare = n; return n + n; }\n");
  let edited: string[] = [];
  let third = driven(queries, edited, second);
  assert(third.checked.tables.counts.checks > checks, "the check after an edit to the held text checked nothing again");
  assert(third.checked.warnings.some((w) => w.code === "W0001"), `the unused local in the held text wasn't warned about: ${third.checked.warnings.length} warning(s)`);
  removed(dir);
}, { timeout: 120_000 });

type Made = { ir: string; warnings: CompileError[] };

// What a clean build of `entry` says about `got`, a build from what watch kept, or its error.
function compared(entry: string, got: Ref<Made | CompileError>): string | undefined throws Error {
  try {
    return cleanDifference(cachedSession(), entry, false, "unwind", false, false, got);
  } catch (e) {
    throw new Error(`the clean build failed: ${e.message}`);
  }
}

// One of watch's compiles of `entry` from `kept`: what it made, or the error it stopped at, and
// what it keeps.
function compiledFrom(entry: string, kept: Kept | undefined): { made: Made | CompileError; kept: Kept | undefined } throws Error {
  let looked: string[] = [];
  try {
    let c = compiledKept(cachedSession(), entry, false, "unwind", false, false, looked, kept, undefined);
    const made: Made | CompileError = { ir: c.ir, warnings: c.warnings };
    return { made, kept: c.kept };
  } catch (e) {
    if (e instanceof CompileError) return { made: e, kept: undefined };
    throw new Error(`the build failed: ${e.message}`);
  }
}

test("a build from what watch kept is compared with a clean build's IR, warnings and error", () => {
  const dir = scratch("fish-incremental-");
  const entry = join(dir, "main.fsh");
  write(entry, MAIN);
  write(join(dir, "lib.fsh"), "export function twice(n: i64): i64 { return n * 2; }\n");
  let first = compiledFrom(entry, undefined);
  assert(compared(entry, first.made) === undefined, "a first build differs from a clean one");
  write(join(dir, "lib.fsh"), "export function twice(n: i64): i64 { return n + n + 1; }\n");
  let second = compiledFrom(entry, first.kept);
  assert(compared(entry, second.made) === undefined, "a build after an edit differs from a clean one");
  // The first build's IR, from before the edit, stands for a build that wrongly kept the old check.
  const stale = compared(entry, first.made) ?? "";
  assert(stale.startsWith("the IR differs"), `a stale build's IR wasn't caught: ${stale}`);
  write(join(dir, "lib.fsh"), "export function twice(n: i64): i64 { return m * 2; }\n");
  let third = compiledFrom(entry, second.kept);
  assert(third.made instanceof CompileError, "a build of a body naming nothing gave no error");
  const said = compared(entry, third.made);
  assert(said === undefined, `the error differs from a clean build's: ${said ?? ""}`);
  removed(dir);
}, { timeout: 120_000 });

const USES = `import { twice, pick, apply, Box } from "./lib.fsh";

function main() {
  console.log(twice(21), pick<string>("a"), apply(3), new Box().get());
}
`;

const LIB = `export class Box {
  v: i64 = 4;
  get(): i64 {
    return this.v;
  }
}

export function twice(n: i64): i64 { return n * 2; }

export function pick<T>(x: T): T {
  return x;
}

export function apply(n: i64): i64 {
  const f = (x: i64) => x + n;
  return f(1);
}
`;

// Edits `lib.fsh` in turn from a first build, each build from what the last one kept, and says
// for each whether it was rechecked from what was kept and how it compares with a clean build.
function edited(edits: Ref<[string, string][]>): string[] throws Error {
  return editedIn(USES, LIB, edits);
}

function editedIn(uses: string, written: string, edits: Ref<[string, string][]>): string[] throws Error {
  const dir = scratch("fish-incremental-");
  const entry = join(dir, "main.fsh");
  write(entry, uses);
  let lib = written;
  write(join(dir, "lib.fsh"), lib);
  let last = compiledFrom(entry, undefined);
  let said: string[] = [];
  for (const [from, to] of edits) {
    lib = lib.replace(from, to);
    write(join(dir, "lib.fsh"), lib);
    let next = compiledFrom(entry, last.kept);
    const how = next.kept === undefined ? "error" : next.kept!.carried > 0 ? "kept" : "afresh";
    said.push(`${how} ${compared(entry, next.made) ?? "same"}`);
    last = next;
  }
  removed(dir);
  return said;
}

test("a build keeps each function's define by its symbol, as its IR has it", () => {
  const dir = scratch("fish-incremental-");
  const entry = join(dir, "main.fsh");
  write(entry, USES);
  write(join(dir, "lib.fsh"), LIB);
  let looked: string[] = [];
  let made: { ir: string; warnings: CompileError[]; kept: Kept } | undefined = undefined;
  try {
    made = compiledKept(cachedSession(), entry, false, "unwind", false, false, looked, undefined, undefined);
  } catch (e) {
    throw new Error(`the build failed: ${(e as { message: string }).message}`);
  }
  const built = made!;
  const emitted = built.kept.emitted!;
  const defines = built.ir.split("\n").filter((line) => line.startsWith("define ")).length;
  assert(emitted.defines.size === defines, `${emitted.defines.size} defines kept of ${defines}`);
  for (const [name, text] of emitted.defines) assert(built.ir.includes(`${text}\n`), `the define of ${name} isn't the IR's`);
  assert(emitted.defines.has(`@"fsh.main"`), "main's define isn't kept by its symbol");
  removed(dir);
}, { timeout: 120_000 });

test("a build after an edit emits again only the functions it changed or moved, and matches a clean build", () => {
  const dir = scratch("fish-incremental-");
  const entry = join(dir, "main.fsh");
  write(entry, USES);
  let lib = LIB;
  write(join(dir, "lib.fsh"), lib);
  let last = compiledFrom(entry, undefined);
  let said: string[] = [];
  const edits: [string, string][] = [["return this.v;", "return this.v + 1;"], ["return n * 2;", "return n * 3;"], ["x + n;", "x + n * 2;"]];
  for (const [from, to] of edits) {
    lib = lib.replace(from, to);
    write(join(dir, "lib.fsh"), lib);
    let next = compiledFrom(entry, last.kept);
    const emitted = next.kept?.emitted?.reemitted ?? 0;
    said.push(`${emitted} ${compared(entry, next.made) ?? "same"}`);
    last = next;
  }
  removed(dir);
  assert(said.join(" | ") === "1 same | 1 same | 2 same", said.join(" | "));
}, { timeout: 120_000 });

test("a build with debug info emits every function again, as its lines are all marked", () => {
  const dir = scratch("fish-incremental-");
  const entry = join(dir, "main.fsh");
  write(entry, USES);
  write(join(dir, "lib.fsh"), LIB);
  let looked: string[] = [];
  let first: { ir: string; warnings: CompileError[]; kept: Kept } | undefined = undefined;
  let second: { ir: string; warnings: CompileError[]; kept: Kept } | undefined = undefined;
  try {
    first = compiledKept(cachedSession(), entry, false, "unwind", false, true, looked, undefined, undefined);
    write(join(dir, "lib.fsh"), LIB.replace("return n * 2;", "return n * 3;"));
    second = compiledKept(cachedSession(), entry, false, "unwind", false, true, looked, first!.kept, undefined);
  } catch (e) {
    throw new Error(`the build failed: ${(e as { message: string }).message}`);
  }
  const emitted = second!.kept.emitted!;
  removed(dir);
  assert(emitted.reemitted === emitted.made.size, `${emitted.reemitted} of ${emitted.made.size} emitted again`);
}, { timeout: 120_000 });

test("an edit reaching other functions' code emits them again: behind a vtable, raced and cancelled, shared, and no longer used", () => {
  let said: string[] = [];
  const dyn = `import { Circle, Shape, area } from "./lib.fsh";\nfunction main() {\n  const s: Dyn<Shape> = new Circle(2);\n  console.log(area(s));\n}\n`;
  const shapes = `export interface Shape {\n  area(): i64;\n}\n\nexport class Circle {\n  r: i64;\n  constructor(r: i64) {\n    this.r = r;\n  }\n  area(): i64 {\n    return this.r * 3;\n  }\n}\n\nexport function area(s: Ref<Dyn<Shape>>): i64 {\n  return s.area();\n}\n`;
  for (const each of editedIn(dyn, shapes, [["return this.r * 3;", "const k = 5;\n    return this.r * k;"]])) said.push(each);
  const raced = `import { outer } from "./lib.fsh";\nasync function main() {\n  const v = await outer();\n  console.log(v);\n}\n`;
  const racing = `export async function inner(n: i64): Promise<i64> {\n  await sleep(1);\n  return n * 2;\n}\n\nexport async function outer(): Promise<i64> {\n  const r = await Promise.race([inner(2), inner(3)]);\n  return r;\n}\n`;
  for (const each of editedIn(raced, racing, [["return n * 2;", "return n * 5;"], ["  await sleep(1);\n  return n * 5;", "  const m = n * 5;\n  await sleep(1);\n  await sleep(1);\n  return m;"]])) said.push(each);
  const shared = `import { first } from "./lib.fsh";\nfunction main() {\n  console.log(first<i64>([1, 2]), first<u8>([3 as u8]), first<string>(["a"]));\n}\n`;
  for (const each of editedIn(shared, `export function first<T>(xs: Ref<T[]>): i64 {\n  return xs.length as i64;\n}\n`, [["return xs.length as i64;", "return (xs.length as i64) + 1;"]])) said.push(each);
  const boxes = `export class Box<T> {\n  v: T;\n  constructor(v: T) {\n    this.v = v;\n  }\n  get(): i64 {\n    return 1;\n  }\n}\n\nexport function use(): i64 {\n  return new Box<i64>(1).get() + new Box<string>("a").get();\n}\n`;
  for (const each of editedIn(`import { use } from "./lib.fsh";\nfunction main() {\n  console.log(use());\n}\n`, boxes, [[` + new Box<string>("a").get()`, ""]])) said.push(each);
  // A string holding IR's own words names nothing the module must define.
  const quoting = `import { shout, twice } from "./lib.fsh";\nfunction main() {\n  shout();\n  console.log(twice(2));\n}\n`;
  for (const each of editedIn(quoting, `export function shout(): void {\n  console.log("define i32 @main(i32 %argc) calls @fsh_rt_args(");\n}\n\nexport function twice(n: i64): i64 {\n  return n * 2;\n}\n`, [["return n * 2;", "return n * 3;"]])) said.push(each);
  assert(said.every((each) => each === "kept same"), said.join(" | "));
}, { timeout: 300_000 });

test("an edit to a function's body is checked again from what watch kept, and matches a clean build", () => {
  const said = edited([
    ["return n * 2;", "const k = 2;\n  return n * k;"],
    ["  return x;", "  const y = x;\n  return y;"],
    ["x + n;", "x + n * 2;"],
  ]);
  assert(said.join("; ") === "kept same; kept same; kept same", said.join("; "));
}, { timeout: 120_000 });

test("an edit to a method's body, and one moving a class, are checked again from what watch kept", () => {
  const said = edited([
    ["return this.v;", "return this.v + 1;"],
    ["return n * 2;", "const k = 2;\n  return n * k;"],
    ["return this.v + 1;", "const w = this.v;\n    return w + 2;"],
  ]);
  assert(said.join("; ") === "kept same; kept same; kept same", said.join("; "));
}, { timeout: 120_000 });

test("an error leaves nothing kept, so the build after it checks afresh", () => {
  const said = edited([
    ["return n * 2;", "return m * 2;"],
    ["return m * 2;", "return n * 2;"],
  ]);
  assert(said.join("; ") === "error same; afresh same", said.join("; "));
}, { timeout: 120_000 });

const GENERIC = `export class Holder<T> {
  v: T;
  constructor(v: T) {
    this.v = v;
  }
  count(): i64 {
    return 1;
  }
}
`;

test("an edit to a generic class's method is checked again in every instance of the class", () => {
  const uses = `import { Holder } from "./lib.fsh";

function main() {
  console.log(new Holder<i64>(3).count(), new Holder<string>("s").count());
}
`;
  const said = editedIn(uses, GENERIC, [["    return 1;", "    const w = 2;\n    return w;"]]);
  assert(said.join("; ") === "kept same", said.join("; "));
}, { timeout: 120_000 });

const CHAIN = `export function label(n: i64) {
  return n * 2;
}

export function wrap(n: i64) {
  return label(n);
}
`;

const CALLS = `import { label, wrap } from "./lib.fsh";

function main() {
  console.log(wrap(2));
}
`;

test("a body whose inferred result changes is checked again in every caller that read it", () => {
  const said = editedIn(CALLS, CHAIN, [["  return n * 2;", "  return `${n}`;"], ["  return `${n}`;", "  return n + 1;"]]);
  assert(said.join("; ") === "kept same; kept same", said.join("; "));
}, { timeout: 120_000 });

test("a function's signature edit is checked again with every body naming it", () => {
  const said = editedIn(CALLS, CHAIN, [
    ["export function label(n: i64) {", "export function label(n: i64): i64 {"],
    ["export function label(n: i64): i64 {", "export function label(k: i64, j: i64 = 1): i64 {\n  const n = k * j;"],
  ]);
  assert(said.join("; ") === "kept same; kept same", said.join("; "));
}, { timeout: 120_000 });

test("a closure naming an edited signature is checked again with the body it is written in", () => {
  const uses = `import { place } from "./lib.fsh";

function main() {
  console.log(place(3));
}
`;
  const lib = `export function moved(offset: i64): i64 {
  return offset + 1;
}

export function place(n: i64): i64 {
  const regions = [1, 2, 3];
  const at = (k: i64) => moved(k) + (regions.length as i64);
  return at(n);
}
`;
  const said = editedIn(uses, lib, [["export function moved(offset: i64): i64 {\n  return offset + 1;", "export function moved(at: i64): i64 {\n  return at + 1;"]]);
  assert(said.join("; ") === "kept same", said.join("; "));
}, { timeout: 120_000 });
