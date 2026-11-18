// `fishc watch` keeps each build's check for the next: a rebuild of a program whose files all read
// as they did checks nothing again, and one after an edit checks afresh.
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Kept } from "../compiler/incremental.fsh";
import { CompileError } from "../compiler/diag.fsh";
import { builtKept, cleanDifference, compiledKept } from "../compiler/main.fsh";
import { cachedSession } from "../compiler/stdcache.fsh";
import { hostTarget } from "../compiler/target.fsh";
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

test("a rebuild with every file as it was checks nothing again, and one after an edit checks afresh", () => {
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
  const dir = scratch("fish-incremental-");
  const entry = join(dir, "main.fsh");
  write(entry, USES);
  let lib = LIB;
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

test("an edit to a function's body is checked again from what watch kept, and matches a clean build", () => {
  const said = edited([
    ["return n * 2;", "const k = 2;\n  return n * k;"],
    ["  return x;", "  const y = x;\n  return y;"],
    ["x + n;", "x + n * 2;"],
  ]);
  assert(said.join("; ") === "kept same; kept same; kept same", said.join("; "));
}, { timeout: 120_000 });

test("an edit to a method's body is checked afresh, and an error leaves nothing kept", () => {
  const said = edited([
    ["return this.v;", "return this.v + 1;"],
    ["return n * 2;", "return m * 2;"],
    ["return m * 2;", "return n * 2;"],
  ]);
  assert(said.join("; ") === "afresh same; error same; afresh same", said.join("; "));
}, { timeout: 120_000 });
