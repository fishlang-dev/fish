import { expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";

// Each test builds a program with clang, which can take past bun's 5 seconds on a busy CI runner.
setDefaultTimeout(30_000);

// The std `os` module against Node's, as Bun gives it on this machine: each function, called
// with the environment varied where the answer reads it.
const tmp = mkdtempSync(join(os.tmpdir(), "fish-os-"));
const program = join(tmp, "main.fsh");
writeFileSync(program, `import os from "node:os";
function main() {
  console.log(os.hostname());
  console.log(os.tmpdir());
  console.log(os.homedir());
  console.log(os.platform());
  console.log(os.availableParallelism());
}
`);
const out = join(tmp, "main");
const built = Bun.spawnSync(["bun", join(import.meta.dir, "..", "src", "main.ts"), "build", program, "-o", out]);

function both(env: Record<string, string | undefined>): [string, string] {
  const vars = { ...process.env, ...env } as Record<string, string>;
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete vars[k];
  const fish = Bun.spawnSync([out], { env: vars }).stdout.toString();
  const script = "import os from 'node:os'; for (const v of [os.hostname(), os.tmpdir(), os.homedir(), os.platform(), os.availableParallelism()]) console.log(v);";
  const node = Bun.spawnSync(["bun", "-e", script], { env: vars }).stdout.toString();
  return [fish, node];
}

test("the os functions give what Node's give", () => {
  expect(built.exitCode).toBe(0);
  const [fish, node] = both({});
  expect(fish).toBe(node);
});

test("tmpdir falls back through TMPDIR, TMP and TEMP, and drops a trailing slash", () => {
  for (const env of [{ TMPDIR: "/a/b/" }, { TMPDIR: undefined, TMP: "/c" }, { TMPDIR: undefined, TMP: undefined, TEMP: "/d/" }, { TMPDIR: undefined, TMP: undefined, TEMP: undefined }, { TMPDIR: "/" }]) {
    const [fish, node] = both(env);
    expect(fish).toBe(node);
  }
});

test("homedir reads HOME first", () => {
  const [fish, node] = both({ HOME: "/somewhere/else" });
  expect(fish).toBe(node);
});
