// The self-build budget: a fishc builds src cold, as a dev build and as the -O2 release build, each
// under /usr/bin/time -l (macOS's) with --timings and FISH_USAGE=1 in an empty FISH_CACHE_DIR
// holding only a copy of stage 0. Prints each stage's wall and CPU time and the peaks of fishc and
// clang as it ended, then each build's wall time, CPU time, peak resident (fishc or any clang),
// fishc's peak footprint and the binary's size, against the targets in benchmarks/budget.json and
// the baseline in benchmarks/budget-baseline.json. A target missed is reported; the exit code is 1
// only when a build's totals are worse than the baseline by more than budget.json's noise. A
// stage's own numbers are marked, not gated, since an item may move work from one stage to
// another. `--record` writes this run as the baseline. The baseline is one machine's: a run on
// another says so and compares nothing. A fishc that takes --timings-json also gives the files each
// build's time went to, the costliest printed after its table and not gated, since an item may move
// work from one file to another.
//   fishc run scripts/budget.fsh -- [--fishc <path>] [--build dev|release] [--record]
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { cacheDir, hostKey } from "./stage0.fsh";

type Phase = { stage: string; ms: f64; cpu: f64; peak: i64; children: i64 };
type Build = { kind: string; wall: f64; cpu: f64; peak: i64; footprint: i64; size: i64; phases: Phase[] };
type FileRow = { file: string; parse: f64; check: f64; codegen: f64; instances: i64 };
type Timed = { files: FileRow[] };
type Baseline = { machine: string; commit: string; recorded: string; builds: Build[] };
type Noise = { time: f64; seconds: f64; memory: f64; bytes: i64; size: f64 };
type Budget = { wall: f64[]; peak: i64[]; noise: Noise };

const KINDS = ["dev", "release"];

function option(args: Ref<string[]>, flag: string): string | undefined {
  for (let i: usize = 0; i + 1 < args.length; i++) if (args[i]! === flag) return args[i + 1]!.clone();
  return undefined;
}

function fail(message: string): never {
  console.error(`budget: ${message}`);
  return process.exit(2);
}

function output(cmd: string, args: string[], cwd: string): string {
  const r = spawnSync(cmd, args, { cwd });
  return r.status === 0 ? new TextDecoder().decode(r.stdout).trim() : "";
}

function machine(): string {
  return `${hostKey()}, ${output("sysctl", ["-n", "machdep.cpu.brand_string"], ".")}, ${availableParallelism()} cores`;
}

function number(text: string, pattern: RegExp): f64 {
  const m = pattern.exec(text);
  return m === null ? -1 : parseFloat(m![0]!.split(" ")[0]!) ?? -1;
}

// Each `--timings` line's stage and ms, joined with FISH_USAGE's line for the same stage.
function phasesOf(err: string): Phase[] {
  const usage = /^(\w+) +(\d+\.\d) ms +([\d.]+|\?)(?: MiB)? +([\d.]+|\?)(?: MiB)?$/;
  let phases: Phase[] = [];
  for (const line of err.split("\n")) {
    const t = /^(\w+) +(\d+\.\d) ms/.exec(line);
    if (t !== null && t![1] !== "total" && !usage.test(line)) phases.push({ stage: t![1], ms: parseFloat(t![2])!, cpu: 0, peak: -1, children: -1 });
  }
  const mib = (s: string) => (s === "?" ? -1 : Math.round(parseFloat(s)! * 1048576) as i64);
  for (const line of err.split("\n")) {
    const u = usage.exec(line);
    if (u === null) continue;
    for (let i: usize = 0; i < phases.length; i++) {
      if (phases[i]!.stage !== u![1]) continue;
      phases[i]!.cpu = parseFloat(u![2])!;
      phases[i]!.peak = mib(u![3]);
      phases[i]!.children = mib(u![4]);
    }
  }
  return phases;
}

// Whether `fishc` takes --timings-json, which a fishc built before it doesn't know.
function writesJson(fishc: string): boolean {
  const r = spawnSync(fishc, ["check", "none.fsh", "--timings-json", "none.json"], { cwd: tmpdir() });
  return !new TextDecoder().decode(r.stderr).includes("--timings-json");
}

// The costliest `shown` files of a build's --timings-json.
function costliest(json: string, shown: usize): void throws IoError | JsonError {
  const files = JSON.parse<Timed>(readFileSync(json, "utf8")).files;
  const s = (ms: f64) => `${(ms / 1000).toFixed(1)} s`;
  console.log(row(["file", "parse", "check", "codegen", "instances"]));
  for (let i: usize = 0; i < files.length && i < shown; i++) {
    const f: Ref<FileRow> = files[i]!;
    console.log(row([f.file, s(f.parse), s(f.check), s(f.codegen), `${f.instances}`]));
  }
}

