// The golden runner: builds and runs every program in tests/programs with a fishc binary and
// checks it against the expectations its comments state.
//   fishc run tests/run.fsh -- [--fishc <path>] [--jobs <n>] [--list] [<pattern>]
//
// Each program states its expectations in comments:
//   // expect: <line>   the next line of stdout, in order
//   // error: <text>    compilation must fail with a message containing <text>, and with
//                       exactly one error, so a mistake's follow-on errors fail the test
//   // errors: <n>      compilation must fail with <n> errors, its `error:` texts in order
//   // panic: <text>    the program must exit with 101 and stderr containing <text>
//   // fails: <text>    the program must exit with 1, an error escaping main, and stderr
//                       containing <text>
//   // stderr: <line>   a line of stderr; a program's `stderr:` lines must appear in it together
//                       and in order, with paths in the program's directory read from it
//   // warning: <text>  the build must warn with a message containing <text>, and a program
//                       stating any warning must give no other; one stating none may warn
//   // mode: release    build with --release
//   // mode: abort      build with --panic=abort: a panic aborts (SIGABRT) instead of exiting 101
//   // mode: parse      only parse; passing means it parsed
//   // link: <name>     link the C library <name>, as `--link <name>` does
//   // stdin: "<text>"  what the program reads on stdin, a JSON string; several are joined
// A program spanning several files is a directory holding `main.fsh`, whose comments say what
// to expect, and the files it imports.
//
// A file may hold many programs, each starting at a `// case: <name>` line and running to the
// next. Each case is built and checked on its own, as the file `<name>.fsh` holding just its
// lines, so its line numbers and messages read as they would in a file of its own; its test is
// `<file> > <name>`. Text before the first case is the file's comment and belongs to no case.
//
// The fishc is `--fishc`, else FISHC, else `fishc` on PATH. Programs are built and run as many at
// once as the machine has cores, or FISH_TEST_JOBS, or `--jobs`. A pattern keeps the tests whose
// name contains it. Each failure is printed as it is found. A program that failed while others ran
// beside it is run once more on its own when they are done, and passes if it passes then, named as
// having needed a second run: a program that waits on a timer can miss it on a busy machine. The
// run exits 1 if any failed.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

// A test's program: a file, a directory's `main.fsh`, or a case of a file, written out as its own
// file; or what is wrong with a file's cases.
type Program = { name: string; label: string; file: string; src: string; problem: string };

// What building and running a program gave: the build's printed errors, or its warnings and how
// the program ended.
type Outcome = { failed: boolean; printed: string; warnings: string[]; stdout: string; stderr: string; exitCode: i64; signal: string; timedOut: boolean };

const DIRECTIVES = ["expect", "error", "warning", "panic", "fails", "stderr", "mode", "link", "stdin"];

// Every value a directive takes in a source, in order: the rest of each line after `// <key>: `.
function directive(src: string, key: string): string[] {
  const marker = `// ${key}: `;
  let found: string[] = [];
  for (const line of src.split("\n")) {
    const at = line.indexOf(marker);
    if (at >= 0) found.push(line.slice(at + (marker.length as i64)));
  }
  return found;
}

function isDirective(line: string): boolean {
  return DIRECTIVES.some((key) => line.startsWith(`// ${key}: `));
}

// A case's name is letters, digits, '_' and '-'.
function isName(name: string): boolean {
  if (name === "") return false;
  for (const c of name) if (!/^[\w-]$/.test(c)) return false;
  return true;
}

// A test's name made safe as a file name, as the runner names each program's binary.
function binaryName(name: string): string {
  const bare = name.endsWith(".fsh") ? name.slice(0, (name.length as i64) - 4) : name;
  let out = "";
  let run = false;
  for (const c of bare) {
    if (/^[\w.-]$/.test(c)) {
      out += c;
      run = false;
    } else if (!run) {
      out += "_";
      run = true;
    }
  }
  return out;
}

