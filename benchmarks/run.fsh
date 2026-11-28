// The benchmark suite: Fish against Node and Rust, in release builds.
//   fishc run benchmarks/run.fsh -- [--fishc <path>] [--runs <n>] [--record]
//     [--compare [<commit>]] [--fail-on-regression <pct>] [<pattern>]
//
// cpu: each program in benchmarks/cpu is written three times, main.fsh, main.js and main.rs, and
// must print the same lines in all three. Each is run once to warm up and then `--runs` times
// (5), and its time is the median, in milliseconds, of the whole process from start to exit.
//
// http: one service written three times, benchmarks/http/server.fsh, server.js on Node's http
// module and rust/ on axum and tokio, each driven by benchmarks/load.fsh, the load generator in
// Fish: 8 keep-alive connections sending 40,000 requests to a plain route and to one that reads
// and writes JSON. cargo downloads the Rust service's crates the first time it is built.
//
// A language whose tools aren't on PATH is left out and named. A pattern keeps the benchmarks
// whose name contains it: a cpu program's name, or "http". `--record` appends the results as one
// line of JSON to benchmarks/history.jsonl, with the commit, the machine and the tools' versions,
// which is how the numbers are tracked over time; numbers from two machines don't compare. The
// commit is the checkout's, so it names the fishc only when that was built from it.
//
// `--compare` prints each number's change in percent against an entry of the history recorded on
// this machine: the latest, or the latest whose commit starts with `<commit>`, a hex prefix. It reads
// the history before `--record` appends to it. `--fail-on-regression <pct>` compares too, and exits 1
// when one of Fish's numbers is worse by more than `<pct>` percent: a longer cpu median, fewer
// requests per second, or a higher p50 or p99. Node's and Rust's numbers are shown, never gated.
//
// The fishc is `--fishc`, else FISHC, else `fishc` on PATH.
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { join } from "node:path";
import { environment, ran } from "../tests/harness.fsh";

const LANGUAGES = ["fish", "node", "rust"];
const ROUTES = ["hello", "order"];
const PORT = 18791;
const CONNECTIONS = 8;
const REQUESTS = 40000;
// A build or a run that takes longer than this is taken to have hung.
const LIMIT = 600000;

type Numbers = { [name: string]: f64 };
type Load = { requests: i64; seconds: f64; perSecond: f64; p50: f64; p99: f64; errors: string[] };
type Entry = {
  date: string;
  commit: string;
  machine: string;
  tools: { node: string; rustc: string };
  cpu: { [name: string]: Numbers };
  http: { [language: string]: { [route: string]: Load } };
};

// A command's first line of output, or "" when it can't be run.
async function firstLine(cmd: string[], cwd: string): Promise<string> {
  try {
    const r = await ran(cmd, cwd, environment("NO_COLOR"), null, LIMIT);
    return r.exitCode === 0 ? r.stdout.split("\n")[0].trim() : "";
  } catch (_e) {
    return "";
  }
}

// Runs a build step, ending the run with what it printed when it fails.
async function built(cmd: string[], cwd: string): Promise<void> throws IoError {
  const r = await ran(cmd.clone(), cwd, environment("NO_COLOR"), null, LIMIT);
  if (r.exitCode === 0 && !r.timedOut) return;
  console.error(`benchmarks: '${cmd.join(" ")}' failed:\n${r.stdout}${r.stderr}`);
  process.exit(1);
}

function median(values: f64[]): f64 {
  let sorted = values.clone();
  sorted.sort((a, b) => a - b);
  return sorted[sorted.length / 2];
}

// One cpu program in one language: what it printed, and its median time in milliseconds.
async function timed(cmd: string[], cwd: string, runs: i64): Promise<{ printed: string; ms: f64 }> throws IoError {
  const warm = await ran(cmd.clone(), cwd, environment("NO_COLOR"), null, LIMIT);
  if (warm.exitCode !== 0 || warm.timedOut) return { printed: `exit ${warm.exitCode}: ${warm.stderr}`, ms: -1.0 };
  let times: f64[] = [];
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    await ran(cmd.clone(), cwd, environment("NO_COLOR"), null, LIMIT);
    times.push(performance.now() - start);
  }
  return { printed: warm.stdout, ms: median(times) };
}

async function listening(port: i64): Promise<boolean> {
  for (let i = 0; i < 100; i++) {
    try {
      await TcpStream.connect("127.0.0.1", port);
      return true;
    } catch (_e) {
      await sleep(50);
    }
  }
  return false;
}

// One service under load: requests per second and latencies on each route.
async function served(cmd: string[], cwd: string, load: string, order: string): Promise<{ [route: string]: Load }> throws IoError | JsonError {
  const child = Bun.spawn(cmd, { cwd, env: environment("NO_COLOR"), stdout: "pipe", stderr: "pipe" });
  let out: { [route: string]: Load } = {};
  const up = await listening(PORT);
  if (up) {
    for (const route of ROUTES) {
      const body: string[] = route === "order" ? [order] : [];
      await ran([load, String(PORT), `/${route}`, String(CONNECTIONS), "2000", ...body], cwd, environment("NO_COLOR"), null, LIMIT);
      const r = await ran([load, String(PORT), `/${route}`, String(CONNECTIONS), String(REQUESTS), ...body], cwd, environment("NO_COLOR"), null, LIMIT);
      out[route] = JSON.parse<Load>(r.stdout);
    }
  }
  process.kill(child.pid, "SIGTERM");
  await child.exited;
  return out;
}