// One cold build of `src` by `fishc`, measured, its costliest files printed when `json`.
function measured(fishc: string, src: string, kind: string, json: boolean): Build throws IoError | JsonError {
  const cache = mkdtempSync(join(tmpdir(), "fish-budget-"));
  try {
    if (spawnSync("cp", ["-R", join(cacheDir(), "stage0"), join(cache, "stage0")]).status !== 0) fail(`can't copy stage 0 from ${cacheDir()}`);
    const log = join(cache, "stderr.txt");
    const out = join(cache, "fishc");
    const release = kind === "release" ? "--release" : "";
    console.log(`building src cold, ${kind}, with ${fishc}`);
    const started = performance.now();
    const timings = join(cache, "timings.json");
    const asJson = json ? `--timings-json "${timings}"` : "";
    const r = spawnSync("sh", ["-c", `FISH_CACHE_DIR="$2" FISH_USAGE=1 /usr/bin/time -l "$0" build main.fsh ${release} --timings ${asJson} -o "$3" 2> "$1" > /dev/null`, fishc, log, cache, out], { cwd: src });
    const err = readFileSync(log, "utf8");
    if (r.status !== 0) fail(`the ${kind} build exited with ${r.status ?? -1}:\n${err.slice(-4000)}`);
    console.log(`  done in ${Math.round((performance.now() - started) / 1000)}s`);
    if (json) costliest(timings, 10);
    const real = number(err, /([\d.]+) real/);
    const cpu = number(err, /([\d.]+) user/) + number(err, /([\d.]+) sys/);
    const peak = number(err, /(\d+) +maximum resident set size/) as i64;
    const footprint = number(err, /(\d+) +peak memory footprint/) as i64;
    return { kind, wall: real, cpu, peak, footprint, size: statSync(out).size as i64, phases: phasesOf(err) };
  } finally {
    rmSync(cache, { recursive: true, force: true });
  }
}

function gb(n: i64): string {
  return n < 0 ? "?" : `${((n as f64) / 1073741824).toFixed(2)} GB`;
}

function mb(n: i64): string {
  return n < 0 ? "?" : `${((n as f64) / 1048576).toFixed(1)} MB`;
}

// `now` against `was`, signed, as a percentage of `was`.
function delta(now: f64, was: f64): string {
  if (was <= 0) return "";
  const pct = (now - was) / was * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
}

function slower(now: f64, was: f64, n: Ref<Noise>): boolean {
  return now > was * (1 + n.time) && now > was + n.seconds;
}

function bigger(now: i64, was: i64, n: Ref<Noise>): boolean {
  return (now as f64) > (was as f64) * (1.0 + n.memory) && now > was + n.bytes;
}

function row(cells: string[]): string {
  return cells.map((c, i) => (i === 0 ? c.padEnd(16) : c.padStart(14))).join(" ");
}

