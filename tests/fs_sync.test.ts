import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The std `fs` module's blocking calls against node's: the same calls in a directory of their
// own, output compared.
const tmp = mkdtempSync(join(tmpdir(), "fish-fs-sync-"));

function compare(name: string, imports: string, body: string, nodeBody = body) {
  const fishDir = mkdtempSync(join(tmp, `${name}-fish-`));
  const nodeDir = mkdtempSync(join(tmp, `${name}-node-`));
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
  expect(fish.stdout.toString()).toBe(node.stdout.toString());
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