function programsOf(dir: string, tmp: string, entry: string): Program[] throws IoError {
  const file = entry.endsWith(".fsh") ? join(dir, entry) : join(dir, entry, "main.fsh");
  const src = readFileSync(file, "utf8");
  const lines = src.split("\n");
  if (!entry.endsWith(".fsh") || !lines.some((l) => l.startsWith("// case: "))) return [{ name: entry, label: entry, file, src, problem: "" }];
  const problem = (message: string, line: usize): Program[] => [{ name: entry, label: entry, file, src, problem: `${entry}:${line}: ${message}` }];
  let names: string[] = [];
  let starts: usize[] = [];
  let bodies: string[][] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.startsWith("// case: ")) {
      const name = line.slice(9).trim();
      if (!isName(name)) return problem(`a case's name is letters, digits, '_' and '-', not '${name}'`, i + 1);
      if (names.includes(name)) return problem(`the case '${name}' is named twice`, i + 1);
      names.push(name);
      starts.push(i + 1);
      bodies.push([]);
    } else if (bodies.length > 0) bodies[bodies.length - 1]!.push(line);
    else if (isDirective(line)) return problem("this directive comes before the first case, so it belongs to none", i + 1);
  }
  for (let c = 0; c < names.length; c++) if (bodies[c]!.every((l) => l.trim() === "")) return problem(`the case '${names[c]!}' is empty`, starts[c]!);
  const folder = join(tmp, "cases", entry.slice(0, (entry.length as i64) - 4));
  mkdirSync(folder, { recursive: true });
  let out: Program[] = [];
  for (let c = 0; c < names.length; c++) {
    const text = bodies[c]!.join("\n");
    const path = join(folder, `${names[c]!}.fsh`);
    writeFileSync(path, text);
    out.push({ name: `${entry} > ${names[c]!}`, label: `${names[c]!}.fsh`, file: path, src: text, problem: "" });
  }
  return out;
}

// How many errors a build's printed output names.
function errorCount(text: string): i64 {
  let n = 0;
  const parts = text.split(": error[E");
  for (let i = 1; i < parts.length; i++) if (/^\d+\]/.test(parts[i]!)) n++;
  return n;
}

// A build's warnings, each its header line and the source lines under it.
function warningsOf(stderr: string): string[] {
  let chunks: string[] = [];
  let current: string[] = [];
  for (const line of stderr.split("\n")) {
    if (/^\S+:\d+:\d+: warning/.test(line) && current.length > 0) {
      chunks.push(current.join("\n"));
      current = [];
    }
    current.push(line);
  }
  chunks.push(current.join("\n"));
  return chunks.filter((w) => w.includes(": warning"));
}

// A server or TCP program may run for 30 seconds, since some wait on real time, like closing an
// idle connection, or on a name lookup that slows under load; any other program that runs past 10
// seconds has hung, and is killed.
function limit(name: string): i64 {
  return name.startsWith("http_") || name.startsWith("tcp_") ? 30000 : 10000;
}

function environment(extra: string): { [name: string]: string } {
  let env: { [name: string]: string } = {};
  // A program that serves would trace to whatever collector the runner's own environment names.
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith("OTEL_")) env[k] = v;
  env[extra] = "1";
  return env;
}

// Kills a child still running after its limit, recording that it timed out.
type Watch = { done: Atomic<boolean>; timedOut: Atomic<boolean> };

async function watchdog(pid: i64, ms: i64, w: shared<Watch>): Promise<void> {
  await Bun.sleep(ms);
  if (w.done.load()) return;
  w.timedOut.store(true);
  try {
    process.kill(pid, "SIGKILL");
  } catch (_e) {}
}

// Runs a command to its end, killing it after `ms`, giving its exit code, signal, output and
// whether it timed out.
async function ran(cmd: string[], cwd: string, env: { [name: string]: string }, stdin: u8[] | null, ms: i64): Promise<Outcome> throws IoError {
  const child = stdin === null ? Bun.spawn(cmd, { cwd, env, stdout: "pipe", stderr: "pipe" }) : Bun.spawn(cmd, { cwd, env, stdin: stdin!, stdout: "pipe", stderr: "pipe" });
  const w = shared<Watch>({ done: new Atomic(false), timedOut: new Atomic(false) });
  spawn(watchdog(child.pid, ms, w.clone()));
  const code = await child.exited;
  w.done.store(true);
  let stdout = "";
  for await (const t of child.stdout) stdout += t;
  let stderr = "";
  for await (const t of child.stderr) stderr += t;
  return { failed: false, printed: "", warnings: [], stdout, stderr, exitCode: child.exitCode ?? code, signal: child.signalCode ?? "", timedOut: w.timedOut.load() };
}

