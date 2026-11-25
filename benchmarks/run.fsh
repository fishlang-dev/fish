// The benchmark suite: Fish against Node and Rust, in release builds.
//   fishc run benchmarks/run.fsh -- [--fishc <path>] [--runs <n>] [--record] [<pattern>]
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
// which is how the numbers are tracked over time; numbers from two machines don't compare.
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

async function main(): Promise<void> throws IoError | JsonError {
  let fishc = process.env.FISHC ?? "fishc";
  let runs = 5;
  let record = false;
  let pattern = "";
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--fishc" && i + 1 < args.length) fishc = args[++i];
    else if (a === "--runs" && i + 1 < args.length) runs = parseInt(args[++i]) ?? runs;
    else if (a === "--record") record = true;
    else pattern = a;
  }
  const here = import.meta.dir;
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

  if (!record) return;
  const fishcVersion = await firstLine([fishc, "--version"], here);
  const line = JSON.stringify({ date: new Date().toISOString(), commit, machine: `${process.platform}-${process.arch}, ${availableParallelism()} cores`, tools: { fishc: fishcVersion, node, rustc }, cpu, http });
  const history = join(here, "history.jsonl");
  writeFileSync(history, (existsSync(history) ? readFileSync(history, "utf8") : "") + line + "\n");
  console.log("\nrecorded in benchmarks/history.jsonl");
}
