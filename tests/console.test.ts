import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// console.error and console.warn against node's: stdout and stderr each as node writes them.
const tmp = mkdtempSync(join(tmpdir(), "fish-console-"));

test("console.error and console.warn write to stderr as node does", () => {
  const program = join(tmp, "main.fsh");
  const source = `console.log("out 1");
  console.error("err", 1, { a: [1, 2], s: "x" });
  console.warn("warn", ["y"]);
  console.log("out 2", [3]);`;
  writeFileSync(program, `function main() {\n  ${source}\n}\n`);
  const out = join(tmp, "main");
  const built = Bun.spawnSync(["bun", join(import.meta.dir, "..", "src", "main.ts"), "build", program, "-o", out]);
  expect(built.stderr.toString()).toBe("");
  const fish = Bun.spawnSync([out], { env: { ...process.env, FISH_LEAKS: "1" } });
  const node = Bun.spawnSync(["node", "-e", source]);
  expect([fish.stdout.toString(), fish.stderr.toString()]).toEqual([node.stdout.toString(), node.stderr.toString()]);
});

test("stdout and stderr keep their order in one pipe, as node keeps them", () => {
  const program = join(tmp, "order.fsh");
  const source = `console.log("out 1");
  console.error("err 1");
  console.log("out 2", { a: 1 });
  console.warn("warn", { b: [1] });
  console.log("out 3");`;
  writeFileSync(program, `function main() {\n  ${source}\n}\n`);
  const out = join(tmp, "order");
  Bun.spawnSync(["bun", join(import.meta.dir, "..", "src", "main.ts"), "build", program, "-o", out]);
  const fish = Bun.spawnSync(["sh", "-c", `"${out}" 2>&1 | cat`]).stdout.toString();
  const node = Bun.spawnSync(["sh", "-c", `node -e '${source}' 2>&1 | cat`]).stdout.toString();
  expect(fish).toBe(node);
});

test("Date.now() is node's wall clock, and performance.now() counts from the start", () => {
  const program = join(tmp, "clock.fsh");
  writeFileSync(program, `async function main(): Promise<void> {
  const p = performance.now();
  await sleep(50);
  console.log(Date.now(), p >= 0 && p < 1000, performance.now() - p >= 45);
}
`);
  const out = join(tmp, "clock");
  Bun.spawnSync(["bun", join(import.meta.dir, "..", "src", "main.ts"), "build", program, "-o", out]);
  const [now, started, waited] = Bun.spawnSync([out]).stdout.toString().trim().split(" ");
  expect(Math.abs(Number(now) - Date.now())).toBeLessThan(5000);
  expect([started, waited]).toEqual(["true", "true"]);
});
