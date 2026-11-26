// `fishc fix`: machine-applicable edits on borrow, move, and mutability errors, preferring
// borrows (`Ref<T>`, `Mut<T>`) over `.clone()` via trial-verified re-checking.
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fishc, removed, scratch, text } from "./support.fsh";

function write(path: string, contents: string): void {
  try {
    writeFileSync(path, contents);
  } catch (e) {
    assert(false, `can't write ${path}: ${e.message}`);
  }
}

function read(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (e) {
    assert(false, `can't read ${path}: ${e.message}`);
    return "";
  }
}

function makeDir(path: string): void {
  try {
    mkdirSync(path, { recursive: true });
  } catch (e) {
    assert(false, `can't mkdir ${path}: ${e.message}`);
  }
}

test("fishc fix prefers Ref<T> borrow over clone for read-only callee and preserves comments", () => {
  const dir = scratch("fish-fix-borrow-");
  try {
    const file = join(dir, "app.fsh");
    const src = `// keep this header comment
function total(xs: i64[]): i64 {
  let sum = 0;
  for (const x of xs) sum += x;
  return sum;
}

function main() {
  const nums = [10, 20, 30];
  const s = total(nums);
  console.log(s, nums.length);
}
`;
    write(file, src);

    // --dry-run reports the borrow fix without touching the file.
    const dry = fishc(dir, ["fix", file, "--dry-run"]);
    assert(dry.code === 0, `dry-run failed: ${dry.out}\n${dry.err}`);
    assert(dry.out.includes("[borrow]"), `expected [borrow] fix in dry-run: ${dry.out}`);
    assert(read(file) === src, "--dry-run must not modify file");

    // --check exits 1 when fixes are needed and leaves file untouched.
    const chk = fishc(dir, ["fix", file, "--check"]);
    assert(chk.code === 1, `expected --check exit 1, got ${chk.code}`);
    assert(read(file) === src, "--check must not modify file");

    // Applying fix wraps parameter in Ref<i64[]> instead of cloning, keeping comments intact.
    const fixed = fishc(dir, ["fix", file]);
    assert(fixed.code === 0, `fix failed: ${fixed.out}\n${fixed.err}`);
    const after = read(file);
    assert(after.includes("// keep this header comment"), "comment was lost");
    assert(after.includes("function total(xs: Ref<i64[]>): i64"), `expected Ref<i64[]> parameter, got:\n${after}`);
    assert(!after.includes(".clone()"), `should prefer borrow over clone, got:\n${after}`);

    // Re-running --check now exits 0.
    const clean = fishc(dir, ["fix", file, "--check"]);
    assert(clean.code === 0, `expected --check exit 0 after fix, got ${clean.code}: ${clean.out}\n${clean.err}`);

    // Fixed program compiles and runs with expected output.
    const bin = join(dir, "app");
    const built = fishc(dir, ["build", file, "-o", bin]);
    assert(built.code === 0, `build failed after fix: ${built.err}`);
    const ran = spawnSync(bin, [], { cwd: dir });
    assert(ran.status === 0 && text(ran.stdout).trim() === "60 3", `unexpected runtime output: ${text(ran.stdout)}`);
  } finally {
    removed(dir);
  }
}, { timeout: 60_000 });

test("fishc fix prefers Mut<T> + let over clone for a mutating callee", () => {
  const dir = scratch("fish-fix-mut-");
  try {
    const file = join(dir, "mut.fsh");
    write(
      file,
      `function appendOne(xs: i64[]) {
  xs.push(99);
}

function main() {
  const nums = [1, 2];
  appendOne(nums);
  console.log(nums.length, nums[2]);
}
`,
    );
    const fixed = fishc(dir, ["fix", file]);
    assert(fixed.code === 0, `fix failed: ${fixed.out}\n${fixed.err}`);
    const after = read(file);
    assert(after.includes("function appendOne(xs: Mut<i64[]>)"), `expected Mut<i64[]>, got:\n${after}`);
    assert(after.includes("let nums = [1, 2];"), `expected const -> let, got:\n${after}`);
    assert(!after.includes(".clone()"), `should prefer Mut borrow over clone, got:\n${after}`);

    const bin = join(dir, "mut");
    assert(fishc(dir, ["build", file, "-o", bin]).code === 0, "build after mut fix failed");
    const ran = spawnSync(bin, [], { cwd: dir });
    assert(ran.status === 0 && text(ran.stdout).trim() === "3 99", `unexpected output: ${text(ran.stdout)}`);
  } finally {
    removed(dir);
  }
}, { timeout: 60_000 });

