// `fishc build --profile` and `fishc run --profile`: stack samples across worker and blocking
// threads written as folded stacks or an interactive SVG flame graph.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fishc, removed, runtimeArgs, scratch, text } from "./support.fsh";

function write(path: string, contents: string): void {
  try {
    writeFileSync(path, contents);
  } catch (e) {
    assert(false, `can't write ${path}: ${e.message}`);
  }
}

function read(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (e) {
    assert(false, `can't read ${path}: ${e.message}`);
    return "";
  }
}

function syncHot(): string {
  return `function burn(n: i64): i64 {
  let s: i64 = 1;
  for (let i: i64 = 0; i < n; i++) s = (s + ((i * 31) ^ (s >> 3))) & 0x7fffffff;
  return s;
}

function main(): void {
  let total: i64 = 0;
  for (let r: i64 = 0; r < 40; r++) total = (total + burn(100000)) & 0x7fffffff;
  console.log(total !== 0 ? "sync ok" : "zero");
}
`;
}

function asyncHot(): string {
  return `function hotLeaf(n: i64): i64 {
  let s: i64 = 0;
  for (let i: i64 = 0; i < n; i++) s += (i * 17) ^ (s >> 2);
  return s;
}

async function workerTask(rounds: i64): Promise<i64> {
  let total: i64 = 0;
  for (let r: i64 = 0; r < rounds; r++) total += hotLeaf(200000);
  return total;
}

async function main(): Promise<void> {
  const a = spawn(workerTask(120));
  const b = spawn(workerTask(120));
  const c = spawn(async () => {
    let total: i64 = 0;
    for (let r: i64 = 0; r < 80; r++) total += hotLeaf(200000);
    return total;
  });
  const d = spawnBlocking(() => {
    let total: i64 = 0;
    for (let r: i64 = 0; r < 80; r++) total += hotLeaf(200000);
    return total;
  });
  const ra = await a;
  const rb = await b;
  const rc = await c;
  const rd = await d;
  console.log((ra + rb + rc + rd) !== 0 ? "async ok" : "zero");
}
`;
}

test("profile: sync program writes folded stacks and interactive SVG with zero leaks", () => {
  const root = scratch("profile-sync");
  try {
    const file = join(root, "main.fsh");
    const bin = join(root, "main");
    write(file, syncHot());
    const built = fishc(root, ["build", file, "--profile", "-o", bin]);
    assert(built.code === 0, `build failed:\n${built.err}`);

    const folded = join(root, "out.folded");
    const rFolded = spawnSync("env", ["FISH_LEAKS=1", `FISH_PROFILE=${folded}`, bin], { cwd: root });
    assert(rFolded.status === 0, `folded run failed: ${text(rFolded.stderr)}`);
    assert(text(rFolded.stdout).trim() === "sync ok", `unexpected stdout: ${text(rFolded.stdout)}`);
    assert(!text(rFolded.stderr).includes("leaked"), `leaks reported:\n${text(rFolded.stderr)}`);
    assert(text(rFolded.stderr).includes("fish profile:"), `missing summary:\n${text(rFolded.stderr)}`);
    const fText = read(folded);
    assert(fText.includes("main;burn "), `expected main;burn in folded output:\n${fText}`);

    const svg = join(root, "out.svg");
    const rSvg = spawnSync("env", ["FISH_LEAKS=1", `FISH_PROFILE=${svg}`, bin], { cwd: root });
    assert(rSvg.status === 0, `svg run failed: ${text(rSvg.stderr)}`);
    assert(!text(rSvg.stderr).includes("leaked"), `leaks reported:\n${text(rSvg.stderr)}`);
    const sText = read(svg);
    assert(sText.includes("<svg ") && sText.includes("Fish Flame Graph") && sText.includes("<title>burn ("), `unexpected svg:\n${sText.slice(0, 600)}`);
    assert(sText.includes("Reset Zoom"), "missing interactive zoom control");
  } finally {
    removed(root);
  }
});

test("profile: release async multi-worker program samples hot functions and XML-escapes arrow names", () => {
  const root = scratch("profile-async");
  try {
    const file = join(root, "main.fsh");
    const bin = join(root, "main");
    write(file, asyncHot());
    const built = fishc(root, ["build", file, "--release", "--profile", "-o", bin]);
    assert(built.code === 0, `release profile build failed:\n${built.err}`);

    const folded = join(root, "async.folded");
    const rFolded = spawnSync("env", ["FISH_LEAKS=1", `FISH_PROFILE=${folded}`, bin], { cwd: root });
    assert(rFolded.status === 0, `async folded run failed:\n${text(rFolded.stderr)}`);
    assert(text(rFolded.stdout).trim() === "async ok", `unexpected stdout: ${text(rFolded.stdout)}`);
    assert(!text(rFolded.stderr).includes("leaked"), `leaks reported:\n${text(rFolded.stderr)}`);
    const fText = read(folded);
    assert(fText.includes("workerTask;hotLeaf "), `expected workerTask;hotLeaf in release folded output:\n${fText}`);

    const svg = join(root, "async.svg");
    const rSvg = spawnSync("env", ["FISH_LEAKS=1", `FISH_PROFILE=${svg}`, bin], { cwd: root });
    assert(rSvg.status === 0, `async svg run failed:\n${text(rSvg.stderr)}`);
    const sText = read(svg);
    assert(sText.includes("<title>hotLeaf (") && sText.includes("<title>workerTask ("), `missing frames in svg:\n${sText.slice(0, 800)}`);
    if (sText.includes("arrow ")) assert(sText.includes("&lt;arrow "), "arrow frame name must be XML-escaped in svg");
  } finally {
    removed(root);
  }
});

