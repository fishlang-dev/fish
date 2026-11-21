// `fishc build --leaks`, what a program never freed, reported at exit by
// where it was allocated, each program built by the native fishc. The runtime's compile flags are
// read from what the native fishc hands clang, through a clang on PATH that logs each runtime
// compile and stops the build there.
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fishc, removed, runtimeArgs, same, scratch, text } from "./support.fsh";

// A block only a C call made and nothing frees: the smallest leak Fish lets a program write.
function alloc(): string {
  return "declare function fsh_rt_alloc(size: i64): MutPtr<u8>;\n";
}

function leaky(): string {
  return `${alloc()}
function build(n: i64) {
  unsafe { fsh_rt_alloc(n); }
}

function main() {
  build(16);
  build(32);
  unsafe { fsh_rt_alloc(8); }
  console.log("done");
}
`;
}

function report(): string {
  return "fish: leaked 3 allocations (56 bytes)\n  2 allocations, 48 bytes, at main.fsh:4:12 in build\n  1 allocation, 8 bytes, at main.fsh:10:12 in main\n";
}

function write(path: string, contents: string): void {
  try {
    writeFileSync(path, contents);
  } catch (e) {
    assert(false, `can't write ${path}: ${e.message}`);
  }
}

type Outcome = { code: i64; out: string; err: string };

function shown(o: Ref<Outcome>): string {
  return `code ${o.code}\nstdout:\n${o.out}\nstderr:\n${o.err}`;
}

function equal(got: Ref<Outcome>, want: Ref<Outcome>, what: string): void {
  assert(got === want, `${what}:\n--- expected\n${shown(want)}\n--- got\n${shown(got)}`);
}

// Builds `src` as `main.fsh` in the directory `name` under `root`, then runs it there with
// FISH_LEAKS=0 and `vars`, with paths in that directory read from its stderr.
function run(root: string, name: string, src: string, release: boolean, leaks: boolean, vars: string[]): Outcome {
  const dir = join(root, name);
  try {
    mkdirSync(dir);
  } catch (e) {
    assert(false, `can't make ${dir}: ${e.message}`);
  }
  const file = join(dir, "main.fsh");
  write(file, src);
  let args = ["build", file, "-o", join(dir, "main")];
  if (release) args.push("--release");
  if (leaks) args.push("--leaks");
  const built = fishc(dir, args);
  // Warnings are printed and the build goes on.
  assert(built.code === 0, `building ${name} exited with ${built.code}:\n${built.err}`);
  const done = spawnSync("env", ["FISH_LEAKS=0", ...vars, join(dir, "main")], { cwd: dir });
  return { code: done.status ?? -1, out: text(done.stdout), err: text(done.stderr).replaceAll(`${dir}/`, "") };
}

test("a --leaks build reports what it never freed, by line, largest group first", () => {
  const root = scratch("fish-leaks-");
  equal(run(root, "two", leaky(), false, true, []), { code: 0, out: "done\n", err: report() }, "the run");
  removed(root);
}, { timeout: 60_000 });

test("a --leaks build that frees everything prints nothing", () => {
  const root = scratch("fish-leaks-");
  const src = `function main() {\n  const xs = [1, 2, 3].map((x) => "n" + x);\n  console.log(xs.join(","));\n}\n`;
  equal(run(root, "clean", src, false, true, []), { code: 0, out: "n1,n2,n3\n", err: "" }, "the run");
  removed(root);
}, { timeout: 60_000 });

// Each generator finishes in the call that sent it a string: the value it took or dropped there
// is freed once, and one sent after it finished is freed too.
test("a --leaks build of generators finishing after a sent string frees each value once", () => {
  const root = scratch("fish-leaks-");
  const src = 'function* takes(): Generator<string, void, string> {\n  const x = yield "a";\n  console.log("got", x);\n}\n\nfunction* drops(): Generator<string, void, string> {\n  yield "a";\n}\n\nfunction* never(): Generator<string, void, string> {\n  console.log("ran");\n}\n\nfunction* stops(): Generator<string, void, string> {\n  while (true) {\n    const x = yield "more";\n    if (x === "stop1") return;\n    console.log("kept", x);\n  }\n}\n\nfunction main() {\n  let a = takes();\n  a.next();\n  console.log(a.next("hi" + 1).done);\n  console.log(a.next("late" + 1).done);\n  let b = drops();\n  b.next();\n  console.log(b.next("hi" + 2).done);\n  let c = never();\n  console.log(c.next("hi" + 3).done);\n  let d = stops();\n  d.next();\n  d.next("go" + 1);\n  console.log(d.next("stop" + 1).done);\n}\n';
  equal(run(root, "sent", src, false, true, []), { code: 0, out: "got hi1\ntrue\ntrue\ntrue\nran\ntrue\nkept go1\ntrue\n", err: "" }, "the run");
  removed(root);
}, { timeout: 60_000 });