// Prints `b` against `base`, giving the regressions beyond noise.
function compared(b: Ref<Build>, base: Build | undefined, budget: Ref<Budget>): string[] {
  const n: Ref<Noise> = budget.noise;
  let worse: string[] = [];
  console.log(`\n${b.kind} build`);
  console.log(row(["stage", "wall", "cpu", "fishc peak", "clang peak", "baseline wall", "change"]));
  for (const p of b.phases) {
    let was: Phase | undefined = undefined;
    if (base !== undefined) for (const q of base!.phases) if (q.stage === p.stage) was = q.clone();
    const change = was === undefined ? "" : delta(p.ms, was!.ms);
    const mark = was !== undefined && slower(p.ms / 1000, was!.ms / 1000, n) ? " !" : "";
    console.log(row([p.stage, `${(p.ms / 1000).toFixed(1)} s`, `${(p.cpu / 1000).toFixed(1)} s`, mb(p.peak), mb(p.children), was === undefined ? "" : `${(was!.ms / 1000).toFixed(1)} s`, `${change}${mark}`]));
  }
  const missWall = b.wall > budget.wall[1]! ? `missed, target ${budget.wall[0]!}-${budget.wall[1]!} s` : "met";
  const missPeak = b.peak > budget.peak[1]! ? `missed, target ${gb(budget.peak[0]!)}-${gb(budget.peak[1]!)}` : "met";
  console.log(row(["total", "now", "baseline", "change", "target"]));
  const totals: [string, f64, f64, string, string][] = [
    ["wall", b.wall, base === undefined ? -1 : base!.wall, `${b.wall.toFixed(1)} s`, missWall],
    ["cpu", b.cpu, base === undefined ? -1 : base!.cpu, `${b.cpu.toFixed(1)} s`, ""],
  ];
  for (const [name, now, was, shown, target] of totals) {
    const bad = was >= 0 && slower(now, was, n);
    if (bad) worse.push(`${b.kind} ${name} ${shown}, baseline ${was.toFixed(1)} s`);
    console.log(row([name, shown, was < 0 ? "" : `${was.toFixed(1)} s`, `${delta(now, was)}${bad ? " !" : ""}`, target]));
  }
  const sizes: [string, i64, i64, string][] = [
    ["peak", b.peak, base === undefined ? -1 : base!.peak, missPeak],
    ["footprint", b.footprint, base === undefined ? -1 : base!.footprint, ""],
  ];
  for (const [name, now, was, target] of sizes) {
    const bad = was >= 0 && bigger(now, was, n);
    if (bad) worse.push(`${b.kind} ${name} ${gb(now)}, baseline ${gb(was)}`);
    console.log(row([name, gb(now), was < 0 ? "" : gb(was), `${delta(now as f64, was as f64)}${bad ? " !" : ""}`, target]));
  }
  const was = base === undefined ? -1 : base!.size;
  const grew = was >= 0 && (b.size as f64) > (was as f64) * (1 + n.size);
  if (grew) worse.push(`${b.kind} binary ${mb(b.size)}, baseline ${mb(was)}`);
  console.log(row(["binary", mb(b.size), was < 0 ? "" : mb(was), `${delta(b.size as f64, was as f64)}${grew ? " !" : ""}`, ""]));
  return worse;
}

function written(b: Ref<Baseline>): string {
  const builds = b.builds.map((x) => `    ${JSON.stringify(x)}`).join(",\n");
  return `{\n  "machine": ${JSON.stringify(b.machine)},\n  "commit": ${JSON.stringify(b.commit)},\n  "recorded": ${JSON.stringify(b.recorded)},\n  "builds": [\n${builds}\n  ]\n}\n`;
}

function main(): void throws IoError | Error | JsonError {
  if (process.platform !== "darwin") fail("the budget reads macOS's /usr/bin/time -l; on another system it has no numbers to read yet");
  const args = process.argv.slice(2);
  const root = join(import.meta.dir, "..");
  const fishc = resolve(option(args, "--fishc") ?? join(root, "build", "fishc"));
  if (!existsSync(fishc)) fail(`no fishc at ${fishc}; build one with 'fishc run scripts/build.fsh', or give --fishc <path>`);
  const only = option(args, "--build");
  if (only !== undefined && !KINDS.includes(only!)) fail(`--build takes dev or release, not '${only!}'`);
  const budget = JSON.parse<Budget>(readFileSync(join(root, "benchmarks", "budget.json"), "utf8"));
  const baselineFile = join(root, "benchmarks", "budget-baseline.json");
  const here = machine();
  let base: Baseline | undefined = undefined;
  if (existsSync(baselineFile)) {
    const b = JSON.parse<Baseline>(readFileSync(baselineFile, "utf8"));
    if (b.machine === here) base = b;
    else console.log(`the baseline is ${b.machine}'s and this is ${here}: nothing is compared`);
  } else console.log("no baseline recorded yet: record one with --record");
  let builds: Build[] = [];
  const json = writesJson(fishc);
  for (const kind of KINDS) if (only === undefined || only! === kind) builds.push(measured(fishc, join(root, "src"), kind, json));
  let worse: string[] = [];
  for (const b of builds) {
    let was: Build | undefined = undefined;
    if (base !== undefined) for (const x of base!.builds) if (x.kind === b.kind) was = x.clone();
    for (const w of compared(b, was, budget)) worse.push(w);
  }
  if (args.includes("--record")) {
    let kept: Build[] = [];
    if (base !== undefined) for (const x of base!.builds) if (!builds.some((b) => b.kind === x.kind)) kept.push(x.clone());
    for (const b of builds) kept.push(b.clone());
    const commit = output("git", ["rev-parse", "--short", "HEAD"], root);
    writeFileSync(baselineFile, written({ machine: here, commit, recorded: new Date().toISOString(), builds: kept }));
    console.log(`\nrecorded the baseline in ${baselineFile}`);
    return;
  }
  if (worse.length === 0) return;
  console.error(`\nbudget: worse than the baseline beyond noise:\n${worse.map((w) => `  ${w}`).join("\n")}`);
  process.exit(1);
}
