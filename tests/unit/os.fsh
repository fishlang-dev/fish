// The std `os` module: what it says of this machine against what the system's own tools say, and
// what it reads from the environment against Node's answers as recorded. Each variation of the
// environment is given through `env`, `-u NAME` unsetting a variable.
import { spawnSync } from "node:child_process";
import { built, ranFor, reference, removed, same, scratch, text } from "./support.fsh";

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

// The lines the Fish program prints, run under `env` with `vars`: the host's name, the temporary
// directory, the home directory, the platform and the processors.
function printed(out: string, vars: string[]): string[] {
  let args = vars.clone();
  args.push(out);
  return text(spawnSync("env", args).stdout).split("\n");
}

// What Node's `os[name]()` gives under `env` with `vars`, as recorded from Bun.
function recorded(key: string, name: string, vars: string[]): string {
  const script = `import os from 'node:os'; console.log(os.${name}());`;
  let args = vars.clone();
  args = args.concat(["bun", "-e", script]);
  return reference(key, `${script}\n${vars.join(" ")}`, () => ranFor("env", [...args])).stdout.trim();
}

// What a command prints, trimmed.
function said(command: string, args: string[]): string {
  return text(spawnSync(command, args).stdout).trim();
}

// A recording made on another machine can't hold this one's name or its processors, so those are
// asked of the system's own tools.
test("the os functions say of this machine what its own tools say", () => {
  const dir = scratch("fish-os-");
  const got = printed(program(dir), []);
  same(got[0]!, said("hostname", []), "the host's name");
  const tmp = process.env.TMPDIR ?? process.env.TMP ?? process.env.TEMP ?? "/tmp";
  same(got[1]!, tmp.length > 1 && tmp.endsWith("/") ? tmp.slice(0, -1) : tmp, "the temporary directory");
  same(got[2]!, process.env.HOME ?? "", "the home directory");
  same(got[3]!, said("uname", ["-s"]).toLowerCase(), "the platform");
  same(got[4]!, said("getconf", ["_NPROCESSORS_ONLN"]), "the processors");
  removed(dir);
}, { timeout: 30_000 });

test("tmpdir falls back through TMPDIR, TMP and TEMP, and drops a trailing slash", () => {
  const dir = scratch("fish-os-");
  const out = program(dir);
  const envs: string[][] = [["TMPDIR=/a/b/"], ["-u", "TMPDIR", "TMP=/c"], ["-u", "TMPDIR", "-u", "TMP", "TEMP=/d/"], ["-u", "TMPDIR", "-u", "TMP", "-u", "TEMP"], ["TMPDIR=/"]];
  let n = 0;
  for (const vars of envs) same(printed(out, vars.clone())[1]!, recorded(`os-tmpdir-${n++}`, "tmpdir", vars.clone()), `the temporary directory with ${vars.join(" ")}`);
  removed(dir);
}, { timeout: 30_000 });

test("homedir reads HOME first", () => {
  const dir = scratch("fish-os-");
  const vars = ["HOME=/somewhere/else"];
  same(printed(program(dir), vars.clone())[2]!, recorded("os-homedir", "homedir", vars.clone()), "the home directory");
  removed(dir);
}, { timeout: 30_000 });
