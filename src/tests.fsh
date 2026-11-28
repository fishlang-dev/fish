import { readFileSync, realpathSync } from "node:fs";
import { availableParallelism } from "node:os";
import type { Subprocess } from "bun";
import { relative } from "node:path";
import type { Compilation } from "./compilation.fsh";
import { CompileError } from "./diag.fsh";
import { renameIn, resolveSpecifier, specifierOf, type Loaded, type Module } from "./modules.fsh";
import { nextId, respanFunc, type Ids } from "./nodes.fsh";
import { parse, type Expr, type Func, type ObjectProp, type Span, type Stmt } from "./parser.fsh";

// Top-level `test("name", () => { ... })` blocks: left out of a build, lifted into functions of
// their own file for `fishc test` and the language server, and run by a generated harness.

type Body = Extract<Expr, { kind: "arrow" | "function" }>;
// `index` is the test's place in the harness's numbering; `module` is the file declaring it, by
// its name and its path.
// A test's `timeout` is the limit its options gave it, in milliseconds, or undefined for the run's.
export type Test = { name: string; module: { file: string; path: string }; index: usize; async: boolean; timeout: usize | undefined };

const SHAPE = `a test is written as 'test("name", () => { ... })' at the top level of a file, its name a string literal, with '{ timeout: <ms> }' after the body for a limit of its own`;

// A top-level statement's test: its name, where the name is, whether its body is async, and the
// limit its options give it.
type Found = { name: string; start: usize; end: usize; async: boolean; timeout: usize | undefined };

// The test a top-level statement is, or undefined when it isn't a `test(...)` call.
/** @throws {CompileError} */
export function testOf(s: Ref<Stmt>): Found | undefined {
  if (s.kind !== "expr" || s.expr.kind !== "call" || s.expr.callee.kind !== "ident" || s.expr.callee.name !== "test") return undefined;
  const args: Ref<Expr[]> = s.expr.args;
  const shaped = (args.length === 2 || args.length === 3) && s.expr.typeArgs.length === 0 && !s.expr.optional && args[0]!.kind === "string" && bare(args[1]!);
  if (!shaped) throw new CompileError("E1106", SHAPE, s.expr.start, s.expr.end);
  let timeout: usize | undefined = undefined;
  if (args.length === 3) timeout = timeoutOf(args[2]!);
  const name: Ref<Expr> = args[0]!;
  const body: Ref<Expr> = args[1]!;
  if (name.kind !== "string") return undefined;
  // `--list` and the report give each test one line.
  if (/[\n\r]/.test(name.value)) throw new CompileError("E1106", "a test's name is one line, so it can't hold a line break", name.start, name.end);
  return { name: name.value, start: name.start, end: name.end, async: body.kind === "arrow" ? body.async : body.kind === "function" ? body.async : false, timeout };
}

// The limit a test's options give it: `{ timeout: <ms> }`, an integer literal, read while
// compiling so the harness knows every test's limit before running any.
/** @throws {CompileError} */
function timeoutOf(options: Ref<Expr>): usize {
  const refused = new CompileError("E1106", "a test's options are '{ timeout: <ms> }', its limit in milliseconds as a whole number above 0", options.start, options.end);
  if (options.kind !== "object" || options.props.length !== 1) throw refused;
  const p: Ref<ObjectProp> = options.props[0]!;
  if (p.kind !== "property" || p.key !== "timeout") throw refused;
  const value: Ref<Expr> = p.value;
  if (value.kind !== "int" || value.value <= 0n || value.value > 86_400_000n) throw refused;
  return (Number(String(value.value)) ?? 0) as usize;
}

// Whether `e` is an arrow or a function that isn't a generator, taking no parameters.
function bare(e: Ref<Expr>): boolean {
  if (e.kind === "arrow") return e.params.length === 0 && e.typeParams.length === 0;
  if (e.kind === "function") return !e.generator && e.params.length === 0 && e.typeParams.length === 0;
  return false;
}