function row(cells: string[]): string {
  let out = cells[0].padEnd(8);
  for (let i = 1; i < cells.length; i++) out += cells[i].padStart(18);
  return out;
}

// The history entry to compare with: the latest from this machine, or the latest whose commit
// starts with `commit`, which must be from this machine.
function baseline(history: string, machine: string, commit: string): Entry throws IoError | JsonError {
  const lines: string[] = existsSync(history) ? readFileSync(history, "utf8").split("\n").filter((l) => l.trim() !== "") : [];
  for (const line of lines.toReversed()) {
    const entry = JSON.parse<Entry>(line);
    if (!entry.commit.startsWith(commit)) continue;
    if (entry.machine === machine) return entry;
    if (commit === "") continue;
    console.error(`benchmarks: ${entry.commit} was recorded on ${entry.machine}, not ${machine}, so its numbers don't compare`);
    return process.exit(2);
  }
  console.error(commit === "" ? `benchmarks: nothing in benchmarks/history.jsonl was recorded on ${machine}` : `benchmarks: no entry in benchmarks/history.jsonl has a commit starting with ${commit}`);
  return process.exit(2);
}

function percent(old: f64, now: f64): f64 {
  return ((now - old) / old) * 100.0;
}

function signed(p: f64): string {
  return `${p >= 0.0 ? "+" : ""}${p.toFixed(1)}%`;
}

function compared(cells: string[]): string {
  let out = cells[0].padEnd(14);
  for (let i = 1; i < cells.length; i++) out += cells[i].padStart(12);
  return out;
}

// Prints the run's change against `base` and gives each of Fish's numbers worse by more than
// `threshold` percent; a negative threshold gates nothing.
function compare(base: Ref<Entry>, cpu: Ref<{ [name: string]: Numbers }>, http: Ref<{ [language: string]: { [route: string]: Load } }>, threshold: f64): string[] {
  let worse: string[] = [];
  console.log(`\nchange against ${base.commit.slice(0, 12)} (${base.date}), in percent; + is slower for times, faster for req/s\n${compared(["", ...LANGUAGES])}`);
  for (const name of Object.keys(cpu)) {
    let cells = [name];
    for (const language of LANGUAGES) {
      const was = base.cpu[name];
      const old = was === undefined ? undefined : was[language];
      const mine = cpu[name];
      const now = mine === undefined ? undefined : mine[language];
      if (old === undefined || now === undefined || old <= 0.0) {
        cells.push("-");
        continue;
      }
      if (now < 0.0) {
        cells.push("failed");
        if (language === "fish" && threshold >= 0.0) worse.push(`${name} failed`);
        continue;
      }
      const p = percent(old, now);
      cells.push(signed(p));
      if (language === "fish" && threshold >= 0.0 && p > threshold) worse.push(`${name} ${old.toFixed(0)} -> ${now.toFixed(0)} ms (${signed(p)})`);
    }
    console.log(compared(cells));
  }
  const metrics = ["perSecond", "p50", "p99"];
  for (const route of ROUTES) {
    for (const metric of metrics) {
      let cells = [`${route} ${metric === "perSecond" ? "req/s" : metric}`];
      let any = false;
      for (const language of LANGUAGES) {
        const before = base.http[language];
        const after = http[language];
        const old = before === undefined ? undefined : before[route];
        const now = after === undefined ? undefined : after[route];
        if (old === undefined || now === undefined || old.errors.length > 0) {
          cells.push("-");
          continue;
        }
        any = true;
        if (now.errors.length > 0) {
          cells.push("failed");
          if (language === "fish" && threshold >= 0.0 && metric === "perSecond") worse.push(`${route} failed`);
          continue;
        }
        const was = metric === "perSecond" ? old.perSecond : metric === "p50" ? old.p50 : old.p99;
        const is = metric === "perSecond" ? now.perSecond : metric === "p50" ? now.p50 : now.p99;
        const p = percent(was, is);
        cells.push(signed(p));
        const bad = metric === "perSecond" ? -p : p;
        if (language === "fish" && threshold >= 0.0 && bad > threshold) worse.push(`${cells[0]} ${was.toFixed(0)} -> ${is.toFixed(0)} (${signed(p)})`);
      }
      if (any) console.log(compared(cells));
    }
  }
  return worse;
}