test("a block std makes is charged to the program's call into std", () => {
  const root = scratch("fish-leaks-");
  // The channel holds a node holding the channel, so neither is ever dropped.
  const src = `class Node {
  bytes: u8[];
  next: Channel<Node>;
  constructor(bytes: u8[], next: Channel<Node>) { this.bytes = bytes; this.next = next; }
}

async function main() {
  const ch = new Channel<Node>(1);
  await ch.send(new Node(new TextEncoder().encode("leak"), ch.clone()));
}
`;
  const got = run(root, "std", src, false, true, []);
  assert(got.code === 0, `exited with ${got.code}`);
  assert(got.err.startsWith("fish: leaked 3 allocations ("), `stderr:\n${got.err}`);
  assert(got.err.includes(" bytes, at main.fsh:8:14 in main\n"), `stderr:\n${got.err}`);
  assert(got.err.includes("  1 allocation, 4 bytes, at main.fsh:9:26 in main\n"), `stderr:\n${got.err}`);
  removed(root);
}, { timeout: 60_000 });

test("a spawned task's block is charged to the task's own frame", () => {
  const root = scratch("fish-leaks-");
  const src = `${alloc()}
async function work(): Promise<i64> {
  unsafe { fsh_rt_alloc(24); }
  return 1;
}

async function main() {
  const n = await spawn(work());
  console.log(n);
}
`;
  equal(run(root, "task", src, false, true, []), { code: 0, out: "1\n", err: "fish: leaked 1 allocation (24 bytes)\n  1 allocation, 24 bytes, at main.fsh:4:12 in work\n" }, "the run");
  removed(root);
}, { timeout: 60_000 });

test("a --release --leaks build reports the same sites", () => {
  const root = scratch("fish-leaks-");
  equal(run(root, "release", leaky(), true, true, []), { code: 0, out: "done\n", err: report() }, "the run");
  removed(root);
}, { timeout: 60_000 });

test("--leaks can't build a library", () => {
  const root = scratch("fish-leaks-");
  const file = join(root, "lib.fsh");
  write(file, "export function f(): i64 { return 1; }\n");
  const done = fishc(root, ["build", file, "--lib", "--leaks", "-o", join(root, "libf.a")]);
  same(`${done.code} ${done.err}`, "2 fishc build: '--leaks' can't build a library; build the program that uses it with '--leaks' instead\n", "the exit code and stderr");
  removed(root);
}, { timeout: 60_000 });

// The IR the native fishc emits for `file` with `flags`.
function emitted(file: string, flags: string[]): string {
  const run = fishc(join(file, ".."), ["build", file, "--emit-llvm", ...flags]);
  same(run.err, "", `emitting ${file} with ${flags.join(" ")}`);
  assert(run.code === 0, `emitting ${file} exited with ${run.code}`);
  return run.out;
}

test("--leaks leaves an ordinary build's IR and runtime alone", () => {
  const root = scratch("fish-leaks-");
  const file = join(root, "ir.fsh");
  write(file, leaky());
  // A debug build keeps its frames either way; a release build keeps them only for --leaks.
  same(emitted(file, ["--leaks"]), emitted(file, []), "a debug build's IR with --leaks");
  assert(!emitted(file, ["--release"]).includes("@fsh_rt_frames"), "a release build's IR keeps its frames");
  assert(emitted(file, ["--release", "--leaks"]).includes("@fsh_rt_frames"), "a --release --leaks build's IR has no frames");
  for (const release of [false, true]) {
    const base: string[] = release ? ["--release"] : [];
    const [plain, plainName] = runtimeArgs(root, file, base.clone());
    const [leaks, leaksName] = runtimeArgs(root, file, [...base, "--leaks"]);
    assert(plainName.startsWith("runtime") && !plainName.startsWith("runtime-leaks"), `the plain runtime's object: ${plainName}`);
    assert(!` ${plain} `.includes(" -DFSH_LEAK_SITES "), `the plain runtime's flags: ${plain}`);
    assert(leaksName.startsWith("runtime-leaks"), `the --leaks runtime's object: ${leaksName}`);
    same(leaks, `${plain} -DFSH_LEAK_SITES`, `the --leaks runtime's flags${release ? " in a release build" : ""}`);
  }
  removed(root);
}, { timeout: 60_000 });