// The names of the tests the file at `path` declares, from its parse alone, so a run can build only
// the files it needs; undefined when it can't be read, doesn't parse or holds a malformed test,
// which its build reports.
export function testNamesIn(path: string): string[] | undefined {
  let ids: Ids = { last: 0 };
  let names: string[] = [];
  try {
    for (const s of parse(readFileSync(path, "utf8"), ids)) {
      const found = testOf(s);
      if (found !== undefined) names.push(found.name);
    }
  } catch (e) {
    return undefined;
  }
  return names;
}

// The files `path` imports or re-exports from by a relative path, as real paths: none when it can't
// be read or doesn't parse, and none for an import that names no file.
export function importsIn(path: string): string[] {
  let ids: Ids = { last: 0 };
  let statements: Stmt[] = [];
  try {
    statements = parse(readFileSync(path, "utf8"), ids);
  } catch (_e) {
    return [];
  }
  let found: string[] = [];
  for (const s of statements) {
    const specifier = specifierOf(s);
    if (specifier === undefined || !/^\.\.?(\/|$)/.test(specifier)) continue;
    let looked: string[] = [];
    let file: string | undefined = undefined;
    try {
      file = realpathSync(resolveSpecifier(path, specifier, { start: s.start, end: s.end }, looked));
    } catch (_e) {}
    if (file !== undefined) found.push(file);
  }
  return found;
}

// Each of `roots` with the files it depends on: itself and every file it imports, directly or
// through others, as real paths.
/** @throws {IoError} */
export function dependencies(roots: Ref<string[]>): Map<string, Set<string>> {
  let imports = new Map<string, string[]>();
  let closures = new Map<string, Set<string>>();
  for (const root of roots) {
    let seen = new Set<string>();
    let pending = [realpathSync(root)];
    while (pending.length > 0) {
      const f = pending.pop()!;
      if (seen.has(f)) continue;
      seen.add(f);
      if (!imports.has(f)) imports.set(f, importsIn(f));
      const next = imports.get(f)!;
      for (const g of next) if (!seen.has(g)) pending.push(g);
    }
    closures.set(root, seen);
  }
  return closures;
}

// Leaves every file's tests out, as a build does before checking.
/** @throws {CompileError} */
export function stripTests(loaded: Mut<Loaded>) {
  for (let at: usize = 0; at < loaded.modules.length; at++) {
    const m: Mut<Module> = loaded.modules[at]!;
    // Every statement is looked at before any moves, so a refusal leaves the file as it was.
    let tests: boolean[] = [];
    for (const s of m.statements) tests.push(testOf(s) !== undefined);
    let kept: Stmt[] = [];
    let i: usize = 0;
    while (m.statements.length > 0) {
      const s = m.statements.shift()!;
      if (!tests[i]!) kept.push(s);
      i++;
    }
    m.statements = kept;
  }
}

// The function a test is lifted into. Linking renames a qualified name only up to its first dot, so
// the symbol holds none.
function testSymbol(name: string): string {
  return `test ${JSON.stringify(name).replaceAll(".", "\\u002e")}`;
}

// Turns each test of the files at `paths`, in that order, into a function of its own file,
// `test "name"`, which no program can write. A test's function throws Error, so a body may throw,
// and is async when the body is. Names are unique across the files; a second use of one is refused.
/** @throws {CompileError | Error} */
export function liftTests(compilation: Mut<Compilation>, modules: Mut<Module[]>, paths: Ref<string[]>): Test[] {
  let tests: Test[] = [];
  for (const path of paths) {
    const at = modules.findIndex((m) => m.path === path);
    if (at < 0) continue;
    const module: Mut<Module> = modules[at as usize]!;
    // Each file's tests are named before any statement moves, so a refusal leaves the file as it was.
    let symbols: (string | undefined)[] = [];
    for (const s of module.statements) {
      const found = testOf(s);
      if (found === undefined) {
        symbols.push(undefined);
        continue;
      }
      const name = found.name;
      const twin = tests.find((t) => t.name === name);
      if (twin !== undefined) throw new CompileError("E1106", `there is already a test named '${name}' in '${twin.module.file}'; give each test a name of its own`, found.start, found.end);
      tests.push({ name, module: { file: module.file, path: module.path }, index: tests.length, async: found.async, timeout: found.timeout });
      const symbol = testSymbol(name);
      compilation.names.madeUp.set(symbol, `the test '${name}'`);
      symbols.push(symbol);
    }
    let statements: Stmt[] = [];
    let i: usize = 0;
    while (module.statements.length > 0) {
      const s = module.statements.shift()!;
      const symbol = symbols[i];
      i++;
      if (symbol === undefined) statements.push(s);
      else statements.push(liftedTest(compilation.ids, symbol, s));
    }
    module.statements = statements;
  }
  return tests;
}