async function outcome(fishc: string, tmp: string, p: Program): Promise<Outcome> {
  const empty: Outcome = { failed: false, printed: "", warnings: [], stdout: "", stderr: "", exitCode: 0, signal: "", timedOut: false };
  const buildEnv = environment("NO_COLOR");
  try {
    let args = [fishc];
    if (p.src.includes("// mode: parse")) args = [fishc, "parse", basename(p.file)];
    else {
      args = [fishc, "build", basename(p.file), "-o", join(tmp, binaryName(p.name))];
      if (p.src.includes("// mode: release")) args.push("--release");
      if (p.src.includes("// mode: abort")) args.push("--panic=abort");
      for (const l of directive(p.src, "link")) {
        args.push("--link");
        args.push(l.split(" ")[0]!);
      }
    }
    const built = await ran(args, dirname(p.file), buildEnv, null, 300000);
    if (built.exitCode !== 0 || built.timedOut) {
      const text = `${built.stderr}${built.stdout}`;
      return { ...empty, failed: true, printed: text === "" ? `fishc exited with ${built.signal === "" ? String(built.exitCode) : built.signal}` : text };
    }
    if (p.src.includes("// mode: parse")) return empty;
    const input = directive(p.src, "stdin");
    let joined = "";
    for (const i of input) joined += JSON.parse<string>(i);
    const stdin = input.length > 0 ? new TextEncoder().encode(joined) : null;
    // Every program is checked for leaks: the runtime reports what is still allocated at exit. It
    // runs where the runner does, so its paths to fixtures are relative to the repository.
    const run = await ran([join(tmp, binaryName(p.name))], process.cwd(), environment("FISH_LEAKS"), stdin, limit(p.label));
    return { ...run, warnings: warningsOf(built.stderr) };
  } catch (e) {
    return { ...empty, failed: true, printed: `the runner failed: ${e.message}` };
  }
}

// Escapes nothing: texts are compared literally, each found after the last.
function inOrder(text: string, parts: Ref<string[]>): boolean {
  let at = 0;
  for (const part of parts) {
    const found = text.indexOf(part, at);
    if (found < 0) return false;
    at = found + (part.length as i64);
  }
  return true;
}

// Why a program's outcome doesn't meet what its comments state, or "" when it does.
function verdict(p: Program, run: Outcome): string {
  const src = p.src;
  const errors = directive(src, "error");
  const panics = directive(src, "panic");
  const failures = directive(src, "fails");
  const lines = directive(src, "stderr");
  const warned = directive(src, "warning");
  if (run.failed) {
    if (errors.length === 0) return run.printed;
    const stated = directive(src, "errors");
    const counted = stated.length > 0 ? (parseInt(stated[0]!) ?? 1) : 1;
    const got = errorCount(run.printed);
    if (got !== counted) return `expected ${counted} error(s), got ${got}:\n${run.printed}`;
    if (counted > 1) return inOrder(run.printed, errors) ? "" : `expected the errors in order:\n  ${errors.join("\n  ")}\ngot:\n${run.printed}`;
    for (const e of errors) if (!run.printed.includes(e)) return `expected an error containing '${e}', got:\n${run.printed}`;
    return "";
  }
  if (errors.length > 0) return `expected an error containing '${errors[0]!}', but it built`;
  if (src.includes("// mode: parse")) return "";
  const all = run.warnings.join("\n");
  for (const text of warned) if (!all.includes(text)) return `expected a warning containing '${text}', got:\n${all}`;
  if (warned.length > 0) for (const w of run.warnings) if (!warned.some((text) => w.includes(text))) return `an unexpected warning:\n${w}`;
  if (run.timedOut) return `it ran past ${limit(p.label) / 1000} seconds and was killed`;
  let expected = "";
  for (const line of directive(src, "expect")) expected += line + "\n";
  if (run.stdout !== expected) return `stdout differs:\n--- expected\n${expected}--- got\n${run.stdout}--- stderr\n${run.stderr}`;
  for (const text of [...panics, ...failures]) if (!run.stderr.includes(text)) return `expected stderr containing '${text}', got:\n${run.stderr}`;
  if (lines.length > 0 && !`\n${run.stderr.replaceAll(dirname(p.file) + "/", "")}`.includes(`\n${lines.join("\n")}\n`)) return `expected stderr lines:\n${lines.join("\n")}\ngot:\n${run.stderr}`;
  const abort = src.includes("// mode: abort");
  // A panic that unwinds drops everything on the way out, so it leaks nothing either.
  if (!abort && run.stderr.includes("fish: leaked")) return `it leaked:\n${run.stderr}`;
  if (panics.length > 0 && abort) return run.signal === "SIGABRT" ? "" : `expected SIGABRT, got ${run.signal === "" ? `exit ${run.exitCode}` : run.signal}`;
  const want = panics.length > 0 ? 101 : failures.length > 0 ? 1 : 0;
  if (run.signal !== "") return `expected exit ${want}, got ${run.signal}:\n${run.stderr}`;
  return run.exitCode === want ? "" : `expected exit ${want}, got ${run.exitCode}:\n${run.stderr}`;
}

