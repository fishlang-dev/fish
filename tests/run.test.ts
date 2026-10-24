import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { join } from "node:path";
import { CompileError, formatError } from "../src/diag.ts";
import { buildAsync } from "../src/main.ts";
import { parse } from "../src/parser.ts";

// Each program in tests/programs states its expectations in comments:
//   // expect: <line>   the next line of stdout, in order
//   // error: <text>    compilation must fail with a message containing <text>
//   // panic: <text>    the program must exit with 101 and stderr containing <text>
//   // fails: <text>    the program must exit with 1, an error escaping main, and stderr
//                       containing <text>
//   // mode: release    build with --release
//   // mode: abort      build with --panic=abort: a panic aborts (SIGABRT) instead of exiting 101
//   // mode: parse      only parse; passing means it parsed
//   // link: <name>     link the C library <name>, as `--link <name>` does
// A program spanning several files is a directory holding `main.fsh`, whose comments say what
// to expect, and the files it imports.
//
// Programs are built and run concurrently, as many at once as the machine has cores, or
// FISH_TEST_JOBS; each test waits for its own program and checks it, in order.
const dir = join(import.meta.dir, "programs");
const tmp = mkdtempSync(join(tmpdir(), "fishc-"));
const jobs = Number(process.env.FISH_TEST_JOBS) || availableParallelism();

// What building and running a program gave: a compile error, or its output and how it ended.
type Outcome = { error?: unknown; stdout: string; stderr: string; exitCode: number | null; signal: string | number | null; timedOut: boolean };

let running = 0;
const waiting: (() => void)[] = [];

async function pooled<T>(work: () => Promise<T>): Promise<T> {
  while (running >= jobs) await new Promise<void>((go) => waiting.push(go));
  running++;
  try {
    return await work();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

// A server program may run for 30 seconds, since some wait on real time, like closing an idle
// connection; any other program that runs past 10 seconds has hung, and is killed.
const limit = (name: string) => (name.startsWith("http_") ? 30_000 : 10_000);

async function outcome(name: string, file: string, src: string): Promise<Outcome> {
  const empty = { stdout: "", stderr: "", exitCode: 0, signal: null, timedOut: false };
  try {
    if (src.includes("// mode: parse")) {
      parse(src);
      return empty;
    }
    const out = join(tmp, name.replace(/\.fsh$/, ""));
    const links = [...src.matchAll(/\/\/ link: (\S+)/g)].map((m) => m[1]!);
    await buildAsync(file, out, src.includes("// mode: release"), src.includes("// mode: abort") ? "abort" : "unwind", links);
    // Every program is checked for leaks: the runtime reports what is still allocated at exit.
    const run = Bun.spawn([out], { env: { ...process.env, FISH_LEAKS: "1" }, stdout: "pipe", stderr: "pipe" });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      run.kill();
    }, limit(name));
    const [stdout, stderr] = await Promise.all([new Response(run.stdout).text(), new Response(run.stderr).text()]);
    await run.exited;
    clearTimeout(timer);
    return { stdout, stderr, exitCode: run.exitCode, signal: run.signalCode, timedOut };
  } catch (error) {
    return { ...empty, error };
  }
}

const programs = readdirSync(dir).filter((f) => f.endsWith(".fsh") || existsSync(join(dir, f, "main.fsh")));
const sources = new Map(programs.map((name) => {
  const file = name.endsWith(".fsh") ? join(dir, name) : join(dir, name, "main.fsh");
  return [name, { file, src: readFileSync(file, "utf8") }];
}));
// A test starts its own program and the next ones, several pools' widths ahead, so a whole run
// keeps every core busy past a slow program while `bun test -t <pattern>` builds little more
// than it selects.
const outcomes = new Map<string, Promise<Outcome>>();
function ahead(at: number) {
  for (const name of programs.slice(at, at + jobs * 8)) {
    if (!outcomes.has(name)) outcomes.set(name, pooled(() => outcome(name, sources.get(name)!.file, sources.get(name)!.src)));
  }
}

for (const name of programs) {
  test(name, async () => {
    const { src } = sources.get(name)!;
    const expected = [...src.matchAll(/\/\/ expect: (.*)/g)].map((m) => m[1] + "\n").join("");
    const errors = [...src.matchAll(/\/\/ error: (.*)/g)].map((m) => m[1]!);
    const panics = [...src.matchAll(/\/\/ panic: (.*)/g)].map((m) => m[1]!);
    const failures = [...src.matchAll(/\/\/ fails: (.*)/g)].map((m) => m[1]!);
    ahead(programs.indexOf(name));
    const run = await outcomes.get(name)!;

    if (run.error !== undefined) {
      if (!(run.error instanceof CompileError) || errors.length === 0) throw run.error;
      const message = formatError(run.error, name, src);
      for (const error of errors) expect(message).toContain(error);
      return;
    }
    expect(errors).toEqual([]);
    if (src.includes("// mode: parse")) return;

    expect(run.timedOut).toBe(false);
    expect(run.stdout).toBe(expected);
    for (const text of [...panics, ...failures]) expect(run.stderr).toContain(text);
    // A panic that unwinds drops everything on the way out, so it leaks nothing either.
    if (!src.includes("// mode: abort")) expect(run.stderr).not.toContain("fish: leaked");
    if (panics.length > 0 && src.includes("// mode: abort")) expect(run.signal).toBe("SIGABRT");
    else expect(run.exitCode).toBe(panics.length > 0 ? 101 : failures.length > 0 ? 1 : 0);
  }, limit(name) + 30_000);
}