// The function a test's statement becomes, `testOf` having found it to be one.
/** @throws {CompileError | Error} */
function liftedTest(ids: Mut<Ids>, name: string, s: Stmt): Func {
  const at: Span = { start: s.start, end: s.end };
  let call = s;
  if (call.kind === "expr" && call.expr.kind === "call") {
    // The body is the second argument, with the options, when there are any, after it.
    if (call.expr.args.length === 3) call.expr.args.pop();
    const body = call.expr.args.pop();
    if (body !== undefined && (body.kind === "arrow" || body.kind === "function")) return lifted(ids, name, body, at);
  }
  throw new Error("internal error: a test is no longer a call of 'test'");
}

/** @throws {CompileError | Error} */
function lifted(ids: Mut<Ids>, name: string, body: Body, at: Ref<Span>): Func {
  let parsed = parse(`${body.async ? "async " : ""}function f(): ${body.async ? "Promise<void>" : "void"} throws Error {}`, ids);
  const made = parsed.shift();
  if (made === undefined || made.kind !== "function") throw new Error("internal error: a test's function didn't parse as one");
  const placed = respanFunc(made, at);
  let statements: Stmt[] = [];
  if (body.kind === "function") statements = body.body;
  else if (Array.isArray(body.body)) statements = body.body;
  else {
    const start = body.body.start;
    const end = body.body.end;
    statements = [{ id: nextId(ids), kind: "expr", expr: body.body, start, end }];
  }
  return { ...placed, id: nextId(ids), name, body: statements };
}

// The harness's text before its tests are known: an import of each of the package's files, so
// all of them are loaded, and what its `main` reads the arguments with and exits through. It is
// native Fish whatever the package's edition.
export function harnessImports(dir: string, files: string[]): string {
  return ["// @fish-edition native", ...files.map((f) => `import ${JSON.stringify(`./${relative(dir, f)}`)};`), 'import { argv, exit } from "std:process";', ""].join("\n");
}

// The harness's `main`. Given `--list`, it prints the test names, one per line, in order; given a
// test's index, it runs that test, which passes when the process exits with 0. A test's function
// is reached as `name-fsh<n>`, the name file n declares, which no program can write.
/** @throws {CompileError} */
export function harnessMain(ids: Mut<Ids>, tests: Ref<Test[]>, modules: Ref<Module[]>): Stmt[] {
  const functions = testFunctions(tests, modules);
  const call = (t: Ref<Test>) => `__test${t.index}`;
  const runs = tests.map((t) => `  if (which === "${t.index}") {\n    ${t.async ? "await " : ""}${call(t)}();\n    return;\n  }\n`);
  const text = `async function main(): Promise<void> throws Error {
  const which = argv.length > 2 ? argv[2] : "";
  if (which === "--list") {
${tests.map((t) => `    console.log(${JSON.stringify(t.name)});\n`).join("")}    return;
  }
${runs.join("")}  console.error(\`no test numbered '\${which}'; run one by its index, or list them with --list\`);
  exit(2);
}
`;
  let made = parse(text, ids);
  let named = new Map<string, string>();
  for (const t of tests) named.set(call(t), functions[t.index]!);
  renameIn(ids, made, (name) => named.get(name));
  return made;
}