test("fishc fix falls back to .clone() when callee genuinely needs ownership or value moves out of borrow", () => {
  const dir = scratch("fish-fix-clone-");
  try {
    const file = join(dir, "clone.fsh");
    write(
      file,
      `class Box {
  items: i64[];
  constructor(items: i64[]) {
    this.items = items;
  }
}

function wrap(xs: i64[]): Box {
  return new Box(xs);
}

function copyItems(b: Ref<Box>): i64[] {
  return b.items;
}

function main() {
  const data = [4, 5];
  const box = wrap(data);
  const dup = copyItems(box);
  console.log(data.length, dup.length);
}
`,
    );
    const fixed = fishc(dir, ["fix", file]);
    assert(fixed.code === 0, `fix failed: ${fixed.out}\n${fixed.err}`);
    const after = read(file);
    assert(after.includes("wrap(data.clone())"), `expected data.clone() fallback when callee keeps ownership:\n${after}`);
    assert(after.includes("return b.items.clone();"), `expected b.items.clone() out of Ref<Box>:\n${after}`);

    const bin = join(dir, "clone");
    assert(fishc(dir, ["build", file, "-o", bin]).code === 0, "build after clone fix failed");
    const ran = spawnSync(bin, [], { cwd: dir });
    assert(ran.status === 0 && text(ran.stdout).trim() === "2 2", `unexpected output: ${text(ran.stdout)}`);
  } finally {
    removed(dir);
  }
}, { timeout: 60_000 });

test("fishc fix adds this: Mut<this>, upgrades Ref to Mut, and edits imported project files", () => {
  const dir = scratch("fish-fix-multi-");
  try {
    makeDir(join(dir, "src"));
    write(join(dir, "fish.toml"), `[package]\nname = "fixpkg"\nversion = "0.1.0"\n`);
    const helper = join(dir, "src", "helper.fsh");
    write(
      helper,
      `export function firstLen(xs: string[]): usize {
  return xs.length;
}

export class Counter {
  n: i64 = 0;

  inc(by: i64) {
    this.n += by;
  }
}

export function bump(c: Ref<Counter>) {
  c.inc(5);
}
`,
    );
    const entry = join(dir, "src", "main.fsh");
    write(
      entry,
      `import { Counter, bump, firstLen } from "./helper.fsh";

function main() {
  const words = ["hi", "fish"];
  const n = firstLen(words);
  const c = new Counter();
  bump(c);
  console.log(n, words.length, c.n);
}
`,
    );

    // Run `fishc fix` with no file argument inside package root.
    const fixed = fishc(dir, ["fix"]);
    assert(fixed.code === 0, `package fix failed: ${fixed.out}\n${fixed.err}`);
    const helperAfter = read(helper);
    const entryAfter = read(entry);
    assert(helperAfter.includes("firstLen(xs: Ref<string[]>)"), `expected Ref<string[]> in helper.fsh:\n${helperAfter}`);
    assert(helperAfter.includes("inc(this: Mut<this>, by: i64)"), `expected this: Mut<this> in helper.fsh:\n${helperAfter}`);
    assert(helperAfter.includes("bump(c: Mut<Counter>)"), `expected Ref -> Mut in helper.fsh:\n${helperAfter}`);
    assert(entryAfter.includes("let c = new Counter();"), `expected const c -> let c in main.fsh:\n${entryAfter}`);

    const bin = join(dir, "app");
    assert(fishc(dir, ["build", entry, "-o", bin]).code === 0, "build after multi-file fix failed");
    const ran = spawnSync(bin, [], { cwd: dir });
    assert(ran.status === 0 && text(ran.stdout).trim() === "2 2 5", `unexpected output: ${text(ran.stdout)}`);
  } finally {
    removed(dir);
  }
}, { timeout: 60_000 });
