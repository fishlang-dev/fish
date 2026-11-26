// `fishc build --heap-profile`: live memory sampled by allocation site, written as pprof on
// SIGUSR1 and at exit, and `fishc heap diff` saying what grew between two snapshots.
import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fishc, removed, scratch, text } from "./support.fsh";

function write(path: string, contents: string): void {
  try {
    writeFileSync(path, contents);
  } catch (e) {
    assert(false, `can't write ${path}: ${e.message}`);
  }
}

const GROWING = `function chunk(n: i64): u8[] {
  return new Array(n).fill(0 as u8);
}

async function main(): Promise<void> throws IoError {
  let kept: u8[][] = [];
  for (let i = 0; i < 100; i++) kept.push(chunk(65536));
  process.kill(process.pid, "SIGUSR1");
  await sleep(300);
  for (let i = 0; i < 400; i++) kept.push(chunk(65536));
  process.kill(process.pid, "SIGUSR1");
  await sleep(300);
  console.log(kept.length);
}
`;

test("heap profile: snapshots on SIGUSR1 and at exit, and a diff naming what grew", () => {
  const root = scratch("heap-profile");
  try {
    const file = join(root, "main.fsh");
    const bin = join(root, "main");
    write(file, GROWING);
    const built = fishc(root, ["build", file, "--heap-profile", "-o", bin]);
    assert(built.code === 0, `build failed:\n${built.err}`);
    const run = spawnSync("env", [`FISH_HEAP_PROFILE=${join(root, "heap")}`, bin], { cwd: root });
    const err = text(run.stderr);
    assert(run.status === 0 && text(run.stdout).trim() === "500", `run failed: ${err}`);
    assert(err.split("fish heap profile:").length === 4, `expected three snapshots:\n${err}`);
    for (const n of ["1", "2", "3"]) assert(existsSync(join(root, `heap.${n}`)), `no heap.${n}`);
    const diff = fishc(root, ["heap", "diff", join(root, "heap.1"), join(root, "heap.2")]);
    assert(diff.code === 0, `diff failed:\n${diff.err}`);
    const lines = diff.out.split("\n");
    assert(lines[0].startsWith("live memory +") && lines[0].includes("MiB"), `unexpected summary:\n${diff.out}`);
    assert(lines[1].includes("MiB") && lines[1].includes("main.fsh:2 chunk"), `expected chunk to grow most:\n${diff.out}`);
  } finally {
    removed(root);
  }
});

test("heap profile: refused beside --leaks, --profile and --lib, and diff's usage", () => {
  const root = scratch("heap-profile-flags");
  try {
    const file = join(root, "main.fsh");
    write(file, "function main() {}\n");
    const leaks = fishc(root, ["build", file, "--heap-profile", "--leaks"]);
    assert(leaks.code === 2 && leaks.err.includes("'--leaks' and '--heap-profile'"), leaks.err);
    const both = fishc(root, ["build", file, "--heap-profile", "--profile"]);
    assert(both.code === 2 && both.err.includes("'--profile' and '--heap-profile'"), both.err);
    const lib = fishc(root, ["build", file, "--heap-profile", "--lib"]);
    assert(lib.code === 2 && lib.err.includes("'--heap-profile' can't build a library"), lib.err);
    const usage = fishc(root, ["heap", "diff", "a.pb"]);
    assert(usage.code === 2 && usage.err === "usage: fishc heap diff <before.pb> <after.pb>\n", usage.err);
    write(join(root, "bad.pb"), "not a profile");
    const bad = fishc(root, ["heap", "diff", join(root, "bad.pb"), join(root, "bad.pb")]);
    assert(bad.code === 2 && bad.err.startsWith("fishc heap diff: "), bad.err);
  } finally {
    removed(root);
  }
});
