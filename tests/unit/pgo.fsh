// Profile-guided optimization through the CLI: an instrumented build, its run's profile, and a
// release build optimized with it.
import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fishc, ran, removed, scratch, text } from "./support.fsh";

const PROGRAM = `function score(n: i64): i64 {
  return n % 3 === 0 ? n * 2 : n + 1;
}
function main() {
  let total = 0;
  for (let i = 0; i < 100000; i++) total += score(i);
  console.log(total);
}
`;

function run(dir: string, binary: string): string {
  const got = spawnSync(join(dir, binary), [], { cwd: dir });
  assert(got.status === 0, `${binary} exited ${got.status ?? -1}: ${text(got.stderr)}`);
  return text(got.stdout);
}

test("a --pgo-instrument build's run writes default.profraw, which --pgo optimizes a release build with", () => {
  const dir = scratch("fish-pgo-");
  try {
    writeFileSync(join(dir, "main.fsh"), PROGRAM);
  } catch (e) {
    assert(false, e.message);
  }
  ran(fishc(dir, ["build", "main.fsh", "--pgo-instrument", "-o", "instrumented"]), 0, "", "", "the instrumented build");
  const want = run(dir, "instrumented");
  assert(existsSync(join(dir, "default.profraw")), "the instrumented run wrote no default.profraw");
  ran(fishc(dir, ["build", "main.fsh", "--release", "--pgo", "default.profraw", "--pgo", "default.profraw", "-o", "optimized"]), 0, "", "", "the build with two raw profiles");
  assert(run(dir, "optimized") === want, "the optimized build prints something else");
  removed(dir);
}, { timeout: 300_000 });

test("--pgo is refused without --release, with --pgo-instrument, and for a profile that isn't there", () => {
  const dir = scratch("fish-pgo-");
  try {
    writeFileSync(join(dir, "main.fsh"), PROGRAM);
  } catch (e) {
    assert(false, e.message);
  }
  ran(fishc(dir, ["build", "main.fsh", "--pgo", "default.profraw"]), 2, "", "fishc build: '--pgo' optimizes a release build; add '--release'\n", "without --release");
  ran(fishc(dir, ["build", "main.fsh", "--pgo-instrument", "--release", "--pgo", "x.profraw"]), 2, "", "fishc build: '--pgo-instrument' writes the binary a profile is taken from, and '--pgo' builds with one; build with one of them\n", "with both");
  ran(fishc(dir, ["build", "main.fsh", "--release", "--pgo", "missing.profraw"]), 1, "", "fishc build: the profile 'missing.profraw' doesn't exist; build with '--pgo-instrument', run the program it writes, and pass the default.profraw the run leaves\n", "a missing profile");
  removed(dir);
}, { timeout: 120_000 });
