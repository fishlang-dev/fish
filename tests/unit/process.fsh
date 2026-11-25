// The std `process` module against node's as recorded: arguments, the environment and the exit
// code. The environment is given through `env`.
import { spawnSync } from "node:child_process";
import { realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { built, reference, removed, same, scratch, text } from "./support.fsh";

function body(): string {
  return `console.log(process.argv.slice(2));
console.log(process.env.FISH_A ?? "unset", process.env["FISH_B"] ?? "unset", process.env.FISH_EMPTY === "");
if (process.argv.length > 4) process.exit(7);
console.log("done");
`;
}

// stdout, stderr and the exit code, as one text.
function result(command: string, args: string[]): string {
  const r = spawnSync(command, args);
  return `${text(r.stdout)}\n--- stderr\n${text(r.stderr)}\n--- exit ${r.status ?? -1}`;
}

test("process.argv, process.env and process.exit match node", () => {
  const dir = scratch("fish-process-");
  const out = built(dir, "main", `function main() {\n${body()}}\n`);
  const script = join(dir, "main.js");
  try {
    writeFileSync(script, body());
  } catch (e) {
    assert(false, e.message);
  }
  const runs: [string[], string[]][] = [[[], []], [["a", "b c", ""], ["FISH_A=x", "FISH_EMPTY="]], [["1", "2", "3"], ["FISH_B=y y"]]];
  let n = 0;
  for (const [args, vars] of runs) {
    let env: string[] = ["FISH_LEAKS=1"];
    env = env.concat(vars);
    let fish = env.clone();
    fish.push(out);
    fish = fish.concat(args);
    let node = env.clone();
    node = node.concat(["node", script]);
    node = node.concat(args);
    const want = reference(`process-args-${n++}`, `${body()}\n${JSON.stringify(args)}\n${JSON.stringify(vars)}`, () => ({ status: 0, stdout: result("env", node), stderr: "" }));
    same(result("env", fish), want.stdout, `with ${JSON.stringify(args)}`);
  }
  removed(dir);
}, { timeout: 30_000 });

test("the first two arguments are the binary's absolute path", () => {
  const dir = scratch("fish-process-");
  const out = built(dir, "main", "function main() { console.log(process.argv[0]); console.log(process.argv[1]); }\n");
  const run = spawnSync("./main", [], { cwd: dir });
  let path = "";
  try {
    path = realpathSync(out);
  } catch (e) {
    assert(false, e.message);
  }
  same(text(run.stdout), `${path}\n${path}\n`, "the output");
  removed(dir);
}, { timeout: 30_000 });
