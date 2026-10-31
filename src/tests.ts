import { availableParallelism } from "node:os";
import { relative } from "node:path";
import { freshId, shared } from "./compilation.ts";
import { CompileError } from "./diag.ts";
import { renameIn, type Loaded, type Module } from "./modules.ts";
import { parse, type Expr, type Func, type Span, type Stmt } from "./parser.ts";

// Top-level `test("name", () => { ... })` blocks: left out of a build, lifted into functions of
// their own file for `fishc test` and the language server, and run by a generated harness.

type Body = Extract<Expr, { kind: "arrow" | "function" }>;
// `index` is the test's place in the harness's numbering; `module` is the file declaring it.
export type Test = { name: string; module: Module; index: number; async: boolean };

const SHAPE = `a test is written as 'test("name", () => { ... })' at the top level of a file, its name a string literal`;

// The name and body a top-level statement's test has, or undefined when it isn't a `test(...)` call.
function testOf(s: Stmt): { name: Extract<Expr, { kind: "string" }>; body: Body } | undefined {
  if (s.kind !== "expr" || s.expr.kind !== "call" || s.expr.callee.kind !== "ident" || s.expr.callee.name !== "test") return undefined;
  const { args, typeArgs, optional } = s.expr;
  const [name, body] = args;
  const shaped = args.length === 2 && typeArgs.length === 0 && !optional && name?.kind === "string" && (body?.kind === "arrow" || (body?.kind === "function" && !body.generator));
  if (!shaped || body.params.length > 0 || body.typeParams.length > 0) throw new CompileError(SHAPE, s.expr.start, s.expr.end);
  // `--list` and the report give each test one line.
  if (/[\n\r]/.test(name.value)) throw new CompileError("a test's name is one line, so it can't hold a line break", name.start, name.end);
  return { name, body };
}

// Leaves every file's tests out, as a build does before checking.
export function stripTests({ modules }: Loaded) {
  for (const m of modules) m.statements = m.statements.filter((s) => !testOf(s));
}

// Turns each test of `modules`, in order, into a function of its own file, `test "name"`, which
// no program can write. A test's function throws Error, so a body may throw, and is async when
// the body is. Names are unique across the files; a second use of one is refused.
export function liftTests(modules: Module[]): Test[] {
  const tests: Test[] = [];
  for (const module of modules) {
    module.statements = module.statements.map((s) => {
      const found = testOf(s);
      if (!found) return s;
      const { name, body } = found;
      const twin = tests.find((t) => t.name === name.value);
      if (twin) throw new CompileError(`there is already a test named '${name.value}' in '${twin.module.file}'; give each test a name of its own`, name.start, name.end);
      tests.push({ name: name.value, module, index: tests.length, async: body.async });
      const symbol = `test ${JSON.stringify(name.value)}`;
      shared.names.madeUp.set(symbol, `the test '${name.value}'`);
      return lifted(symbol, body, s);
    });
  }
  return tests;
}

function lifted(name: string, body: Body, at: Span): Func {
  const [made] = parse(`${body.async ? "async " : ""}function f(): ${body.async ? "Promise<void>" : "void"} throws Error {}`, shared.ids) as [Func];
  placed(made, at);
  const statements: Stmt[] = Array.isArray(body.body) ? body.body : [{ id: freshId(), kind: "expr", expr: body.body, start: body.body.start, end: body.body.end }];
  return { ...made, id: freshId(), name, body: statements };
}

// Gives every node of a made tree the span `at`, where its parts are written.
function placed(v: unknown, at: Span) {
  if (Array.isArray(v)) return v.forEach((x) => placed(x, at));
  if (typeof v !== "object" || v === null) return;
  Object.assign(v, { start: at.start, end: at.end });
  Object.values(v).forEach((x) => placed(x, at));
}

// The harness's text before its tests are known: an import of each of the package's files, so
// all of them are loaded, and what its `main` reads the arguments with and exits through. It is
// native Fish whatever the package's edition.
export function harnessImports(dir: string, files: string[]): string {
  return ["// @fish-edition native", ...files.map((f) => `import ${JSON.stringify(`./${relative(dir, f)}`)};`), 'import { argv, exit } from "node:process";', ""].join("\n");
}