test("profile: FISH_PROFILE=0 disables output and fishc run --profile works", () => {
  const root = scratch("profile-off");
  try {
    const file = join(root, "main.fsh");
    const bin = join(root, "main");
    write(file, syncHot());
    const built = fishc(root, ["build", file, "--profile", "-o", bin]);
    assert(built.code === 0, `build failed:\n${built.err}`);

    const rOff = spawnSync("env", ["FISH_PROFILE=0", bin], { cwd: root });
    assert(rOff.status === 0, `FISH_PROFILE=0 failed: ${text(rOff.stderr)}`);
    assert(!text(rOff.stderr).includes("fish profile:"), `unexpected summary when disabled:\n${text(rOff.stderr)}`);
    assert(!existsSync(join(root, "fish-profile.svg")), "default svg should not be created when disabled");

    const out = join(root, "run.folded");
    const ran = spawnSync("env", [`FISH_PROFILE=${out}`, process.env.FISHC ?? "fishc", "run", file, "--profile"], { cwd: root });
    assert(ran.status === 0, `fishc run --profile failed:\n${text(ran.stderr)}`);
    assert(existsSync(out) && read(out).includes("burn "), "fishc run --profile did not write folded stacks");
  } finally {
    removed(root);
  }
});

test("profile: refused with --lib, and plain builds stay untouched", () => {
  const root = scratch("profile-flags");
  try {
    const file = join(root, "main.fsh");
    write(file, syncHot());

    const bad = fishc(root, ["build", file, "--lib", "--profile"]);
    assert(bad.code === 2, `expected exit 2, got ${bad.code}`);
    assert(bad.err.includes("--profile") && bad.err.includes("library"), `unexpected error:\n${bad.err}`);

    const badCheck = fishc(root, ["check", file, "--profile"]);
    assert(badCheck.code === 2, `expected fishc check --profile to exit 2, got ${badCheck.code}`);

    const plainIr = fishc(root, ["build", file, "--release", "--emit-llvm"]);
    assert(plainIr.code === 0, `plain release IR failed:\n${plainIr.err}`);
    assert(!plainIr.out.includes("@fsh_rt_frames"), "plain --release build should not emit shadow frames");

    const profIr = fishc(root, ["build", file, "--release", "--profile", "--emit-llvm"]);
    assert(profIr.code === 0, `profile release IR failed:\n${profIr.err}`);
    assert(profIr.out.includes("@fsh_rt_frames") && profIr.out.includes('syncscope("singlethread") seq_cst'), "profile build should emit singlethread seq_cst shadow frames");

    const plainRt = runtimeArgs(root, file, ["--release"]);
    assert(!plainRt[0]!.includes("-DFSH_PROFILE"), `plain runtime unexpectedly had -DFSH_PROFILE: ${plainRt[0]!}`);
    const profRt = runtimeArgs(root, file, ["--release", "--profile"]);
    assert(profRt[0]!.includes("-DFSH_PROFILE"), `profile runtime missing -DFSH_PROFILE: ${profRt[0]!}`);
    assert(profRt[1]!.includes("-profile"), `profile runtime cache name missing -profile: ${profRt[1]!}`);
  } finally {
    removed(root);
  }
});

test("profile: --leaks --profile combined works and sibling names merge cleanly in SVG", () => {
  const root = scratch("profile-combined");
  try {
    const file = join(root, "main.fsh");
    const bin = join(root, "main");
    write(
      file,
      `function leaf(n: i64): i64 {
  let s: i64 = 1;
  for (let i: i64 = 0; i < n; i++) s = (s + ((i * 13) ^ (s >> 2))) & 0x7fffffff;
  return s;
}
function burn(): i64 {
  let t: i64 = 0;
  for (let i: i64 = 0; i < 15; i++) t = (t + leaf(100000)) & 0x7fffffff;
  return t;
}
function burn2(): i64 {
  let t: i64 = 0;
  for (let i: i64 = 0; i < 15; i++) t = (t + leaf(100000)) & 0x7fffffff;
  return t;
}
async function main(): Promise<void> {
  const a = burn();
  const b = burn2();
  console.log((a + b) !== 0 ? "ok" : "zero");
}
`,
    );
    const built = fishc(root, ["build", file, "--release", "--leaks", "--profile", "-o", bin]);
    assert(built.code === 0, `combined build failed:\n${built.err}`);
    const svg = join(root, "fish-profile.svg");
    const r = spawnSync("env", ["FISH_LEAKS=1", bin], { cwd: root });
    assert(r.status === 0, `combined run failed:\n${text(r.stderr)}`);
    assert(!text(r.stderr).includes("leaked"), `unexpected leaks:\n${text(r.stderr)}`);
    assert(existsSync(svg), "default fish-profile.svg not written");
    const sText = read(svg);
    assert(sText.includes("<title>burn (") && sText.includes("<title>burn2 ("), `missing sibling bars:\n${sText.slice(0, 800)}`);
  } finally {
    removed(root);
  }
});