// The name each of `tests` is linked as, in their order: the name file n declares, as `name-fsh<n>`.
export function testFunctions(tests: Ref<Test[]>, modules: Ref<Module[]>): string[] {
  return tests.map((t) => `${testSymbol(t.name)}-fsh${modules.findIndex((m) => m.path === t.module.path)}`);
}

// Gives the `main` of each file but the first, std's aside, a name no program can write, since
// the harness is the program's `main`; a test or function calling a file's `main` still reaches it.
export function hideMains(compilation: Mut<Compilation>, modules: Mut<Module[]>) {
  compilation.names.madeUp.set("file main", "'main'");
  for (let at: usize = 1; at < modules.length; at++) {
    const m: Mut<Module> = modules[at]!;
    if (m.path.startsWith("std:")) continue;
    renameIn(compilation.ids, m.statements, (name) => (name === "main" ? "file main" : undefined));
  }
}

// How long a test may run when neither it nor the run names a limit, in milliseconds.
export const LIMIT: usize = 10_000;

// How a run goes: the limit for a test that names none, how many tests run at once, and whether
// tests are tried in the comptime interpreter before their native build.
export type RunOptions = { timeout: usize; jobs: usize; interpret: boolean };

export type Outcome = { passed: boolean; output: string };

// Ends every test running now, along with anything it started: `running` holds the process
// groups of a run's tests while they run.
export function stopTests(running: Mut<Set<i32>>) {
  for (const group of [...running]) ended(running, group);
}

function ended(running: Mut<Set<i32>>, group: i32) {
  running.delete(group);
  try {
    process.kill(-(group as i64), "SIGKILL");
  } catch {
    // The group is already gone.
  }
}

// A test running now: its place in the run, its child and the child's process group, its output
// as it is read, its limit, when it runs past it, and whether it has.
type Running = { at: usize; child: Subprocess; group: i32; output: Promise<string>; limit: usize; deadline: f64; late: boolean };

// What a round of waiting saw first: the test at `at` exiting, or running past the limit.
type Event = { kind: "exit"; at: usize; code: i64 } | { kind: "timeout"; at: usize };

// Starts `test` in a process group of its own, noted in `running`, its output read as it runs.
/** @throws {IoError} */
function started(running: Mut<Set<i32>>, binary: string, test: Ref<Test>, cwd: string, at: usize, timeout: usize): Running {
  const child = Bun.spawn([binary, String(test.index)], { cwd, stdin: "ignore", stdout: "pipe", stderr: "pipe", detached: true });
  const group = child.pid as i32;
  running.add(group);
  const output: Promise<string> = outputOf(new Response(child.stdout), new Response(child.stderr));
  const limit = test.timeout ?? timeout;
  return { at, child, group, output, limit, deadline: performance.now() + (limit as f64), late: false };
}

async function outputOf(stdout: Response, stderr: Response): Promise<string> {
  const [out, err] = await Promise.all([stdout.text(), stderr.text()]);
  return out + err;
}

// The first of the running tests to exit, or the one soonest past the limit to get there. Fish
// drops the waits that lose a race, and a child's exit can be waited for again, so each round
// waits afresh.
async function nextEvent(flight: Ref<Running[]>): Promise<Event> {
  let waits: Promise<Event>[] = [];
  let timed = false;
  let soonest: usize = 0;
  let due: f64 = 0;
  for (const r of flight) {
    waits.push(exitOf(r.child.exited, r.at));
    if (!r.late && (!timed || r.deadline < due)) {
      timed = true;
      soonest = r.at;
      due = r.deadline;
    }
  }
  if (timed) waits.push(pastLimit(Math.max(0, Math.ceil(due - performance.now())) as i64, soonest));
  return await Promise.race(waits);
}

async function exitOf(exited: Promise<i64>, at: usize): Promise<Event> {
  const code = await exited;
  return { kind: "exit", at, code };
}

async function pastLimit(ms: i64, at: usize): Promise<Event> {
  await Bun.sleep(ms);
  return { kind: "timeout", at };
}

