// The std `os` module against Node's, as Bun gives it on this machine:
// each function, called with the environment varied where the answer reads it. Each variation is
// given through `env`, `-u NAME` unsetting a variable.
import { spawnSync } from "node:child_process";
import { built, removed, same, scratch, text } from "./support.fsh";

function program(dir: string): string {
  return built(dir, "main", `import os from "node:os";
function main() {
  console.log(os.hostname());
  console.log(os.tmpdir());
  console.log(os.homedir());
  console.log(os.platform());
  console.log(os.availableParallelism());
}
`);
}

// The Fish program's output and Bun's, run under `env` with `vars`.
function both(out: string, vars: string[]): [string, string] {
  const script = "import os from 'node:os'; for (const v of [os.hostname(), os.tmpdir(), os.homedir(), os.platform(), os.availableParallelism()]) console.log(v);";
  let fishArgs = vars.clone();
  fishArgs.push(out);
  let bunArgs = vars.clone();
  bunArgs = bunArgs.concat(["bun", "-e", script]);
  return [text(spawnSync("env", fishArgs).stdout), text(spawnSync("env", bunArgs).stdout)];
}

test("the os functions give what Node's give", () => {
  const dir = scratch("fish-os-");
  const out = program(dir);
  const [fish, node] = both(out, []);
  same(fish, node, "the output");
  removed(dir);
}, { timeout: 30_000 });

test("tmpdir falls back through TMPDIR, TMP and TEMP, and drops a trailing slash", () => {
  const dir = scratch("fish-os-");
  const out = program(dir);
  const envs: string[][] = [["TMPDIR=/a/b/"], ["-u", "TMPDIR", "TMP=/c"], ["-u", "TMPDIR", "-u", "TMP", "TEMP=/d/"], ["-u", "TMPDIR", "-u", "TMP", "-u", "TEMP"], ["TMPDIR=/"]];
  for (const vars of envs) {
    const [fish, node] = both(out, vars.clone());
    same(fish, node, `the output with ${vars.join(" ")}`);
  }
  removed(dir);
}, { timeout: 30_000 });

test("homedir reads HOME first", () => {
  const dir = scratch("fish-os-");
  const out = program(dir);
  const [fish, node] = both(out, ["HOME=/somewhere/else"]);
  same(fish, node, "the output");
  removed(dir);
}, { timeout: 30_000 });
