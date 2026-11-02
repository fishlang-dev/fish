import { expect, setDefaultTimeout, test } from "bun:test";
import { lstatSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Each test builds a program with clang, which can take past bun's 5 seconds on a busy CI runner.
setDefaultTimeout(30_000);

// The std `fs` module's blocking calls against node's: the same calls in a directory of their
// own, output compared.
const tmp = mkdtempSync(join(tmpdir(), "fish-fs-sync-"));

// `setup` makes the same files in both directories first; absolute paths print as `<dir>`.
function compare(name: string, imports: string, body: string, setup: (dir: string) => void = () => {}, nodeBody = body) {
  const fishDir = mkdtempSync(join(tmp, `${name}-fish-`));
  const nodeDir = mkdtempSync(join(tmp, `${name}-node-`));
  setup(fishDir);
  setup(nodeDir);
  const program = join(tmp, `${name}.fsh`);
  // A body that awaits runs in an async main, as node's runs in an async arrow.
  const async = body.includes("await ");
  writeFileSync(program, `${imports}\n${async ? "async " : ""}function main(): ${async ? "Promise<void>" : "void"} throws IoError {${body}\n}\n`);
  const out = join(tmp, name);
  const built = Bun.spawnSync(["bun", join(import.meta.dir, "..", "src", "main.ts"), "build", program, "-o", out]);
  expect(built.stderr.toString()).toBe("");
  const fish = Bun.spawnSync([out], { cwd: fishDir, env: { ...process.env, FISH_LEAKS: "1" } });
  const script = `const fs = require("node:fs"); const { readFileSync, writeFileSync, existsSync, statSync, lstatSync, readdirSync, realpathSync, mkdtempSync, rmSync, symlinkSync, mkdirSync, renameSync, copyFileSync, unlinkSync, accessSync, utimesSync, lutimesSync, chmodSync, readlinkSync, linkSync, constants } = fs; const fsp = require("node:fs/promises"); const { access, utimes, lutimes, chmod, symlink, readlink, link, realpath } = fsp; (${async ? "async " : ""}() => {${nodeBody}\n})();`;
  const node = Bun.spawnSync(["node", "-e", script], { cwd: nodeDir });
  expect(fish.stderr.toString()).toBe("");
  expect(node.stderr.toString()).toBe("");
  const shown = (out: Buffer, dir: string) => out.toString().replaceAll(realpathSync(dir), "<dir>");
  expect(shown(fish.stdout, fishDir)).toBe(shown(node.stdout, nodeDir));
  return [fishDir, nodeDir] as const;
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

test("accessSync and access give what node's give", () => {
  const imports = `import { accessSync, constants } from "node:fs";\nimport * as fsp from "node:fs/promises";\nimport { access } from "fs/promises";`;
  compare("access", imports, `
  console.log(constants.F_OK, constants.R_OK, constants.W_OK, constants.X_OK, fsp.constants.W_OK);
  accessSync("f");
  accessSync("d", constants.R_OK | constants.W_OK | constants.X_OK);
  const cases: [string, i64][] = [["ro", constants.W_OK], ["ro", constants.R_OK | constants.X_OK], ["missing", constants.F_OK], ["f/x", 0], ["", 0], ["f", 8], ["f", -1]];
  for (const [p, mode] of cases) {
    // A mode out of range is node's RangeError, with no system call; Fish's IoError gives "".
    try { accessSync(p, mode); console.log("ok", p); } catch (e) { console.log(e.message, e.code, e.code === "ERR_OUT_OF_RANGE" ? "-" : e.syscall, e.path ?? "none"); }
  }
  await access("ro", constants.R_OK);
  await fsp.access("d");
  for (const [p, mode] of cases) {
    try { await access(p, mode); console.log("ok", p); } catch (e) { console.log(e.message, e.code, e.code === "ERR_OUT_OF_RANGE" ? "-" : e.syscall, e.path ?? "none"); }
  }`, (dir) => {
    mkdirSync(join(dir, "d"));
    writeFileSync(join(dir, "f"), "hi");
    writeFileSync(join(dir, "ro"), "hi", { mode: 0o444 });
  });
});

test("utimesSync, lutimesSync, utimes and lutimes give what node's give", () => {
  const imports = `import { utimesSync, lutimesSync, statSync, lstatSync } from "node:fs";\nimport * as fsp from "node:fs/promises";\nimport { utimes } from "fs/promises";`;
  const [fishDir, nodeDir] = compare("utimes", imports, `
  const zero: f64 = 0;
  utimesSync("f", 1, 2);
  console.log(statSync("f").mtimeMs);
  utimesSync("f", 1000.5, 2.123456789);
  console.log(statSync("f").mtimeMs);
  utimesSync("f", 0, -5);
  console.log(statSync("f").mtimeMs > 1.7e12);
  utimesSync("d", new Date(5000), new Date(-1500));
  console.log(statSync("d").mtimeMs);
  lutimesSync("dl", 7, 8.25);
  console.log(lstatSync("dl").mtimeMs);
  const bad: [f64, f64][] = [[zero / zero, 1], [1, 1 / zero], [-1 / zero, zero / zero]];
  for (const [a, m] of bad) {
    try { utimesSync("f", a, m); } catch (e) { console.log(e.message, e.code, e.path ?? "none"); }
    try { await utimes("f", a, m); } catch (e) { console.log(e.message, e.code, e.path ?? "none"); }
  }
  for (const p of ["missing", "", "dl", "f/x"]) {
    try { utimesSync(p, 1, 2); } catch (e) { console.log(e.message, e.code, e.syscall, e.path); }
    try { lutimesSync(p + "/y", 1, 2); } catch (e) { console.log(e.message, e.code, e.syscall, e.path); }
    try { await fsp.utimes(p, 1, 2); } catch (e) { console.log(e.message, e.code, e.syscall, e.path); }
    try { await fsp.lutimes(p, 1, 2); console.log("set", p); } catch (e) { console.log(e.message, e.code, e.syscall, e.path); }
  }
  await utimes("g", new Date(1234567), 0.4567891);
  await fsp.lutimes("ln", 3.5, 4.75);
  utimesSync("f", 11.000001, 12.9999999);`, (dir) => {
    mkdirSync(join(dir, "d"));
    writeFileSync(join(dir, "f"), "hi");
    writeFileSync(join(dir, "g"), "hi");
    symlinkSync("nowhere", join(dir, "dl"));
    symlinkSync("g", join(dir, "ln"));
  });
  // Both times of each entry, the atimes the programs can't print among them.
  const times = (dir: string) => ["f", "g", "d", "dl", "ln"].map((p) => {
    const s = lstatSync(join(dir, p), { bigint: true });
    return [p, s.atimeNs, s.mtimeNs];
  });
  expect(times(fishDir)).toEqual(times(nodeDir));
});

test("chmodSync and chmod give what node's give", () => {
  const imports = `import { chmodSync, statSync } from "node:fs";\nimport * as fsp from "node:fs/promises";\nimport { chmod } from "fs/promises";`;
  const [fishDir, nodeDir] = compare("chmod", imports, `
  chmodSync("f", 0o600);
  console.log(statSync("f").mode);
  chmodSync("f", "644");
  console.log(statSync("f").mode);
  chmodSync("g", 0o100755);
  chmodSync("d", "0700");
  await chmod("h", 0o640);
  await fsp.chmod("i", "4");
  const modes: (i64 | string)[] = ["0o644", "abc", "", "8", "it's", "a'b\\"c", "x".repeat(140), -1, 4294967296, 2147483647, -5000000000, 9000000000, "7777777777777"];
  // A mode refused before any system call is node's TypeError or RangeError; Fish's IoError gives "".
  for (const m of modes) {
    try { chmodSync("j", m); console.log("ok", m); } catch (e) { console.log(e.message, e.code, e.code.startsWith("ERR_") ? "-" : e.syscall, e.path ?? "none"); }
    try { await chmod("j", m); console.log("ok", m); } catch (e) { console.log(e.message, e.code, e.code.startsWith("ERR_") ? "-" : e.syscall, e.path ?? "none"); }
  }
  chmodSync("j", 0o600);
  for (const p of ["missing", "dl", "", "f/x"]) {
    try { chmodSync(p, 0o644); } catch (e) { console.log(e.message, e.code, e.syscall, e.path); }
    try { await fsp.chmod(p, "644"); } catch (e) { console.log(e.message, e.code, e.syscall, e.path); }
  }`, (dir) => {
    mkdirSync(join(dir, "d"));
    for (const f of ["f", "g", "h", "i", "j"]) writeFileSync(join(dir, f), "hi");
    symlinkSync("nowhere", join(dir, "dl"));
  });
  const modes = (dir: string) => ["f", "g", "h", "i", "j", "d"].map((p) => [p, lstatSync(join(dir, p)).mode]);
  expect(modes(fishDir)).toEqual(modes(nodeDir));
});

test("symlinkSync, linkSync, readlinkSync and their promise forms, with realpath, give what node's give", () => {
  const imports = `import { symlinkSync, linkSync, readlinkSync, lstatSync, statSync, readFileSync } from "node:fs";\nimport * as fsp from "node:fs/promises";\nimport { symlink, readlink, realpath } from "fs/promises";`;
  compare("links", imports, `
  symlinkSync("f", "s1");
  symlinkSync("d", "s2", "dir");
  symlinkSync("nowhere", "s3", "file");
  symlinkSync("", "s4", null);
  await symlink("f", "s5");
  await fsp.symlink("s5", "s6", "junction");
  linkSync("f", "h1");
  await fsp.link("s1", "h2");
  const r6 = await readlink("s6");
  const rl = await fsp.readlink("dl");
  console.log(readlinkSync("s1"), readlinkSync("s2"), readlinkSync("s3"), readlinkSync("s4").length, r6, rl);
  console.log(lstatSync("s5").isSymbolicLink(), lstatSync("h1").isSymbolicLink(), statSync("f").size, readFileSync("h2", "utf8"), readFileSync("s6", "utf8"));
  const p6 = await realpath("s6");
  const p2 = await fsp.realpath("d/../s2");
  const here = await realpath(".");
  console.log(p6, p2, here);
  const pairs: [string, string][] = [["f", "s1"], ["x", "no/such/s"], ["f", "f/x"], ["f", ""]];
  for (const [target, path] of pairs) {
    try { symlinkSync(target, path); } catch (e) { console.log(e.message, e.code, e.syscall, e.path); }
    try { await symlink(target, path); } catch (e) { console.log(e.message, e.code, e.syscall, e.path); }
  }
  const links: [string, string][] = [["f", "h1"], ["missing", "h3"], ["dl", "h4"], ["d", "h5"], ["", "h6"]];
  for (const [from, to] of links) {
    try { linkSync(from, to); } catch (e) { console.log(e.message, e.code, e.syscall, e.path); }
    try { await fsp.link(from, to); } catch (e) { console.log(e.message, e.code, e.syscall, e.path); }
  }
  for (const p of ["f", "missing", "", "f/x", "d"]) {
    try { readlinkSync(p); } catch (e) { console.log(e.message, e.code, e.syscall, e.path); }
    try { await readlink(p); } catch (e) { console.log(e.message, e.code, e.syscall, e.path); }
  }
  for (const p of ["missing", "dl", "", "f/x", "no/x/.."]) {
    try { const r = await realpath(p); console.log(r); } catch (e) { console.log(e.message, e.code, e.syscall, e.path); }
  }`, (dir) => {
    mkdirSync(join(dir, "d"));
    writeFileSync(join(dir, "f"), "hi");
    symlinkSync("nowhere", join(dir, "dl"));
  });
});
