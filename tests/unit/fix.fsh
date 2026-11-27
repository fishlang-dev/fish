// `fishc fix`: machine-applicable edits on borrow, move, and mutability errors, preferring
// borrows (`Ref<T>`, `Mut<T>`) over `.clone()` via trial-verified re-checking.
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
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

function link(target: string, at: string): void {
  try {
    symlinkSync(target, at);
  } catch (e) {
    assert(false, `can't symlink ${at}: ${e.message}`);
  }
}

test("fishc fix prefers Ref<T> borrow over clone for read-only callee and preserves comments", () => {
  const dir = scratch("fish-fix-borrow-");
  try {
    const file = join(dir, "app.fsh");
    const src = `// keep this header comment
export function total(xs: i64[]): i64 {
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
    assert(helperAfter.includes("firstLen(xs: string[])"), `a function only its own package calls borrows what it only reads without a fix:\n${helperAfter}`);
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

test("fishc fix handles standalone library without main and upgrades this: Ref<this> to this: Mut<this>", () => {
  const dir = scratch("fish-fix-lib-");
  try {
    const file = join(dir, "lib.fsh");
    write(
      file,
      `export class Acc {
  total: i64 = 0;

  add(this: Ref<this>, delta: i64): i64 {
    this.total += delta;
    return this.total;
  }
}

export function sizeOf(xs: i64[]): usize {
  return xs.length;
}

export function demo(): usize {
  const nums = [1, 2, 3];
  const n = sizeOf(nums);
  return n + nums.length;
}
`,
    );
    const fixed = fishc(dir, ["fix", file]);
    assert(fixed.code === 0, `standalone library fix failed: ${fixed.out}\n${fixed.err}`);
    const after = read(file);
    assert(after.includes("add(this: Mut<this>, delta: i64): i64"), `expected this: Ref<this> upgraded to Mut:\n${after}`);
    assert(after.includes("sizeOf(xs: Ref<i64[]>): usize"), `expected Ref<i64[]> on library function:\n${after}`);
  } finally {
    removed(dir);
  }
}, { timeout: 60_000 });

test("fishc fix avoids breaking typed callbacks and export default callees, falling back to .clone()", () => {
  const dir = scratch("fish-fix-cb-");
  try {
    makeDir(join(dir, "src"));
    write(join(dir, "fish.toml"), `[package]\nname = "fixcb"\nversion = "0.1.0"\n`);
    const exp = join(dir, "src", "wrap.fsh");
    write(
      exp,
      `export class Holder {
  items: i64[];
  constructor(items: i64[]) {
    this.items = items;
  }
}

export default function keep(xs: i64[]): Holder {
  return new Holder(xs);
}
`,
    );
    const entry = join(dir, "src", "main.fsh");
    write(
      entry,
      `import keep from "./wrap.fsh";

function takeOwned(xs: i64[]): usize {
  return xs.length;
}

function useTakeOwned1(): usize {
  const nums = [1, 2, 3];
  const a = takeOwned(nums);
  return a + nums.length;
}

function useTakeOwned2(): usize {
  const nums = [4, 5, 6];
  const a = takeOwned(nums);
  return a + nums.length;
}

function main() {
  const cb: (xs: i64[]) => usize = takeOwned;
  const nums = [1, 2, 3];
  const a = useTakeOwned1();
  const b = useTakeOwned2();
  const c = cb(nums);
  const h = keep(nums);
  console.log(a, b, c, h.items.length, nums.length);
}
`,
    );
    const fixed = fishc(dir, ["fix"]);
    assert(fixed.code === 0, `callback/default fix failed: ${fixed.out}\n${fixed.err}`);
    const entryAfter = read(entry);
    const expAfter = read(exp);
    assert(entryAfter.includes("function takeOwned(xs: i64[]): usize"), `callback-typed callee signature must stay owned:\n${entryAfter}`);
    assert(expAfter.includes("export default function keep(xs: i64[]): Holder"), `export default owning callee signature must stay owned:\n${expAfter}`);
    assert(entryAfter.includes("takeOwned(nums.clone())"), `expected .clone() at callback-constrained call:\n${entryAfter}`);

    const bin = join(dir, "app");
    assert(fishc(dir, ["build", entry, "-o", bin]).code === 0, "build after callback/default fix failed");
    const ran = spawnSync(bin, [], { cwd: dir });
    assert(ran.status === 0 && text(ran.stdout).trim() === "6 6 3 3 3", `unexpected output: ${text(ran.stdout)}`);
  } finally {
    removed(dir);
  }
}, { timeout: 60_000 });

test("fishc fix handles intra-project symlinked imports and parenthesizes lower-precedence clone expressions", () => {
  const dir = scratch("fish-fix-sym-");
  try {
    makeDir(join(dir, "src"));
    write(join(dir, "fish.toml"), `[package]\nname = "fixsym"\nversion = "0.1.0"\n`);
    const real = join(dir, "src", "real.fsh");
    write(
      real,
      `export class Bag {
  vals: i64[];
  constructor(vals: i64[]) {
    this.vals = vals;
  }
  size(): usize {
    return this.vals.length;
  }
}

export function count(b: Bag): usize {
  return b.size();
}
`,
    );
    link(real, join(dir, "src", "link.fsh"));
    const entry = join(dir, "src", "main.fsh");
    write(
      entry,
      `import { Bag, count } from "./link.fsh";

class Wrap {
  vals: i64[];
  constructor(vals: i64[]) {
    this.vals = vals;
  }
}

function pickOr(maybe: Ref<i64[]> | undefined, w: Ref<Wrap>): i64[] {
  return maybe ?? w.vals;
}

function main() {
  const bag = new Bag([7, 8]);
  const n = count(bag);
  const w = new Wrap([1, 2, 3]);
  const picked = pickOr(undefined, w);
  console.log(n, bag.vals.length, picked.length);
}
`,
    );
    const fixed = fishc(dir, ["fix"]);
    assert(fixed.code === 0, `symlink/parens fix failed: ${fixed.out}\n${fixed.err}`);
    const realAfter = read(real);
    const entryAfter = read(entry);
    assert(realAfter.includes("count(b: Ref<Bag>): usize"), `expected Ref<Bag> through intra-project symlink:\n${realAfter}`);
    assert(entryAfter.includes("(maybe ?? w.vals).clone()"), `expected parenthesized clone on binary expression:\n${entryAfter}`);

    const bin = join(dir, "app");
    assert(fishc(dir, ["build", entry, "-o", bin]).code === 0, "build after symlink/parens fix failed");
    const ran = spawnSync(bin, [], { cwd: dir });
    assert(ran.status === 0 && text(ran.stdout).trim() === "2 2 3", `unexpected output: ${text(ran.stdout)}`);
  } finally {
    removed(dir);
  }
}, { timeout: 60_000 });
