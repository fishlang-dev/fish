import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build, compile, runtimeUnits } from "../src/main.ts";
import { cachedSession } from "../src/stdcache.ts";

// `fishc build --leaks`: what a program never freed, reported at exit by where it was allocated.
setDefaultTimeout(60_000);

const MAIN = join(import.meta.dir, "..", "src", "main.ts");
const session = cachedSession();
const root = mkdtempSync(join(tmpdir(), "fish-leaks-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

// A block only a C call made and nothing frees: the smallest leak Fish lets a program write.
const ALLOC = "declare function fsh_rt_alloc(size: i64): MutPtr<u8>;\n";

const LEAKY = `${ALLOC}
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

const REPORT = "fish: leaked 3 allocations (56 bytes)\n  2 allocations, 48 bytes, at main.fsh:4:12 in build\n  1 allocation, 8 bytes, at main.fsh:10:12 in main\n";

// Builds `src` as `main.fsh` in a directory of its own, then runs it, with paths in that directory
// read from its stderr.
function run(name: string, src: string, { release = false, leaks = true, env = {} }: { release?: boolean; leaks?: boolean; env?: Record<string, string> } = {}) {
  const dir = join(root, name);
  mkdirSync(dir);
  const file = join(dir, "main.fsh");
  writeFileSync(file, src);
  build(session, file, join(dir, "main"), release, "unwind", [], undefined, leaks);
  const done = Bun.spawnSync([join(dir, "main")], { cwd: dir, env: { ...process.env, FISH_LEAKS: "0", ...env } });
  return { code: done.exitCode, out: done.stdout.toString(), err: done.stderr.toString().replaceAll(`${dir}/`, "") };
}

test("a --leaks build reports what it never freed, by line, largest group first", () => {
  expect(run("two", LEAKY)).toEqual({ code: 0, out: "done\n", err: REPORT });
});

test("a --leaks build that frees everything prints nothing", () => {
  const src = `function main() {\n  const xs = [1, 2, 3].map((x) => "n" + x);\n  console.log(xs.join(","));\n}\n`;
  expect(run("clean", src)).toEqual({ code: 0, out: "n1,n2,n3\n", err: "" });
});

test("a block std makes is charged to the program's call into std", () => {
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
  const { code, err } = run("std", src);
  expect(code).toBe(0);
  expect(err).toStartWith("fish: leaked 3 allocations (");
  expect(err).toContain(" bytes, at main.fsh:8:14 in main\n");
  expect(err).toContain("  1 allocation, 4 bytes, at main.fsh:9:26 in main\n");
});

test("a spawned task's block is charged to the task's own frame", () => {
  const src = `${ALLOC}
async function work(): Promise<i64> {
  unsafe { fsh_rt_alloc(24); }
  return 1;
}

async function main() {
  const n = await spawn(work());
  console.log(n);
}
`;
  expect(run("task", src)).toEqual({ code: 0, out: "1\n", err: "fish: leaked 1 allocation (24 bytes)\n  1 allocation, 24 bytes, at main.fsh:4:12 in work\n" });
});

test("a --release --leaks build reports the same sites", () => {
  expect(run("release", LEAKY, { release: true })).toEqual({ code: 0, out: "done\n", err: REPORT });
});

test("--leaks can't build a library", () => {
  const file = join(root, "lib.fsh");
  writeFileSync(file, "export function f(): i64 { return 1; }\n");
  const done = Bun.spawnSync(["bun", MAIN, "build", file, "--lib", "--leaks", "-o", join(root, "libf.a")]);
  expect([done.exitCode, done.stderr.toString()]).toEqual([2, "fishc build: '--leaks' can't build a library; build the program that uses it with '--leaks' instead\n"]);
});

test("--leaks leaves an ordinary build's IR and runtime alone", () => {
  const file = join(root, "ir.fsh");
  writeFileSync(file, LEAKY);
  // A debug build keeps its frames either way; a release build keeps them only for --leaks.
  expect(compile(session, LEAKY, file, false, "unwind", false, true)).toBe(compile(session, LEAKY, file));
  expect(compile(session, LEAKY, file, true)).not.toContain("@fsh_rt_frames");
  expect(compile(session, LEAKY, file, true, "unwind", false, true)).toContain("@fsh_rt_frames");
  for (const release of [false, true]) {
    const [plain] = runtimeUnits("", release);
    const [leaks] = runtimeUnits("", release, false, undefined, true);
    expect(plain!.name).toBe("runtime");
    expect(plain!.args).not.toContain("-DFSH_LEAK_SITES");
    expect(leaks!.name).toBe("runtime-leaks");
    expect(leaks!.args).toEqual([...plain!.args, "-DFSH_LEAK_SITES"]);
  }
});

test("a block leaked before a panic is still reported", () => {
  const src = `${ALLOC}
function main() {
  unsafe { fsh_rt_alloc(8); }
  const xs: i64[] = [];
  console.log(xs[1]);
}
`;
  const { code, err } = run("panic", src);
  expect(code).toBe(101);
  expect(err).toContain("index out of bounds");
  expect(err).toEndWith("fish: leaked 1 allocation (8 bytes)\n  1 allocation, 8 bytes, at main.fsh:4:12 in main\n");
});

test("no report with tasks left running", () => {
  // The task never awaits, so the program can't stop it and abandons it.
  const src = `${ALLOC}
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
  expect(run("running", src)).toEqual({ code: 0, out: "left\n", err: "" });
});

test("a block the blocking pool makes is charged to the call that submitted it", () => {
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
  const { code, err } = run("pool", src);
  expect(code).toBe(0);
  expect(err).toMatch(/\n  1 allocation, \d+ bytes, at main.fsh:11:17 in main\n/);
  expect(err).not.toContain("<runtime>");
});

test("groups that tie are in line order, by number", () => {
  const src = `${ALLOC}
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
  expect(run("order", src).err).toBe("fish: leaked 2 allocations (16 bytes)\n  1 allocation, 8 bytes, at main.fsh:4:12 in main\n  1 allocation, 8 bytes, at main.fsh:11:12 in main\n");
});

test("one byte is one byte", () => {
  const src = `${ALLOC}\nfunction main() {\n  unsafe { fsh_rt_alloc(1); }\n}\n`;
  expect(run("byte", src).err).toBe("fish: leaked 1 allocation (1 byte)\n  1 allocation, 1 byte, at main.fsh:4:12 in main\n");
});

test("a size the header would overflow runs out of memory, as an ordinary build does", () => {
  const src = `${ALLOC}\nfunction main() {\n  unsafe { fsh_rt_alloc(-1); }\n  console.log("allocated");\n}\n`;
  const expected = { code: 101, out: "", err: "out of memory\n" };
  expect(run("negative", src)).toEqual(expected);
  expect(run("negative-plain", src, { leaks: false })).toEqual(expected);
});

test("FISH_LEAKS=1 still counts in an ordinary build", () => {
  expect(run("count", LEAKY, { leaks: false, env: { FISH_LEAKS: "1" } })).toEqual({ code: 0, out: "done\n", err: "fish: leaked 3 allocations\n" });
});

test("the usage text lists --leaks", () => {
  const bad = Bun.spawnSync(["bun", MAIN, "build", "x.fsh", "--panic=no"], { cwd: root });
  expect(bad.exitCode).toBe(2);
  expect(bad.stderr.toString()).toContain("[--lib[=static|shared]] [--target <triple>] [--sysroot <dir>] [--leaks] [--emit-llvm]");
});
