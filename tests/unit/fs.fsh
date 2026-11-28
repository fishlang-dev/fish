// The std `fs/promises` module against node's: the same calls in a
// directory of their own, output and files compared.
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { built, onSystem, ranFor, reference, removed, same, scratch, text } from "./support.fsh";

function body(): string {
  return `
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
}

function made(dir: string): void {
  try {
    mkdirSync(dir);
  } catch (e) {
    assert(false, e.message);
  }
}

test("readFile and writeFile give what node's give", () => {
  const tmp = scratch("fish-fs-");
  const fishDir = join(tmp, "fish");
  const nodeDir = join(tmp, "node");
  made(fishDir);
  made(nodeDir);
  const out = built(tmp, "main", `import { readFile, writeFile } from "node:fs/promises";\nimport * as fs from "fs/promises";\nasync function main(): Promise<void> throws IoError {${body().replace("BYTES", "[0x68, 0xff, 0x69]")}\n}\n`);
  const fish = spawnSync("env", ["FISH_LEAKS=1", out], { cwd: fishDir });
  const script = `const { readFile, writeFile } = require("node:fs/promises"); const fs = require("fs/promises"); (async () => {${body().replace("BYTES", "Buffer.from([0x68, 0xff, 0x69])")}\n})();`;
  const node = reference(onSystem("fs-read-and-write"), script, () => ranFor("node", ["-e", script], nodeDir));
  same(text(fish.stderr), "", "the program's stderr");
  same(text(fish.stdout), node.stdout, "the output");
  removed(tmp);
}, { timeout: 30_000 });

test("a read still waiting when main returns isn't reported as a leak", () => {
  const dir = scratch("fish-fs-");
  spawnSync("mkfifo", [join(dir, "fifo")]);
  const out = built(dir, "main", `import { readFile } from "node:fs/promises";\nasync function reader(): Promise<void> throws IoError {\n  await readFile("fifo");\n}\nasync function main(): Promise<void> {\n  spawn(reader());\n  await sleep(50);\n  console.log("done");\n}\n`);
  const fish = spawnSync("env", ["FISH_LEAKS=1", out], { cwd: dir });
  same(text(fish.stderr), "", "the program's stderr");
  same(text(fish.stdout), "done\n", "the output");
  removed(dir);
}, { timeout: 30_000 });
