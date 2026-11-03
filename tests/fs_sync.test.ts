import { expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Each test builds a program with clang, which can take past bun's 5 seconds on a busy CI runner.
setDefaultTimeout(30_000);

// The std `fs` module's blocking calls against node's: the same calls in a directory of their
// own, output compared.
const tmp = mkdtempSync(join(tmpdir(), "fish-fs-sync-"));

// `setup` makes the same files in both directories first; absolute paths print as `<dir>`.
// `waits` runs the body in an async main.
function compare(name: string, imports: string, body: string, setup: (dir: string) => void = () => {}, nodeBody = body, waits = false) {
  const fishDir = mkdtempSync(join(tmp, `${name}-fish-`));
  const nodeDir = mkdtempSync(join(tmp, `${name}-node-`));
  setup(fishDir);
  setup(nodeDir);
  const program = join(tmp, `${name}.fsh`);
  writeFileSync(program, `${imports}\n${waits ? "async function main(): Promise<void>" : "function main(): void"} throws IoError {${body}\n}\n`);
  const out = join(tmp, name);
  const built = Bun.spawnSync(["bun", join(import.meta.dir, "..", "src", "main.ts"), "build", program, "-o", out]);
  expect(built.stderr.toString()).toBe("");
  const fish = Bun.spawnSync([out], { cwd: fishDir, env: { ...process.env, FISH_LEAKS: "1" } });
  const script = `const fs = require("node:fs"); const { readFileSync, writeFileSync, existsSync, statSync, lstatSync, readdirSync, realpathSync, mkdtempSync, rmSync, symlinkSync, mkdirSync, renameSync, copyFileSync, unlinkSync, constants, openSync, readSync, writeSync, closeSync, fstatSync, ftruncateSync, fchmodSync, fsyncSync } = fs; const { open } = require("node:fs/promises"); (${waits ? "async " : ""}() => {${nodeBody}\n})();`;
  const node = Bun.spawnSync(["node", "-e", script], { cwd: nodeDir });
  expect(fish.stderr.toString()).toBe("");
  expect(node.stderr.toString()).toBe("");
  const shown = (out: Buffer, dir: string) => out.toString().replaceAll(realpathSync(dir), "<dir>");
  expect(shown(fish.stdout, fishDir)).toBe(shown(node.stdout, nodeDir));
}

test("readFileSync, writeFileSync and existsSync give what node's give", () => {
  compare("rw", `import { readFileSync, writeFileSync, existsSync } from "node:fs";\nimport * as fs from "fs";`, `
  writeFileSync("a.txt", "héllo\\nworld");
  const bytes = readFileSync("a.txt");
  const text = readFileSync("a.txt", "utf8");
  const again = fs.readFileSync("a.txt", { encoding: "utf8" });
  console.log(bytes.length, text, again === text);
  fs.writeFileSync("b.dat", new TextEncoder().encode("bytes"));
  console.log(readFileSync("b.dat", "utf-8"), existsSync("b.dat"), existsSync("."), existsSync("nope"), existsSync(""));
  for (const p of ["missing.txt", ".", "a.txt/nested"]) {
    try {
      readFileSync(p);
      console.log("read", p);
    } catch (e) {
      console.log(e.message, e.code, e.syscall);
    }
  }
  try {
    writeFileSync("no/such/dir/x.txt", "x");
  } catch (e) {
    console.log(e.message, e.code, e.syscall);
  }`);
});

test("statSync, lstatSync, readdirSync, realpathSync, mkdtempSync and rmSync give what node's give", () => {
  const imports = `import { writeFileSync, existsSync, statSync, lstatSync, readdirSync, realpathSync, mkdtempSync, rmSync } from "node:fs";`;
  compare("meta", imports, `
  const s = statSync("d/f.txt");
  console.log(s.size, s.mode, s.isFile(), s.isDirectory(), s.isSymbolicLink(), s.mtimeMs > 0);
  const d = statSync("d");
  console.log(d.isDirectory(), d.mode, lstatSync("ln").isSymbolicLink(), statSync("ln").isFile(), lstatSync("d/f.txt").isSymbolicLink());
  console.log(readdirSync("."), readdirSync("d"));
  console.log(realpathSync("ln"), realpathSync("d/../d/f.txt"));
  const t = mkdtempSync("tmp-");
  console.log(t.length, t.startsWith("tmp-"), statSync(t).isDirectory());
  writeFileSync(t + "/inner.txt", "x");
  rmSync(t, { recursive: true });
  rmSync("missing", { force: true });
  rmSync("d/f.txt");
  console.log(existsSync(t), existsSync("d/f.txt"), readdirSync("."));
  for (const p of ["missing", "d/missing/x"]) {
    try { statSync(p); } catch (e) { console.log(e.message, e.code, e.syscall); }
    try { lstatSync(p); } catch (e) { console.log(e.message, e.code, e.syscall); }
    try { readdirSync(p); } catch (e) { console.log(e.message, e.code, e.syscall); }
    try { realpathSync(p); } catch (e) { console.log(e.message, e.code, e.syscall); }
    try { rmSync(p); } catch (e) { console.log(e.message, e.code, e.syscall); }
  }
  try { readdirSync("ln"); } catch (e) { console.log(e.message, e.code, e.syscall); }
  try { mkdtempSync("nope/x-"); } catch (e) { console.log(e.message, e.code, e.syscall); }
  try { rmSync("d"); } catch (e) { console.log(e.message, e.code, e.syscall); }`, (dir) => {
    mkdirSync(join(dir, "d"));
    writeFileSync(join(dir, "d", "f.txt"), "abc");
    writeFileSync(join(dir, "d", "b.txt"), "");
    symlinkSync("d/f.txt", join(dir, "ln"));
  });
});

test("a failing realpathSync names the part node's walk stops at", () => {
  compare("realpath", `import { realpathSync } from "node:fs";`, `
  console.log(realpathSync(""), realpathSync("lnd/.."));
  for (const p of ["dangling", "dangling/x", "lnd/missing", "lnd/../missing", "real/../nope", "loop1", "loop1/x"]) {
    try { realpathSync(p); } catch (e) { console.log(e.message, e.code, e.syscall); }
  }`, (dir) => {
    mkdirSync(join(dir, "real", "deep"), { recursive: true });
    symlinkSync("nowhere", join(dir, "dangling"));
    symlinkSync("real/deep", join(dir, "lnd"));
    symlinkSync("loop2", join(dir, "loop1"));
    symlinkSync("loop1", join(dir, "loop2"));
  });
});

test("mkdirSync makes a directory, or with recursive its missing parents, as node's does", () => {
  compare("mkdir", `import { mkdirSync, statSync, realpathSync } from "node:fs";`, `
  console.log(mkdirSync("a") === undefined, mkdirSync("x/y/z", { recursive: true }), mkdirSync("x/y", { recursive: true }) === undefined);
  console.log(mkdirSync("p/q/", { recursive: true }), mkdirSync("r/./s/../t", { recursive: true }), statSync("r/s/../t").isDirectory());
  console.log(mkdirSync(realpathSync(".") + "/abs/b", { recursive: true }));
  mkdirSync("m1", { mode: 0o700 });
  mkdirSync("m2", 0o750);
  console.log(statSync("m1").mode & 0o777, statSync("m2").mode & 0o777);
  const cases: [string, boolean][] = [["a", false], ["f", false], ["x/missing/y", false], ["f", true], ["f/q/r", true], ["", false], ["", true]];
  for (const [p, recursive] of cases) {
    try { mkdirSync(p, { recursive }); } catch (e) { console.log(e.message, e.code, e.syscall, e.path === p); }
  }`, (dir) => writeFileSync(join(dir, "f"), "hi"));
});

test("renameSync, copyFileSync and unlinkSync give what node's give", () => {
  const imports = `import { readFileSync, writeFileSync, statSync, lstatSync, existsSync, readdirSync, renameSync, copyFileSync, unlinkSync, constants } from "node:fs";\nimport * as fs from "fs";`;
  compare("move", imports, `
  renameSync("f", "a/g");
  renameSync("a/g", "f");
  copyFileSync("f", "c");
  writeFileSync("c2", "long text here");
  fs.copyFileSync("f", "c2");
  copyFileSync("f", "c3", constants.COPYFILE_EXCL);
  copyFileSync("f", "c4", fs.constants.COPYFILE_FICLONE);
  copyFileSync("f", "f");
  copyFileSync("lf", "cl");
  writeFileSync("c9", "old old");
  copyFileSync("f", "c9", constants.COPYFILE_FICLONE);
  copyFileSync("lf", "cl2", constants.COPYFILE_FICLONE);
  copyFileSync("f", "dl");
  console.log(readFileSync("c9", "utf8"), lstatSync("cl2").isSymbolicLink(), lstatSync("dl").isSymbolicLink(), readFileSync("made", "utf8"), statSync("c").mtimeMs === statSync("f").mtimeMs);
  console.log(readFileSync("c", "utf8"), readFileSync("c2", "utf8"), readFileSync("c3", "utf8"), readFileSync("f", "utf8"));
  console.log(statSync("c").mode === statSync("f").mode, lstatSync("cl").isSymbolicLink());
  unlinkSync("c");
  unlinkSync("ln");
  console.log(existsSync("c"), readdirSync("."));
  const pairs: [string, string][] = [["nope", "a/h"], ["a/missing", "zz/g"], ["md", "x"]];
  for (const [from, to] of pairs) {
    try { renameSync(from, to); } catch (e) { console.log(e.message, e.code, e.syscall, e.path ?? "none"); }
  }
  const copies: [string, string, i64][] = [["f", "c3", 1], ["nope", "c5", 0], ["a", "c6", 0], ["f", "a", 0], ["f", "zz/c", 0], ["f", "c7", 8], ["f", "c8", 4]];
  for (const [from, to, mode] of copies) {
    // A mode out of range is node's RangeError, with no system call; Fish's IoError gives "".
    try { copyFileSync(from, to, mode); } catch (e) { console.log(e.message, e.code, e.code === "ERR_OUT_OF_RANGE" ? "-" : e.syscall, e.path ?? "none"); }
  }
  for (const p of ["c", "a", "f/x"]) {
    try { unlinkSync(p); } catch (e) { console.log(e.message, e.code, e.syscall, e.path ?? "none"); }
  }
  console.log(readdirSync("."));`, (dir) => {
    writeFileSync(join(dir, "f"), "hi");
    mkdirSync(join(dir, "a"));
    mkdirSync(join(dir, "md"));
    mkdirSync(join(dir, "x", "y"), { recursive: true });
    symlinkSync("f", join(dir, "lf"));
    symlinkSync("nowhere", join(dir, "ln"));
    symlinkSync("made", join(dir, "dl"));
  });
});

test("openSync, readSync, writeSync and the other descriptor calls give what node's give", () => {
  const imports = `import { readFileSync, writeFileSync, statSync, openSync, readSync, writeSync, closeSync, fstatSync, ftruncateSync, fchmodSync, fsyncSync } from "node:fs";\nimport * as fs from "fs";`;
  compare("fd", imports, `
  const text = new TextDecoder();
  const fd = openSync("f", "r+");
  let b = new Uint8Array(4);
  console.log(readSync(fd, b, 0, 4, 0), text.decode(b), readSync(fd, b), readSync(fd, b, 1, 3), text.decode(b));
  console.log(readSync(fd, b, 0, 4, -1), readSync(fd, b, 0, 4, null), readSync(fd, b, 0, 0), readSync(fd, b, 4, 0), readSync(fd, b, 0, 2, 100));
  console.log(writeSync(fd, "XY", 0), writeSync(fd, "Zé"), writeSync(fd, b, 1, 2, 12), fs.writeSync(fd, b, 3), writeSync(fd, ""), writeSync(fd, "ab", -2, "utf8"));
  console.log(readFileSync("f", "utf8"));
  const s = fstatSync(fd);
  console.log(s.size, s.isFile(), s.isDirectory(), s.mode === statSync("f").mode, s.mtimeMs === statSync("f").mtimeMs);
  ftruncateSync(fd, 3);
  console.log(readFileSync("f", "utf8"));
  ftruncateSync(fd, -5);
  fchmodSync(fd, 0o600);
  fsyncSync(fd);
  console.log(statSync("f").size, statSync("f").mode & 0o777);
  closeSync(fd);
  let empty = new Uint8Array(0);
  const reads: [i64, i64, i64 | null][] = [[-1, 2, null], [0, -1, null], [3, 2, null], [0, 2, -2], [0, 2, 9007199254740992], [0, 5, null]];
  const g = openSync("g", "r");
  for (const [offset, length, position] of reads) {
    try { readSync(g, b, offset, length, position); } catch (e) { console.log(e.message, e.code); }
  }
  try { readSync(g, empty, 0, 1); } catch (e) { console.log(e.message, e.code); }
  console.log(readSync(g, empty));
  const writes: [i64, i64][] = [[-1, 0], [5, 0], [0, -1], [0, 5], [1, 4]];
  for (const [offset, length] of writes) {
    try { writeSync(g, b, offset, length); } catch (e) { console.log(e.message, e.code); }
  }
  try { writeSync(g, "x"); } catch (e) { console.log(e.message, e.code, e.syscall, e.path ?? "none"); }
  closeSync(g);
  try { readSync(g, b); } catch (e) { console.log(e.message, e.code, e.syscall, e.path ?? "none"); }
  try { writeSync(g, b); } catch (e) { console.log(e.message, e.code, e.syscall); }
  try { fstatSync(g); } catch (e) { console.log(e.message, e.code, e.syscall); }
  try { ftruncateSync(g); } catch (e) { console.log(e.message, e.code, e.syscall); }
  try { fchmodSync(g, 0o644); } catch (e) { console.log(e.message, e.code, e.syscall); }
  try { fsyncSync(g); } catch (e) { console.log(e.message, e.code, e.syscall); }
  try { closeSync(g); } catch (e) { console.log(e.message, e.code, e.syscall); }
  const fds: i64[] = [-1, 2147483648, 4294967297, -4294967297];
  for (const n of fds) {
    try { closeSync(n); } catch (e) { console.log(e.message, e.code); }
    try { readSync(n, b); } catch (e) { console.log(e.message, e.code); }
    try { fs.writeSync(n, "x"); } catch (e) { console.log(e.message, e.code); }
  }
  try { readSync(g, b, 0, 4294967297); } catch (e) { console.log(e.message, e.code); }
  console.log(readSync(g, b, 0, -1099511627776));
  try { writeSync(g, b, 0, -1099511627776); } catch (e) { console.log(e.message, e.code); }
  try { fchmodSync(4294967297, 4294967297); } catch (e) { console.log(e.message, e.code); }
  try { ftruncateSync(4294967297, 1); } catch (e) { console.log(e.message, e.code); }
  try { ftruncateSync(0, 9007199254740992); } catch (e) { console.log(e.message, e.code); }
  try { fchmodSync(0, -1); } catch (e) { console.log(e.message, e.code); }
  const d = openSync(".");
  try { readSync(d, b); } catch (e) { console.log(e.message, e.code, e.syscall); }
  closeSync(d);
  const w = openSync("w", "w", 0o640);
  console.log(statSync("w").mode & 0o777);
  try { readSync(w, b); } catch (e) { console.log(e.message, e.code, e.syscall); }
  writeSync(w, "one");
  closeSync(w);
  const a = openSync("w", "a");
  writeSync(a, "two");
  closeSync(a);
  closeSync(openSync("w", "a+"));
  closeSync(openSync("new", "wx+"));
  closeSync(openSync("g", "rs+"));
  closeSync(openSync("g", 0));
  console.log(readFileSync("w", "utf8"), readFileSync("new", "utf8").length);
  const opens: [string, string, i64][] = [["missing", "r", 0o666], ["missing", "r+", 0o666], ["g", "wx", 0o666], ["g", "xa+", 0o666], ["g", "bogus", 0o666], [".", "w", 0o666], ["", "r", 0o666], ["q", "w", -1], ["q", "w", 4294967296], ["a\\0b", "r", 0o666]];
  for (const [path, flags, mode] of opens) {
    try { closeSync(openSync(path, flags, mode)); } catch (e) { console.log(e.message, e.code, e.code.startsWith("ERR_") ? "-" : e.syscall, e.path ?? "none"); }
  }`, (dir) => {
    writeFileSync(join(dir, "f"), "hello world");
    writeFileSync(join(dir, "g"), "abc");
  });
});

test("open gives a FileHandle whose calls give what node's give, closed when dropped", () => {
  const imports = `import { readFileSync, statSync, openSync, closeSync } from "node:fs";\nimport { open } from "node:fs/promises";`;
  const body = `
  const text = new TextDecoder();
  const fh = await open("f", "r+");
  let b = new Uint8Array(4);
  const first = await fh.read(b, 0, 4, 0);
  console.log(fh.fd > 2, first.bytesRead, text.decode(b));
  const second = await fh.read(b, 1, 2);
  const third = await fh.read(b);
  console.log(second.bytesRead, third.bytesRead, text.decode(b));
  const fourth = await fh.read(b, 0, 4, 100);
  console.log(fourth.bytesRead);
  const w1 = await fh.write("XY", 0);
  const w2 = await fh.write(b.slice(), 1, 2, 12);
  const w3 = await fh.write(b.slice());
  const w4 = await fh.write("é");
  console.log(w1.bytesWritten, w2.bytesWritten, w3.bytesWritten, w4.bytesWritten, readFileSync("f", "utf8"));
  const s = await fh.stat();
  console.log(s.size, s.isFile(), s.mode === statSync("f").mode);
  await fh.truncate(3);
  console.log(readFileSync("f", "utf8"));
  await fh.truncate();
  await fh.chmod(0o600);
  await fh.sync();
  console.log(statSync("f").size, statSync("f").mode & 0o777);
  try { await fh.read(b, 0, 5); } catch (e) { console.log(e.message, e.code); }
  try { await fh.write(b.slice(), 5); } catch (e) { console.log(e.message, e.code); }
  try { await fh.read(b, 0, 4294967300); } catch (e) { console.log(e.message, e.code); }
  await fh.close();
  await fh.close();
  console.log(fh.fd);
  try { await fh.read(b); } catch (e) { console.log(e.message, e.code, e.syscall); }
  try { await fh.write("x"); } catch (e) { console.log(e.message, e.code, e.syscall); }
  try { await fh.stat(); } catch (e) { console.log(e.message, e.code, e.syscall); }
  try { await fh.truncate(); } catch (e) { console.log(e.message, e.code, e.syscall); }
  try { await fh.sync(); } catch (e) { console.log(e.message, e.code, e.syscall); }
  try { await fh.chmod(0o644); } catch (e) { console.log(e.message, e.code, e.syscall); }
  try { await open("missing"); } catch (e) { console.log(e.message, e.code, e.syscall, e.path); }
  try { await open("f", "zz"); } catch (e) { console.log(e.message, e.code); }
  const a = await open("g", "a");
  await a.write("more");
  await a.close();
  console.log(readFileSync("g", "utf8"));
  const d = await open(".");
  try { await d.read(b, 0, 1, 0); } catch (e) { console.log(e.message, e.code, e.syscall); }
  await d.close();`;
  // A handle dropped without close closes its file, so the next open reuses its descriptor; node
  // closes one only when it is collected, so its side closes it here.
  const dropped = `
  const before = openSync("g");
  closeSync(before);
  await drop();
  const after = openSync("g");
  console.log(after === before);
  closeSync(after);`;
  compare("handle", `${imports}\nasync function drop(): Promise<void> throws IoError {\n  const _h = await open("g");\n}`, body + dropped, (dir) => {
    writeFileSync(join(dir, "f"), "hello world");
    writeFileSync(join(dir, "g"), "abc");
  }, body + dropped.replace("await drop();", "await (await open(\"g\")).close();"), true);
});

// A call queued on the blocking pool when another task closes the handle must not run on the
// descriptor's number, which the next open reuses. The pool's threads are first all held by reads
// of a FIFO, so the write waits in the queue across the close and the open.
test("a FileHandle call queued across close() fails instead of writing to the file that reuses its descriptor", () => {
  const dir = mkdtempSync(join(tmp, "queued-"));
  expect(Bun.spawnSync(["mkfifo", join(dir, "fifo")]).exitCode).toBe(0);
  const program = join(dir, "main.fsh");
  writeFileSync(program, `import { open, readFile } from "node:fs/promises";
import { openSync, readSync, writeSync, closeSync } from "node:fs";
function hold(fifo: i64): i64 {
  let one = new Uint8Array(1);
  try {
    return readSync(fifo, one);
  } catch (e) {
    return -1;
  }
}
async function main(): Promise<void> throws IoError {
  const fifo = openSync("fifo", "r+");
  const fh = await open("a", "w");
  const other = fh.clone();
  let hogs: JoinHandle<i64>[] = [];
  for (let i = 0; i < 520; i++) hogs.push(spawn(async () => { const n = await spawnBlocking(() => hold(fifo)); return n; }));
  await sleep(200);
  const writer = spawn(async () => {
    const r = await other.write("SECRET");
    return r.bytesWritten;
  });
  await sleep(50);
  await fh.close();
  const b = openSync("b", "w");
  writeSync(fifo, new Uint8Array(520));
  while (hogs.length > 0) {
    const h = hogs.pop()!;
    await h;
  }
  try {
    const n = await writer;
    console.log("wrote", n);
  } catch (e) {
    console.log(e.message, e.code, e.syscall);
  }
  closeSync(b);
  closeSync(fifo);
  const inB = await readFile("b");
  const inA = await readFile("a");
  console.log(inB.length, inA.length);
}
`);
  const out = join(dir, "main");
  const built = Bun.spawnSync(["bun", join(import.meta.dir, "..", "src", "main.ts"), "build", program, "-o", out]);
  expect(built.stderr.toString()).toBe("");
  const run = Bun.spawnSync([out], { cwd: dir, env: { ...process.env, FISH_LEAKS: "1" } });
  expect(run.stderr.toString()).toBe("");
  expect(run.stdout.toString()).toBe("file closed EBADF write\n0 0\n");
});