type Queue = { programs: Program[]; next: Atomic<i64>; fishc: string; tmp: string };

// More failures than this are no accident of timing, and running each again alone would take longer
// than the run did.
const SECOND_RUNS = 20;

// The programs a worker saw fail, by their place in the queue.
async function worker(q: shared<Queue>): Promise<i64[]> {
  let failed: i64[] = [];
  while (true) {
    const i = q.next.add(1);
    if (i >= (q.programs.length as i64)) return failed;
    const p = q.programs[i as usize]!.clone();
    const why = await failure(q.fishc, q.tmp, p.clone());
    if (why !== "") {
      failed.push(i);
      console.log(`fail ${p.name}\n${why.trimEnd()}\n`);
    }
  }
}

// Why a program fails, or "" when it passes.
async function failure(fishc: string, tmp: string, p: Program): Promise<string> {
  if (p.problem !== "") return p.problem;
  const run = await outcome(fishc, tmp, p.clone());
  return verdict(p.clone(), run);
}

async function main(): Promise<void> throws IoError {
  let fishc = process.env.FISHC ?? "fishc";
  let jobs = parseInt(process.env.FISH_TEST_JOBS ?? "") ?? availableParallelism();
  let list = false;
  let pattern = "";
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--fishc" && i + 1 < args.length) fishc = args[++i]!;
    else if (a === "--jobs" && i + 1 < args.length) jobs = parseInt(args[++i]!) ?? jobs;
    else if (a === "--list") list = true;
    else pattern = a;
  }
  const dir = join(import.meta.dir, "programs");
  const tmp = mkdtempSync(join(tmpdir(), "fishc-"));
  let programs: Program[] = [];
  let entries = readdirSync(dir).filter((f) => f.endsWith(".fsh") || existsSync(join(dir, f, "main.fsh")));
  entries.sort();
  for (const entry of entries) for (const p of programsOf(dir, tmp, entry)) if (p.name.includes(pattern)) programs.push(p.clone());
  if (list) {
    for (const p of programs) console.log(p.name);
    return;
  }
  const started = performance.now();
  const total = programs.length as i64;
  const q = shared<Queue>({ programs: programs.clone(), next: new Atomic(0), fishc, tmp });
  let workers: JoinHandle<i64[]>[] = [];
  for (let w = 0; w < jobs; w++) workers.push(spawn(worker(q.clone())));
  let again: i64[] = [];
  while (workers.length > 0) {
    const w = workers.pop()!;
    const saw = await w;
    for (const i of saw) again.push(i);
  }
  let failed = again.length as i64;
  let second = 0;
  if (jobs > 1 && failed <= SECOND_RUNS) {
    again.sort((a, b) => a - b);
    for (const i of again) {
      const p = programs[i as usize]!.clone();
      if (p.problem !== "") continue;
      const why = await failure(fishc, tmp, p.clone());
      if (why === "") {
        failed--;
        second++;
        console.log(`pass ${p.name}, on a second run alone\n`);
      } else console.log(`fail ${p.name}, on a second run alone\n${why.trimEnd()}\n`);
    }
  }
  const seconds = second === 0 ? "" : ` (${second} on a second run)`;
  console.log(`${total - failed} pass${seconds}, ${failed} fail, ${total} programs in ${((performance.now() - started) / 1000).toFixed(0)}s`);
  if (failed > 0) process.exit(1);
}
