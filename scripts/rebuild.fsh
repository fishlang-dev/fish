// Times rebuilds of fishc from a mirror of its own source: a cold release build, a cold dev
// build, a warm dev rebuild of unchanged source, and warm dev rebuilds after a one-file change in
// a leaf file and in a core file. The compiler that builds is given as a command, so the same runs
// time the native fishc and Bun's.
//   fishc run scripts/rebuild.fsh -- <mirror src> <out dir> <fishc command>...
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function timed(label: string, src: string, cache: string, compiler: Ref<string[]>, args: string[]) {
  // /usr/bin/time -l reports peak memory; env gives the run its own cache directory.
  const argv = ["-l", "env", `FISH_CACHE_DIR=${cache}`, ...compiler, "build", "main.fsh", "--timings", ...args];
  const started = performance.now();
  const r = spawnSync("/usr/bin/time", argv, { cwd: src });
  const seconds = (performance.now() - started) / 1000;
  const err = new TextDecoder().decode(r.stderr);
  // A failed build is reported and the remaining runs go on, so an edited file is always restored.
  if (r.status !== 0) {
    console.log(`${label} failed with ${r.status === null ? (r.signal ?? "no status") : String(r.status)}:\n${err.slice(0, 4000)}`);
    return;
  }
  // --timings writes its table first; /usr/bin/time's report starts at the line with "real".
  let peakMiB = 0;
  let stages: string[] = [];
  let report = false;
  for (const line of err.split("\n")) {
    const t = line.trim();
    if (t.includes(" real ")) report = true;
    if (report) {
      if (t.endsWith("maximum resident set size")) peakMiB = (parseInt(t.split(" ")[0]) ?? 0) / 1048576;
    } else if (t !== "") stages.push(t);
  }
  console.log(`${label}: ${seconds.toFixed(0)}s, peak ${peakMiB} MiB`);
  for (const s of stages) console.log(`  ${s}`);
}

// An exported function added at the end of a file changes both what it checks and what it emits.
function withEdit(path: string, f: () => void): void throws IoError {
  const original = readFileSync(path, "utf8");
  writeFileSync(path, original + "\nexport function rebuildProbe(): i64 {\n  return 7;\n}\n");
  try {
    f();
  } finally {
    writeFileSync(path, original);
  }
}

function main(): void throws IoError {
  const args = process.argv.slice(2);
  if (args.length < 3) {
    console.error("usage: rebuild.fsh <mirror src> <out dir> <fishc command>...");
    process.exit(2);
  }
  const src = args[0]!;
  const out = args[1]!;
  const compiler = args.slice(2);
  mkdirSync(out, { recursive: true });
  const release = join(out, "cache-release");
  const dev = join(out, "cache-dev");
  rmSync(release, { recursive: true, force: true });
  rmSync(dev, { recursive: true, force: true });
  const bin = join(out, "fishc");
  timed("cold release build", src, release, compiler, ["--release", "-o", bin]);
  timed("cold dev build", src, dev, compiler, ["-o", bin]);
  timed("warm dev rebuild, unchanged", src, dev, compiler, ["-o", bin]);
  withEdit(join(src, "survey.fsh"), () => {
    timed("warm dev rebuild, leaf file changed (survey.fsh)", src, dev, compiler, ["-o", bin]);
  });
  withEdit(join(src, "check.fsh"), () => {
    timed("warm dev rebuild, core file changed (check.fsh)", src, dev, compiler, ["-o", bin]);
  });
}
