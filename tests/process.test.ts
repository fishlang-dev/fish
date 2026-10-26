import { expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Each test builds a program with clang, which can take past bun's 5 seconds on a busy CI runner.
setDefaultTimeout(30_000);

// The std `process` module against node's: arguments, the environment and the exit code.
const tmp = mkdtempSync(join(tmpdir(), "fish-process-"));
const program = join(tmp, "main.fsh");
writeFileSync(program, `function main() {
  console.log(process.argv.slice(2));
  console.log(process.env.FISH_A ?? "unset", process.env["FISH_B"] ?? "unset", process.env.FISH_EMPTY === "");
  if (process.argv.length > 4) process.exit(7);
  console.log("done");
}
`);
const script = join(tmp, "main.js");
writeFileSync(script, `console.log(process.argv.slice(2));
console.log(process.env.FISH_A ?? "unset", process.env["FISH_B"] ?? "unset", process.env.FISH_EMPTY === "");
if (process.argv.length > 4) process.exit(7);
console.log("done");
`);
const out = join(tmp, "main");
const built = Bun.spawnSync(["bun", join(import.meta.dir, "..", "src", "main.ts"), "build", program, "-o", out]);

function both(args: string[], env: Record<string, string>) {
  const vars = { ...process.env, FISH_LEAKS: "1", ...env };
  const fish = Bun.spawnSync([out, ...args], { env: vars });
  const node = Bun.spawnSync(["node", script, ...args], { env: vars });
  return { fish: [fish.stdout.toString(), fish.stderr.toString(), fish.exitCode], node: [node.stdout.toString(), node.stderr.toString(), node.exitCode] };
}

test("process.argv, process.env and process.exit match node", () => {
  expect(built.exitCode).toBe(0);
  for (const [args, env] of [[[], {}], [["a", "b c", ""], { FISH_A: "x", FISH_EMPTY: "" }], [["1", "2", "3"], { FISH_B: "y y" }]] as [string[], Record<string, string>][]) {
    const { fish, node } = both(args, env);
    expect(fish).toEqual(node);
  }
});

test("the first two arguments are the binary's absolute path", () => {
  writeFileSync(program, "function main() { console.log(process.argv[0]); console.log(process.argv[1]); }\n");
  Bun.spawnSync(["bun", join(import.meta.dir, "..", "src", "main.ts"), "build", program, "-o", out]);
  const run = Bun.spawnSync(["./main"], { cwd: tmp });
  const path = realpathSync(out);
  expect(run.stdout.toString()).toBe(`${path}\n${path}\n`);
});
