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
function compare(name: string, imports: string, body: string, setup: (dir: string) => void = () => {}, nodeBody = body) {
  const fishDir = mkdtempSync(join(tmp, `${name}-fish-`));
  const nodeDir = mkdtempSync(join(tmp, `${name}-node-`));
  setup(fishDir);
  setup(nodeDir);
  const program = join(tmp, `${name}.fsh`);
  writeFileSync(program, `${imports}\nfunction main(): void throws IoError {${body}\n}\n`);
  const out = join(tmp, name);
  const built = Bun.spawnSync(["bun", join(import.meta.dir, "..", "src", "main.ts"), "build", program, "-o", out]);
  expect(built.stderr.toString()).toBe("");
  const fish = Bun.spawnSync([out], { cwd: fishDir, env: { ...process.env, FISH_LEAKS: "1" } });
  const script = `const fs = require("node:fs"); const { readFileSync, writeFileSync, existsSync, statSync, lstatSync, readdirSync, realpathSync, mkdtempSync, rmSync, symlinkSync } = fs; (() => {${nodeBody}\n})();`;
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