async function main(): Promise<void> throws IoError | JsonError {
  let fishc = process.env.FISHC ?? "fishc";
  let runs = 5;
  let record = false;
  let pattern = "";
  let comparing = false;
  let against = "";
  let threshold = -1.0;
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--fishc" && i + 1 < args.length) fishc = args[++i];
    else if (a === "--runs" && i + 1 < args.length) runs = parseInt(args[++i]) ?? runs;
    else if (a === "--record") record = true;
    else if (a === "--compare") {
      comparing = true;
      if (i + 1 < args.length && /^[0-9a-f]{4,40}$/.test(args[i + 1])) against = args[++i];
    } else if (a === "--fail-on-regression" && i + 1 < args.length) {
      comparing = true;
      threshold = parseFloat(args[++i]) ?? -1.0;
      if (threshold < 0.0) {
        console.error(`benchmarks: --fail-on-regression takes a percentage of 0 or more, not '${args[i]}'`);
        process.exit(2);
      }
    }
    else pattern = a;
  }
  const here = import.meta.dir;
  const history = join(here, "history.jsonl");
  const machine = `${process.platform}-${process.arch}, ${availableParallelism()} cores`;
  const base: Entry | undefined = comparing ? baseline(history, machine, against) : undefined;
  const tmp = mkdtempSync(join(tmpdir(), "fish-benchmarks-"));
  const node = await firstLine(["node", "--version"], here);
  const rustc = await firstLine(["rustc", "--version"], here);
  const cargo = await firstLine(["cargo", "--version"], here);
  const commit = await firstLine(["git", "rev-parse", "HEAD"], here);
  if (node === "") console.log("node isn't on PATH, so its column is left out");
  if (rustc === "") console.log("rustc isn't on PATH, so its column is left out");

  let cpu: { [name: string]: Numbers } = {};
  let names = readdirSync(join(here, "cpu")).filter((n) => n.includes(pattern));
  names.sort();
  if (names.length > 0) console.log(`cpu, median of ${runs} runs, in ms\n${row(["", ...LANGUAGES])}`);
  for (const name of names) {
    const dir = join(here, "cpu", name);
    await built([fishc, "build", "main.fsh", "--release", "-o", join(tmp, `${name}-fish`)], dir);
    if (rustc !== "") await built(["rustc", "-O", "-o", join(tmp, `${name}-rust`), "main.rs"], dir);
    const fish = await timed([join(tmp, `${name}-fish`)], dir, runs);
    let times: Numbers = { fish: fish.ms };
    let cells = [name, fish.ms < 0.0 ? "failed" : fish.ms.toFixed(0)];
    for (const language of ["node", "rust"]) {
      if ((language === "node" ? node : rustc) === "") {
        cells.push("-");
        continue;
      }
      const other = await timed(language === "node" ? ["node", "main.js"] : [join(tmp, `${name}-rust`)], dir, runs);
      if (other.printed !== fish.printed) {
        cells.push("prints otherwise");
        continue;
      }
      times[language] = other.ms;
      cells.push(other.ms.toFixed(0));
    }
    cpu[name] = times;
    console.log(row(cells));
  }

  let http: { [language: string]: { [route: string]: Load } } = {};
  if ("http".includes(pattern)) {
    const dir = join(here, "http");
    const load = join(tmp, "load");
    await built([fishc, "build", "load.fsh", "--release", "-o", load], here);
    await built([fishc, "build", "server.fsh", "--release", "-o", join(tmp, "server-fish")], dir);
    if (cargo !== "") await built(["cargo", "build", "--release", "--quiet"], join(dir, "rust"));
    const order = join(dir, "order.json");
    const fish = await served([join(tmp, "server-fish"), String(PORT)], dir, load, order);
    http["fish"] = fish;
    if (node !== "") {
      const onNode = await served(["node", "server.js", String(PORT)], dir, load, order);
      http["node"] = onNode;
    }
    if (cargo !== "") {
      const onRust = await served([join(dir, "rust", "target", "release", "server"), String(PORT)], dir, load, order);
      http["rust"] = onRust;
    }
    console.log(`\nhttp, ${CONNECTIONS} connections, ${REQUESTS} requests: requests per second, and the 99th percentile in µs\n${row(["", ...LANGUAGES])}`);
    for (const route of ROUTES) {
      let cells = [route];
      for (const language of LANGUAGES) {
        const of = http[language];
        const got = of === undefined ? undefined : of[route];
        cells.push(got === undefined ? "-" : got.errors.length > 0 ? "failed" : `${got.perSecond.toFixed(0)} (${got.p99.toFixed(0)})`);
      }
      console.log(row(cells));
    }
  }

  let worse: string[] = [];
  if (base !== undefined) worse = compare(base, cpu, http, threshold);

  if (record) {
    const line = JSON.stringify({ date: new Date().toISOString(), commit, machine, tools: { node, rustc }, cpu, http });
    writeFileSync(history, (existsSync(history) ? readFileSync(history, "utf8") : "") + line + "\n");
    console.log("\nrecorded in benchmarks/history.jsonl");
  }
  if (worse.length === 0) return;
  console.log(`\nworse by more than ${threshold}%:\n  ${worse.join("\n  ")}`);
  process.exit(1);
}
