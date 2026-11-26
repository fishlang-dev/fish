// `fishc <file.fsh>` and `#!/usr/bin/env fishc` scripts, run as the native fishc, and the cache
// that keeps a script's binary between runs.
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { scriptDir } from "../../src/scripts.fsh";
import { fishcPath, removed, same, scratch, text } from "./support.fsh";

// Runs `file` itself with `args`, with the tested fishc first on PATH for its `#!` line.
function executed(file: string, args: string[]): { code: i64; out: string; err: string } {
  const path = `${dirname(fishcPath())}:${process.env.PATH ?? ""}`;
  const run = spawnSync("env", [`PATH=${path}`, file, ...args], { cwd: dirname(file) });
  return { code: run.status ?? -1, out: text(run.stdout), err: text(run.stderr) };
}

test("a #! script runs with its arguments, built once and rebuilt when it or an import changes", () => {
  const root = scratch("fish-script-");
  const script = join(root, "greet.fsh");
  try {
    removed(scriptRuns(root, script));
  } catch (e) {
    assert(false, `the script's files: ${e.message}`);
  }
  removed(root);
}, { timeout: 120_000 });

// Gives the script's cache directory, for the test to remove.
/** @throws {IoError} */
function scriptRuns(root: string, script: string): string {
  writeFileSync(join(root, "name.fsh"), `export const NAME = "fish";\n`);
  writeFileSync(script, `#!/usr/bin/env fishc\nimport { NAME } from "./name.fsh";\nfunction main() {\n  console.log(NAME, process.argv.slice(2).join(" "));\n  process.exit(3);\n}\n`);
  chmodSync(script, 0o755);
  const first = executed(script, ["a", "--help"]);
  same(`${first.code} ${first.out}${first.err}`, "3 fish a --help\n", "the first run");
  const record = join(scriptDir(script), "record");
  assert(existsSync(record), "no record was kept");
  const kept = statSync(record).mtimeMs;
  const second = executed(script, ["b"]);
  same(`${second.code} ${second.out}${second.err}`, "3 fish b\n", "the second run");
  assert(statSync(record).mtimeMs === kept, "the second run built the script again");
  writeFileSync(join(root, "name.fsh"), `export const NAME = "shark";\n`);
  const edited = executed(script, []);
  same(`${edited.code} ${edited.out}${edited.err}`, "3 shark \n", "the run after an import changed");
  writeFileSync(script, `function main() { const x: i64 = "no"; }\n`);
  const broken = spawnSync(fishcPath(), [script], { cwd: root });
  assert(broken.status === 1 && text(broken.stderr).includes("error[E0101]"), `a script that doesn't compile: ${text(broken.stderr)}`);
  return scriptDir(script);
}
