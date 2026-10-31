import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { join } from "node:path";
import { shared } from "../src/compilation.ts";
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
// A file may hold many programs, each starting at a `// case: <name>` line and running to the
// next. Each case is built and checked on its own, as the file `<name>.fsh` holding just its
// lines, so its line numbers and messages read as they would in a file of its own; its test is
// `<file> > <name>`. Text before the first case is the file's comment and belongs to no case.
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
      parse(src, shared.ids);
      return empty;
    }
    const out = join(tmp, name.replace(/\.fsh$/, "").replace(/[^\w.-]+/g, "_"));
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

// A test's program: a file, a directory's `main.fsh`, or a case of a file, which is written out
// as its own file; or what is wrong with a file's cases.
type Program = { label: string; file: string; src: string; problem?: string };
const DIRECTIVE = /^\/\/ (expect|error|panic|fails|mode|link):/;

function programsOf(entry: string): [string, Program][] {
  const file = entry.endsWith(".fsh") ? join(dir, entry) : join(dir, entry, "main.fsh");
  const src = readFileSync(file, "utf8");
  if (!entry.endsWith(".fsh") || !/^\/\/ case: /m.test(src)) return [[entry, { label: entry, file, src }]];
  const problem = (message: string, line: number): [string, Program][] => [[entry, { label: entry, file, src, problem: `${entry}:${line}: ${message}` }]];
  const cases: { name: string; line: number; lines: string[] }[] = [];
  for (const [i, line] of src.split("\n").entries()) {
    const marker = /^\/\/ case: (.*)$/.exec(line);
    if (marker) {
      const name = marker[1]!.trim();
      if (!/^[\w-]+$/.test(name)) return problem(`a case's name is letters, digits, '_' and '-', not '${name}'`, i + 1);
      if (cases.some((c) => c.name === name)) return problem(`the case '${name}' is named twice`, i + 1);
      cases.push({ name, line: i + 1, lines: [] });
    } else if (cases.length > 0) cases.at(-1)!.lines.push(line);
    else if (DIRECTIVE.test(line)) return problem("this directive comes before the first case, so it belongs to none", i + 1);
  }
  const empty = cases.find((c) => c.lines.every((l) => l.trim() === ""));
  if (empty) return problem(`the case '${empty.name}' is empty`, empty.line);
  const folder = join(tmp, "cases", entry.replace(/\.fsh$/, ""));
  mkdirSync(folder, { recursive: true });
  return cases.map((c) => {
    const text = c.lines.join("\n");
    const path = join(folder, `${c.name}.fsh`);
    writeFileSync(path, text);
    return [`${entry} > ${c.name}`, { label: `${c.name}.fsh`, file: path, src: text }];
  });
}

const sources = new Map(readdirSync(dir).filter((f) => f.endsWith(".fsh") || existsSync(join(dir, f, "main.fsh"))).flatMap(programsOf));
const programs = [...sources.keys()];
// A test starts its own program and the next ones, several pools' widths ahead, so a whole run
// keeps every core busy past a slow program while `bun test -t <pattern>` builds little more
// than it selects.
const outcomes = new Map<string, Promise<Outcome>>();
function ahead(at: number) {
  for (const name of programs.slice(at, at + jobs * 8)) {
    const program = sources.get(name)!;
    if (!outcomes.has(name) && !program.problem) outcomes.set(name, pooled(() => outcome(name, program.file, program.src)));
  }
}

for (const name of programs) {
  test(name, async () => {
    const { src, label, problem } = sources.get(name)!;
    if (problem) throw new Error(problem);
    const expected = [...src.matchAll(/\/\/ expect: (.*)/g)].map((m) => m[1] + "\n").join("");
    const errors = [...src.matchAll(/\/\/ error: (.*)/g)].map((m) => m[1]!);
    const panics = [...src.matchAll(/\/\/ panic: (.*)/g)].map((m) => m[1]!);
    const failures = [...src.matchAll(/\/\/ fails: (.*)/g)].map((m) => m[1]!);
    ahead(programs.indexOf(name));
    const run = await outcomes.get(name)!;

    if (run.error !== undefined) {
      if (!(run.error instanceof CompileError) || errors.length === 0) throw run.error;
      const message = formatError(run.error, label, src);
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