// The harness's `main`. Given `--list`, it prints the test names, one per line, in order; given a
// test's index, it runs that test, which passes when the process exits with 0. A test's function
// is reached as `name-fsh<n>`, the name file n declares, which no program can write.
export function harnessMain(tests: Test[], modules: Module[]): Stmt[] {
  const call = (t: Test) => `__test${t.index}`;
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
  const made = parse(text, shared.ids);
  const named = new Map(tests.map((t) => [call(t), `test ${JSON.stringify(t.name)}-fsh${modules.indexOf(t.module)}`]));
  const rename = (v: unknown) => {
    if (Array.isArray(v)) return v.forEach(rename);
    if (typeof v !== "object" || v === null) return;
    const node = v as { kind?: string; name?: string };
    if (node.kind === "ident" && named.has(node.name!)) node.name = named.get(node.name!);
    Object.values(node).forEach(rename);
  };
  rename(made);
  return made;
}

// Gives each file's `main` a name no program can write, since the harness is the program's
// `main`; a test or function calling a file's `main` still reaches it.
export function hideMains(modules: Module[]) {
  shared.names.madeUp.set("file main", "'main'");
  for (const m of modules) renameIn(m.statements, (name) => (name === "main" ? "file main" : undefined));
}

const LIMIT = 10_000;

type Outcome = { passed: boolean; output: string };

// The process groups of the tests running now.
const running = new Set<number>();

// Ends every test running now, along with anything it started.
export function stopTests() {
  for (const group of running) ended(group);
}

function ended(group: number) {
  running.delete(group);
  try {
    process.kill(-group, "SIGKILL");
  } catch {
    // The group is already gone.
  }
}

// Runs `test` in a process group of its own, failing it when it exits with anything but 0 or runs
// past the limit. Once it exits, the rest of its group is killed: a child it left behind would
// otherwise hold its output open, and the verdict is the test's own.
async function run(binary: string, test: Test, cwd: string): Promise<Outcome> {
  const child = Bun.spawn([binary, String(test.index)], { cwd, stdin: "ignore", stdout: "pipe", stderr: "pipe", detached: true });
  running.add(child.pid);
  const output = Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
  let late = false;
  const timer = setTimeout(() => {
    late = true;
    ended(child.pid);
  }, LIMIT);
  const code = await child.exited;
  clearTimeout(timer);
  ended(child.pid);
  const [stdout, stderr] = await output;
  const text = stdout + stderr;
  const passed = code === 0 && !late;
  if (late) return { passed, output: `${text}timed out after ${LIMIT / 1000}s\n` };
  if (passed || text !== "") return { passed, output: text };
  return { passed, output: child.signalCode ? `killed by ${child.signalCode}\n` : `exited with ${code}\n` };
}

// Runs each of `tests` in the program `binary`, as many at once as the machine has cores, and
// reports them in order: `ok` or `FAIL`, the file and the name, a failed test's output, then the
// counts. Gives the exit code, 1 when any failed.
export async function runTests(binary: string, tests: Test[], cwd: string): Promise<number> {
  const outcomes = tests.map(() => Promise.withResolvers<Outcome>());
  let next = 0;
  const worker = async () => {
    for (let at = next++; at < tests.length; at = next++) outcomes[at]!.resolve(await run(binary, tests[at]!, cwd).catch((e) => ({ passed: false, output: `the test couldn't be run: ${e instanceof Error ? e.message : e}\n` })));
  };
  for (let n = 0; n < Math.min(availableParallelism(), tests.length); n++) void worker();
  let failed = 0;
  for (const [at, test] of tests.entries()) {
    const { passed, output } = await outcomes[at]!.promise;
    if (!passed) failed++;
    process.stdout.write(`${passed ? "ok" : "FAIL"} ${test.module.file} > ${test.name}\n${passed ? "" : output}`);
  }
  console.log(`${tests.length - failed} passed, ${failed} failed`);
  return failed > 0 ? 1 : 0;
}
