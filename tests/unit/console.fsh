// Ports tests/console.test.ts: console.error and console.warn against node's, stdout and stderr
// each as node writes them, and the clocks.
import { spawnSync } from "node:child_process";
import { built, removed, same, scratch, text } from "./support.fsh";

test("console.error and console.warn write to stderr as node does", () => {
  const dir = scratch("fish-console-");
  const source = `console.log("out 1");
  console.error("err", 1, { a: [1, 2], s: "x" });
  console.warn("warn", ["y"]);
  console.log("out 2", [3]);`;
  const out = built(dir, "main", `function main() {\n  ${source}\n}\n`);
  const fish = spawnSync("env", ["FISH_LEAKS=1", out]);
  const node = spawnSync("node", ["-e", source]);
  same(text(fish.stdout), text(node.stdout), "stdout");
  same(text(fish.stderr), text(node.stderr), "stderr");
  removed(dir);
});

test("stdout and stderr keep their order in one pipe, as node keeps them", () => {
  const dir = scratch("fish-console-");
  const source = `console.log("out 1");
  console.error("err 1");
  console.log("out 2", { a: 1 });
  console.warn("warn", { b: [1] });
  console.log("out 3");`;
  const out = built(dir, "order", `function main() {\n  ${source}\n}\n`);
  const fish = text(spawnSync("sh", ["-c", `"${out}" 2>&1 | cat`]).stdout);
  const node = text(spawnSync("sh", ["-c", `node -e '${source}' 2>&1 | cat`]).stdout);
  same(fish, node, "the output");
  removed(dir);
});

test("Date.now() is node's wall clock, and performance.now() counts from the start", () => {
  const dir = scratch("fish-console-");
  const out = built(dir, "clock", `async function main(): Promise<void> {
  const p = performance.now();
  await sleep(50);
  console.log(Date.now(), p >= 0 && p < 1000, performance.now() - p >= 45);
}
`);
  const parts = text(spawnSync(out, []).stdout).trim().split(" ");
  assert(parts.length === 3, `the output: ${parts.join(" ")}`);
  const now = Number(parts[0]) ?? 0;
  assert(Math.abs(now - (Date.now() as number)) < 5000, `Date.now() gave ${parts[0]}, ${Date.now()} here`);
  same(`${parts[1]} ${parts[2]}`, "true true", "the clock checks");
  removed(dir);
});