// A limit as the report shows it: whole seconds as `10s`, anything else in milliseconds.
function shownLimit(ms: usize): string {
  return ms % 1000 === 0 ? `${ms / 1000}s` : `${ms}ms`;
}

// The run's defaults: the standard limit, and a test per core.
export function runDefaults(): RunOptions {
  return { timeout: LIMIT, jobs: availableParallelism() as usize, interpret: false };
}

// A test fails when it exits with anything but 0 or runs past the limit.
function outcome(text: string, code: i64, late: boolean, signal: string | null, limit: usize): Outcome {
  const passed = code === 0 && !late;
  if (late) return { passed, output: `${text}timed out after ${shownLimit(limit)}\n` };
  if (passed || text !== "") return { passed, output: text };
  return { passed, output: signal !== null ? `killed by ${signal}\n` : `exited with ${code}\n` };
}

// Runs each of `tests` in the program `binary`, as many at once as `options.jobs`, and reports them
// in order: `ok` or `FAIL`, the file and the name, a failed test's output, then the counts, noting
// each test's process group in `running` while it runs. A test past its own limit, or the run's, has
// its group killed; once a test exits, the rest of its group is killed, as a child it left behind
// would otherwise hold its output open, and the verdict is the test's own. A test `known` holds by
// its index already ran in the interpreter and isn't started; with `options.interpret` each line
// says which way its test ran. Gives the exit code, 1 when any failed.
export async function runTests(running: Mut<Set<i32>>, binary: string, tests: Ref<Test[]>, cwd: string, options: Ref<RunOptions>, known: Ref<Map<usize, Outcome>>): Promise<i64> {
  const width = Math.min(options.jobs as i64, tests.length as i64);
  let flight: Running[] = [];
  let done: (Outcome | undefined)[] = [];
  for (let at: usize = 0; at < tests.length; at++) {
    const o = known.get(tests[at]!.index);
    done.push(o === undefined ? undefined : { passed: o.passed, output: o.output });
  }
  let next: usize = 0;
  let shown: usize = 0;
  let failed = 0;
  while (true) {
    while (next < tests.length && (flight.length as i64) < width) {
      const at = next;
      next++;
      if (known.has(tests[at]!.index)) continue;
      try {
        // Started before the push, so `flight` is lent to it only once nothing can throw.
        const r = started(running, binary, tests[at]!, cwd, at, options.timeout);
        flight.push(r);
      } catch (e) {
        done[at] = { passed: false, output: `the test couldn't be run: ${e instanceof Error ? e.message : (e as IoError).message}\n` };
      }
    }
    while (shown < tests.length) {
      const o: Ref<Outcome | undefined> = done[shown];
      if (o === undefined) break;
      const test: Ref<Test> = tests[shown]!;
      if (!o.passed) failed++;
      const way = !options.interpret ? "" : known.has(test.index) ? " (interpreted)" : " (native)";
      process.stdout.write(`${o.passed ? "ok" : "FAIL"} ${test.module.file} > ${test.name}${way}\n${o.passed ? "" : o.output}`);
      shown++;
    }
    if (shown === tests.length) break;
    const event = await nextEvent(flight);
    if (event.kind === "timeout") {
      for (let i: usize = 0; i < flight.length; i++) {
        if (flight[i]!.at !== event.at) continue;
        flight[i]!.late = true;
        ended(running, flight[i]!.group);
      }
      continue;
    }
    let still: Running[] = [];
    let exited: Running | undefined = undefined;
    while (flight.length > 0) {
      const r = flight.shift()!;
      if (r.at === event.at && exited === undefined) exited = r;
      else still.push(r);
    }
    flight = still;
    if (exited === undefined) continue;
    ended(running, exited.group);
    const text = await exited.output;
    const signal = exited.child.signalCode;
    done[event.at] = outcome(text, event.code, exited.late, signal === null ? null : `${signal}`, exited.limit);
  }
  console.log(`${tests.length - failed} passed, ${failed} failed`);
  return failed > 0 ? 1 : 0;
}
