import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The std `fs/promises` module against node's: the same calls in a directory of their own,
// output and files compared.
const tmp = mkdtempSync(join(tmpdir(), "fish-fs-"));

const BODY = `
  await writeFile("a.txt", "héllo\\nworld");
  const bytes = await readFile("a.txt");
  const text = await readFile("a.txt", "utf8");
  const again = await fs.readFile("a.txt", { encoding: "utf8" });
  console.log(bytes.length, text, again === text);
  await fs.writeFile("b.dat", new TextEncoder().encode("bytes"), "utf8");
  const back = await readFile("b.dat", "utf-8");
  console.log(back);
  await writeFile("bad.txt", BYTES);
  const bad = await readFile("bad.txt", "utf8");
  console.log(bad);
  for (const p of ["missing.txt", ".", "a.txt/nested", ""]) {
    try {
      await readFile(p);
      console.log("read", p);
    } catch (e) {
      console.log(e.message, e.code, e.syscall);
    }
  }
  try {
    await writeFile("no/such/dir/x.txt", "x");
  } catch (e) {
    console.log(e.message, e.code, e.syscall);
  }`;

test("readFile and writeFile give what node's give", () => {
  const fishDir = mkdtempSync(join(tmp, "fish-"));
  const nodeDir = mkdtempSync(join(tmp, "node-"));
  const program = join(tmp, "main.fsh");
  writeFileSync(program, `import { readFile, writeFile } from "node:fs/promises";\nimport * as fs from "fs/promises";\nasync function main(): Promise<void> throws IoError {${BODY.replace("BYTES", "[0x68, 0xff, 0x69]")}\n}\n`);
  const out = join(tmp, "main");
  const built = Bun.spawnSync(["bun", join(import.meta.dir, "..", "src", "main.ts"), "build", program, "-o", out]);
  expect(built.stderr.toString()).toBe("");
  const fish = Bun.spawnSync([out], { cwd: fishDir, env: { ...process.env, FISH_LEAKS: "1" } });
  const script = `const { readFile, writeFile } = require("node:fs/promises"); const fs = require("fs/promises"); (async () => {${BODY.replace("BYTES", "Buffer.from([0x68, 0xff, 0x69])")}\n})();`;
  const node = Bun.spawnSync(["node", "-e", script], { cwd: nodeDir });
  expect(fish.stderr.toString()).toBe("");
  expect(fish.stdout.toString()).toBe(node.stdout.toString());
});

test("a read still waiting when main returns isn't reported as a leak", () => {
  const dir = mkdtempSync(join(tmp, "fifo-"));
  Bun.spawnSync(["mkfifo", join(dir, "fifo")]);
  const program = join(dir, "main.fsh");
  writeFileSync(program, `import { readFile } from "node:fs/promises";\nasync function reader(): Promise<void> throws IoError {\n  await readFile("fifo");\n}\nasync function main(): Promise<void> {\n  spawn(reader());\n  await sleep(50);\n  console.log("done");\n}\n`);
  const out = join(dir, "main");
  const built = Bun.spawnSync(["bun", join(import.meta.dir, "..", "src", "main.ts"), "build", program, "-o", out]);
  expect(built.stderr.toString()).toBe("");
  const fish = Bun.spawnSync([out], { cwd: dir, env: { ...process.env, FISH_LEAKS: "1" } });
  expect(fish.stderr.toString()).toBe("");
  expect(fish.stdout.toString()).toBe("done\n");
});