test("a block leaked before a panic is still reported", () => {
  const root = scratch("fish-leaks-");
  const src = `${alloc()}
function main() {
  unsafe { fsh_rt_alloc(8); }
  const xs: i64[] = [];
  console.log(xs[1]);
}
`;
  const got = run(root, "panic", src, false, true, []);
  assert(got.code === 101, `exited with ${got.code}`);
  assert(got.err.includes("index out of bounds"), `stderr:\n${got.err}`);
  assert(got.err.endsWith("fish: leaked 1 allocation (8 bytes)\n  1 allocation, 8 bytes, at main.fsh:4:12 in main\n"), `stderr:\n${got.err}`);
  removed(root);
}, { timeout: 60_000 });

test("no report with tasks left running", () => {
  const root = scratch("fish-leaks-");
  // The task never awaits, so the program can't stop it and abandons it.
  const src = `${alloc()}
async function spin(): Promise<void> {
  unsafe { fsh_rt_alloc(8); }
  while (true) {}
}

async function main() {
  const h = spawn(spin());
  await sleep(50);
  console.log("left");
}
`;
  equal(run(root, "running", src, false, true, []), { code: 0, out: "left\n", err: "" }, "the run");
  removed(root);
}, { timeout: 60_000 });

test("a block the blocking pool makes is charged to the call that submitted it", () => {
  const root = scratch("fish-leaks-");
  const src = `import { readFile } from "node:fs/promises";

class Node {
  bytes: u8[];
  next: Channel<Node>;
  constructor(bytes: u8[], next: Channel<Node>) { this.bytes = bytes; this.next = next; }
}

async function main(): Promise<void> throws IoError {
  const ch = new Channel<Node>(1);
  const bytes = await readFile("main.fsh");
  await ch.send(new Node(bytes, ch.clone()));
}
`;
  const got = run(root, "pool", src, false, true, []);
  assert(got.code === 0, `exited with ${got.code}`);
  assert(/\n  1 allocation, \d+ bytes, at main.fsh:11:17 in main\n/.test(got.err), `stderr:\n${got.err}`);
  assert(!got.err.includes("<runtime>"), `stderr:\n${got.err}`);
  removed(root);
}, { timeout: 60_000 });

test("groups that tie are in line order, by number", () => {
  const root = scratch("fish-leaks-");
  const src = `${alloc()}
function main() {
  unsafe { fsh_rt_alloc(8); }
  console.log(1);
  console.log(2);
  console.log(3);
  console.log(4);
  console.log(5);
  console.log(6);
  unsafe { fsh_rt_alloc(8); }
}
`;
  same(run(root, "order", src, false, true, []).err, "fish: leaked 2 allocations (16 bytes)\n  1 allocation, 8 bytes, at main.fsh:4:12 in main\n  1 allocation, 8 bytes, at main.fsh:11:12 in main\n", "stderr");
  removed(root);
}, { timeout: 60_000 });

test("one byte is one byte", () => {
  const root = scratch("fish-leaks-");
  const src = `${alloc()}\nfunction main() {\n  unsafe { fsh_rt_alloc(1); }\n}\n`;
  same(run(root, "byte", src, false, true, []).err, "fish: leaked 1 allocation (1 byte)\n  1 allocation, 1 byte, at main.fsh:4:12 in main\n", "stderr");
  removed(root);
}, { timeout: 60_000 });

test("a size the header would overflow runs out of memory, as an ordinary build does", () => {
  const root = scratch("fish-leaks-");
  const src = `${alloc()}\nfunction main() {\n  unsafe { fsh_rt_alloc(-1); }\n  console.log("allocated");\n}\n`;
  const expected: Outcome = { code: 101, out: "", err: "out of memory\n" };
  equal(run(root, "negative", src, false, true, []), expected, "the --leaks run");
  equal(run(root, "negative-plain", src, false, false, []), expected, "the plain run");
  removed(root);
}, { timeout: 60_000 });

test("FISH_LEAKS=1 still counts in an ordinary build", () => {
  const root = scratch("fish-leaks-");
  equal(run(root, "count", leaky(), false, false, ["FISH_LEAKS=1"]), { code: 0, out: "done\n", err: "fish: leaked 3 allocations\n" }, "the run");
  removed(root);
}, { timeout: 60_000 });

test("the usage text lists --leaks", () => {
  const root = scratch("fish-leaks-");
  const bad = fishc(root, ["build", "x.fsh", "--panic=no"]);
  assert(bad.code === 2, `exited with ${bad.code}`);
  assert(bad.err.includes("[--lib[=static|shared]] [--target <triple>] [--sysroot <dir>] [--static [--dockerfile]] [--leaks] [--timings] [--emit-llvm]"), `stderr:\n${bad.err}`);
  removed(root);
}, { timeout: 60_000 });
