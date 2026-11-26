// Records the reference answers the unit tests compare Fish with. Each is what Node or Bun gave for
// a script, kept under tests/unit/references and read back by the tests, which run neither. This
// is the one place either runtime is run: it runs the unit tests with FISH_REFERENCES=record, where
// each asks its runtime and writes down the answer. A filter records only the tests whose name
// holds it. The answers are those of Node 24.10.0 and Bun 1.4.3, which std's behaviour is checked
// against, so any other version is refused.
//   fishc run scripts/references.fsh -- [--fishc <path>] [<filter>]
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const NODE = "v24.10.0";
const BUN = "1.4.3";

function fail(message: string): never {
  console.error(`references: ${message}`);
  return process.exit(1);
}

// What `command --version` prints, or why it couldn't be run.
function version(command: string): string {
  const run = spawnSync(command, ["--version"]);
  if (run.error !== null) fail(`${command} isn't on PATH, and the answers are recorded from it`);
  return new TextDecoder().decode(run.stdout).trim();
}

function main(): void {
  let fishc = process.env.FISHC ?? "fishc";
  let filter: string[] = [];
  const args = process.argv.slice(2);
  for (let i: usize = 0; i < args.length; i++) {
    if (args[i]! === "--fishc" && i + 1 < args.length) fishc = args[++i]!;
    else filter.push(args[i]!);
  }
  const [node, bun] = [version("node"), version("bun")];
  if (node !== NODE) fail(`node is ${node}, and the answers are recorded from ${NODE}`);
  if (bun !== BUN) fail(`bun is ${bun}, and the answers are recorded from ${BUN}`);
  const run = spawnSync("env", ["FISH_REFERENCES=record", `FISHC=${fishc}`, fishc, "test", "--release", ...filter], { cwd: join(import.meta.dir, "..", "tests", "unit") });
  if (run.error !== null) fail(`can't run ${fishc}: ${run.error.message}`);
  const decoder = new TextDecoder();
  process.stdout.write(decoder.decode(run.stdout));
  process.stderr.write(decoder.decode(run.stderr));
  process.exit(run.status ?? 1);
}
