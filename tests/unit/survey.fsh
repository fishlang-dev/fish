// Each project is a fresh directory removed at the test's end, the CLI
// is the native fishc, and an object Bun compares with toEqual is shown here as sorted lines or as
// its JSON, so it prints in full when it differs.
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { dependencies, type Dependencies } from "../../src/deps.fsh";
import { formatRanking, rank, readPlan, stepsOf, type Curve, type Plan, type Ranking, type Step, type Unit } from "../../src/rank.fsh";
import { compare, featureOf, featuresOf, formatComparison, formatReport, grade, readReport, scanFiles, survey, type Builtin, type Comparison, type Report, type RuleCount } from "../../src/survey.fsh";
import { fishc, root, same, type Ran } from "./support.fsh";

function sample(): string {
  return join(root(), "tests", "survey", "sample");
}

function cli(args: string[]): Ran {
  return fishc(root(), args);
}

// Fails the test with both lists shown when they differ.
function list(got: Ref<string[]>, want: Ref<string[]>, what: string): void {
  assert(got === want, `${what}:\n--- expected\n${want.join("\n")}\n--- got\n${got.join("\n")}`);
}

function sorted(xs: string[]): string[] {
  let out = xs;
  out.sort();
  return out;
}

// A project in a fresh directory, from file paths to their text.
function project(files: Ref<[string, string][]>): string {
  let dir = "";
  try {
    dir = mkdtempSync(join(tmpdir(), "survey-"));
    for (const [path, text] of files) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), text);
    }
  } catch (e) {
    assert(false, `can't write a project: ${e.message}`);
  }
  return dir;
}

function done(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch (_e) {}
}

function readable(path: string): boolean {
  try {
    readdirSync(path);
    return true;
  } catch (_e) {
    return false;
  }
}

// What each rule counts, those above zero, as sorted `id: count` lines.
function nonzero(r: Ref<Report>): string[] {
  let out: string[] = [];
  for (const x of r.rules) if (x.count > 0) out.push(`${x.id}: ${x.count}`);
  for (const x of r.waiting) if (x.count > 0) out.push(`${x.id}: ${x.count}`);
  return sorted(out);
}

// What each rule counts in one snippet of TypeScript.
function counts(src: string): string[] {
  const dir = project([["main.ts", src]]);
  const found = nonzero(survey(dir));
  done(dir);
  return found;
}

function countsAre(src: string, want: string[]): void {
  list(counts(src), sorted(want), src);
}

// The features each file waits on, as JSON.
function features(dir: string): string {
  return JSON.stringify(scanFiles(dir).map((f) => featuresOf(f)));
}

function rule(r: Ref<Report>, id: string, waiting: boolean): usize {
  const all: Ref<RuleCount[]> = waiting ? r.waiting : r.rules;
  for (let i: usize = 0; i < all.length; i++) if (all[i]!.id === id) return i;
  assert(false, `no rule ${id}`);
  return 0;
}

function ranked(dirs: Ref<string[]>, self?: string, plan?: Plan): Ranking {
  try {
    return rank(dirs, self, plan);
  } catch (e) {
    assert(false, `rank throws ${e.message}`);
    return { repos: [], curve: { start: { files: 0, lines: 0, share: 0 }, steps: [], unread: [] } };
  }
}

function planOf(path: string): Plan {
  try {
    return readPlan(path);
  } catch (e) {
    assert(false, `readPlan throws ${e.message}`);
    return new Map<string, { item: string; done: boolean }>();
  }
}

test("each rule counts what the sample shows", () => {
  list(nonzero(survey(sample())), sorted([
    "parse: 1", "R1: 1", "R2: 1", "R3: 1", "declarators: 1",
    "forIn: 1", "decorators: 1",
    "G1: 3", "G6: 1", "G7: 1", "G8: 1", "G10: 1", "A1: 1", "A2: 1", "A3: 1", "A4: 1", "A8: 1", "A9: 1",
  ]), "counts");
});

test("fetch counts as available", () => {
  countsAre('async function f(): Promise<string> {\n  const res = await fetch("http://localhost/");\n  return await res.text();\n}\n', []);
});

test("G12 counts disposal beyond a class's own disposers, which 'using' and 'await using' run", () => {
  countsAre("class C {\n  [Symbol.dispose]() {}\n}\n", []);
  countsAre("class C {\n  async [Symbol.asyncDispose]() {}\n}\n", []);
  countsAre("class C {\n  [Symbol.asyncDispose]() {}\n}\n", ["G12: 1"]);
  countsAre("class C {\n  [Symbol.dispose]() {}\n}\nconst k = Symbol.asyncDispose;\nconst s = new DisposableStack();\n", ["G12: 2"]);
});

test("using declarations over a class with a disposer parse, so their file isn't counted as unparsed", () => {
  countsAre("class C {\n  [Symbol.dispose]() {}\n}\nfunction f() {\n  using c = new C();\n}\n", []);
  countsAre("class C {\n  async [Symbol.asyncDispose]() {}\n}\nasync function f() {\n  await using c = new C();\n}\n", []);
});

test("the reject rules are counted through the migration detector, R5 to R7 too", () => {
  countsAre('function f() {\n  eval("1");\n  const g = new Function("x");\n  A.prototype.m = g;\n  Object.defineProperty(o, "k", {});\n  delete o.k;\n}\n', ["R1: 2", "R2: 2", "R3: 1"]);
  countsAre('function f() {\n  return arguments.length;\n}\nconst s = Symbol("s");\n', ["R5: 1", "R6: 1"]);
  countsAre("interface I { a: number }\ninterface I { b: number }\nclass C {}\nnamespace C { export const x = 1; }\n", ["R7: 2", "namespaces: 1"]);
});

test("A1, A3 and A8 are counted through the migration detector, as before, fixable or not", () => {
  countsAre("var a = 1;\nfor (var i = 0; i < 2; i++) {}\ndeclare var d: number;\nconst b = a == 1 || x != y;\nconst u = JSON.parse(s) as U;\nconst v = JSON.parse<U>(s) as U;\n", ["A1: 2", "A3: 2", "A8: 2"]);
});

test("the survey counts G2, G3 and G11 through the migration detector, with rows for each", () => {
  countsAre("async function save(): Promise<void> {}\nfunction main(xs: number[], i: number) {\n  const a = { n: 1 };\n  const b = a;\n  b.n = 2;\n  save();\n  return xs[i] + a.n;\n}\n", ["G2: 1", "G3: 1", "G11: 1"]);
  const dir = project([["a.ts", "export const x = 1;\n"]]);
  const r = survey(dir);
  let ids: string[] = [];
  for (const x of r.rules) ids.push(x.id);
  for (const x of r.waiting) ids.push(x.id);
  for (const id of ["G2", "G3", "G11"]) assert(ids.includes(id), `no row for ${id}`);
  done(dir);
});

test("import.meta is counted unless it reads a member Fish fixes while compiling", () => {
  countsAre("const a = import.meta.dir;\nconst b = join(import.meta.dirname, import.meta.file, import.meta.env.HOME);\nif (import.meta.main) run(import.meta.path, import.meta.url);\n", ["importMeta: 1"]);
  countsAre('const r = import.meta.resolve("x");\nconst m = import.meta;\nconst t = new.target;\n', ["importMeta: 2"]);
  countsAre('const { file, dirname } = import.meta;\nconst p = import.meta["filename"];\n', []);
});

test("the timer forms Fish doesn't take are counted, and the timers it does aren't", () => {
  countsAre("function main() {\n  setTimeout(f, 1);\n  const t = setInterval(f, 2, a, b);\n  clearTimeout(t);\n}\n", []);
  countsAre("function main() {\n  setImmediate(f);\n  setTimeout(f, 1).unref();\n  setTimeout(f, 1, a, b, c);\n}\n", ["timerForms: 3"]);
  countsAre("function main() {\n  auth.refresh();\n  page.hasRef();\n}\n", []);
});

test("forms that look alike are told apart", () => {
  countsAre("const a = JSON.parse(s) as User;\nconst b = JSON.stringify(a);\n", ["A8: 1"]);
  countsAre("const a = JSON.parse(s);\nconst b = JSON.stringify(a, null, 2);\n", ["json: 1"]);
  countsAre("const a = JSON.parse(s, revive) as User;\n", ["A8: 1", "json: 1"]);
  countsAre('import os from "node:os";\nimport { hostname } from "os";\nimport { cpus } from "os";\n', ["nodeBuiltins: 1"]);
  countsAre('export { hostname } from "node:os";\nexport * from "os";\n', []);
  countsAre('export * as system from "os";\n', ["nodeBuiltins: 1"]);
  countsAre('import { connect } from "node:tls";\nimport * as tls from "tls";\nexport const s = tls.connect(443, "x");\nimport https from "node:https";\n', ["nodeBuiltins: 3"]);
  same(`${featureOf("nodeBuiltins", "tls") ?? "undefined"}, ${featureOf("nodeBuiltins", "https") ?? "undefined"}`, "node:tls, node:http server shim", "featureOf");
  countsAre('import path from "path";\nimport { sep } from "path";\nexport function f(x: string) {\n  return path.join(x, sep) + path.toNamespacedPath(x);\n}\n', ["nodeBuiltins: 1"]);
  countsAre('import path from "node:path";\nexport const b = path.isAbsolute(x) ? path.format(path.parse(x)) : x;\n', []);
  countsAre("function f() {\n  console.error(1);\n  console.warn(2);\n  console.info(3);\n  const t = Date.now() + performance.now();\n}\n", ["console: 1"]);
  countsAre("function f() {\n  const a = process.argv[2];\n  const h = process.env.HOME;\n  process.exit(1);\n}\n", []);
  countsAre('function f() {\n  process.env.X = "y";\n  delete process.env.Y;\n  const p = process.ppid;\n}\n', ["process: 3", "R3: 1"]);
  countsAre('function f() {\n  process.stdout.write("a");\n  process.stderr.write("b");\n  const t = process.stdout.isTTY;\n  const o = process.stdout;\n}\n', ["process: 2"]);
  countsAre("function f() {\n  const { HOME } = process.env;\n  const k = Object.keys(process.env);\n  const e = process.env;\n  const h = process.env?.HOME;\n  process.env.N++;\n}\n", ["process: 4"]);
  countsAre('async function f() {\n  const t = await Bun.file("a").text();\n  Bun.spawnSync(["ls"], { cwd: Bun.env.HOME });\n  await Bun.sleep(1);\n  return Bun.which("sh") + Bun.version;\n}\n', []);
  countsAre("function f() {\n  const c = Bun.gc(true);\n  return Bun.build({ entrypoints: [] });\n}\n", ["bunGlobals: 2"]);
  countsAre("const Bun = { spawn() {} };\nfunction f() {\n  Bun.spawn();\n}\n", []);
  countsAre('import { which, sleep, serve } from "bun";\nimport { password } from "bun";\n', ["bunModules: 1"]);
  countsAre("type F = (x: number) => void;\nconst g = function () { return 1; };\n", ["A9: 1"]);
  countsAre("declare const DEV: boolean;\nlet a = 1;\nexport let b = 2;\nfor (const x of [1]) {}\n", ["A4: 2"]);
  countsAre("export function f(): i64 { return 1; }\nexport const x = 1;\nexport interface I {}\n", []);
  countsAre('"use strict";\nsetup();\n', ["G7: 1"]);
  countsAre("for (const [k, v] of m) {}\nfor (const { x, y: z } of ps) {}\nfor (const [a = 1] of q) {}\n", ["destructuring: 1"]);
  countsAre('const { [K]: a, [E.B]: b, ["c"]: c } = o;\nfor (const { [K]: x } of ps) {}\nconst { [f()]: d } = o;\nconst { [Symbol.iterator]: it } = o;\n', ["destructuring: 2"]);
  countsAre("function f() { enum E { A } class C {} }\n", []);
  countsAre("function f(n: number) { class C { m() { return n; } } class D { m(k: number) { return k; } } }\n", ["localCaptures: 1"]);
  countsAre("const s = f.call(o, 1);\nconst p = Promise.all([]);\nconst q = Promise.any([]);\n", ["G9: 1"]);
  countsAre("class A { #x = 1; get #g() { return 1; } m(o: A) { return this.#x + (#x in o ? 1 : 0); } }\n", ["classForms: 1"]);
  countsAre("﻿var y = 2;\n", ["A1: 1"]);
  countsAre("function f(a?: string) { return () => class {}; }\n", ["A2: 1"]);
  countsAre('const a = Number.parseInt(s);\nconst f = Function("x");\n', ["R1: 1"]);
  countsAre("const r = Math.random();\nconst n = Math.floor(Math.sqrt(x) * Math.PI);\n", []);
  countsAre('const a = /x+/.test(s) && /(y)/.exec(s);\nconst b = new RegExp("z", "i");\nconst c = new RegExp(`w`);\n', []);
  countsAre("const a = /x+/g.test(s);\nconst i = re.lastIndex;\n", ["regexState: 2"]);
  countsAre("function f() { [a, b] = [b, a]; g([c] = [1]); }\n", ["destructuringAssignment: 1"]);
  countsAre("const id = <T>(x: T) => x;\nconst g = f(<T>(x: T) => x);\ntype F = <T>(x: T) => T;\ninterface I { m<T>(x: T): T }\nclass C { m<T>(x: T): T { return x; } }\n", []);
  countsAre("class D { f: <T>(x: T) => T = id; }\nconst xs: (<T>(x: T) => T)[] = [];\nconst u: (<T>(x: T) => T) | number = 1;\n", ["genericFunctionsHeld: 3"]);
  countsAre('const a = s.match("x") && s.search(`y`);\nconst n = s.matchAll(/z/g).next();\nconst r = s.replaceAll("a", "b") + s.replaceAll(/a/g, "b");\n', ["regexStrings: 3"]);
  countsAre('const r = new RegExp(p);\nconst t = s.replace(/a/g, "b").split(/,/);\nconst u = s.replace("a", "b");\n', ["dynamicRegex: 1"]);
  countsAre('declare let d: number;\ndeclare global { var g: number; }\ndeclare module "m" { export const x: number; }\n', ["namespaces: 2", "R7: 2"]);
  countsAre("abstract class A { abstract x: number; abstract m(): void; abstract get g(): number; }\n", ["classForms: 1"]);
  countsAre("function main(): void {}\nmain();\nmain().catch(report);\n", []);
  countsAre('const a = String.raw`\\d+${x}`;\nconst b = sql`select ${x}`;\nconst c = String.raw({ raw: ["a"] });\n', ["tagged: 1"]);
});

test("each file names the planned features it waits on", () => {
  const dir = project([
    ["a.ts", "const o = { ...base, port: 1 };\nconst xs = [...ys];\n"],
    ["b.ts", "let a, b;\n[a, b] = [1, 2];\nconst { x } = p;\n"],
    ["c.ts", "const = ;\n"],
    ["d.ts", "function main(): void {}\n"],
  ]);
  list(sorted(scanFiles(dir).map((f) => `${f.file}: ${JSON.stringify(featuresOf(f))}`)), ["a.ts: []", "b.ts: []", 'c.ts: ["parser gaps"]', "d.ts: []"], "features");
  done(dir);
});

test("a member call points at its method, and each rule keeps its first three examples", () => {
  const dir = project([["main.ts", "const a = b.c.d.call(f).call(g).call(h).call(i);\n"]]);
  const r = survey(dir);
  const g9: Ref<RuleCount> = r.rules[rule(r, "G9", false)]!;
  assert(g9.count === 4, `G9 counts ${g9.count}`);
  same(g9.examples.map((e) => `${e.col}`).join(", "), "17, 25, 33", "the columns");
  done(dir);
});

test("discovery takes .ts, .tsx and .mts, and skips dependencies, hidden directories, declarations and links", () => {
  const dir = project([
    ["a.ts", "var a = 1;\n"], ["b.mts", "var b = 1;\n"], ["c.tsx", "var c = 1;\n"], ["d.d.ts", "var d: number;\n"], ["e.d.mts", "var e: number;\n"],
    ["node_modules/dep/index.ts", "var f = 1;\n"], [".cache/g.ts", "var g = 1;\n"],
  ]);
  try {
    symlinkSync(join(dir, "a.ts"), join(dir, "link.ts"));
    symlinkSync(dir, join(dir, "loop"));
  } catch (e) {
    assert(false, e.message);
  }
  const r = survey(dir);
  assert(r.files === 3, `${r.files} files`);
  const a1 = r.rules[rule(r, "A1", false)]!.count;
  assert(a1 === 3, `A1 counts ${a1}`);
  done(dir);
});

test("JSX is read, and counted as a rewrite to guide", () => {
  const dir = project([["view.tsx", "const name = 'a';\nconst v = <div class=\"x\">{name}</div>;\nconst w = <p/>;\n"]]);
  const r = survey(dir);
  same(`${r.lines} ${r.unread.files}`, "3 0", "lines read and files unread");
  const jsx = r.rules[rule(r, "jsx", false)]!.count;
  assert(jsx === 2, `jsx counts ${jsx}`);
  done(dir);
});

test("a file that can't be read adds its own blocker, not its lines", () => {
  const dir = project([["ok.ts", "delete o.k;\n"], ["bad.ts", "let x!: number;\nconst = ;\n"], ["view.tsx", "const v = <div>;\n"]]);
  const r = survey(dir);
  assert(r.lines === 1, `${r.lines} lines`);
  same(`${r.unread.files} ${r.unread.lines}`, "2 3", "unread files and lines");
  const parse: Ref<RuleCount> = r.waiting[rule(r, "parse", true)]!;
  const note = parse.examples.length > 0 ? parse.examples[0]!.note ?? "" : "";
  assert(note.includes("expected"), `the note: ${note}`);
  assert(parse.count === 2, `parse counts ${parse.count}`);
  // Graded per 1000 lines at least; with most lines unread, no grade at all.
  assert(r.score === 13, `score ${r.score}`);
  assert(r.grade === null, `grade ${r.grade ?? "none"}`);
  assert(formatReport(r).includes("no grade: only 25% of the lines could be read"), formatReport(r));
  done(dir);
  const second = project([["a.tsx", "delete globalThis.x;\nconst v = <div>;\n"]]);
  assert(survey(second).grade === null, "a.tsx is graded");
  done(second);
  const third = project([["a.tsx", "let x!: number;\n"]]);
  const t = survey(third);
  const parses = t.waiting[rule(t, "parse", true)]!.count;
  assert(parses === 1, `parse counts ${parses}`);
  done(third);
});

test("an unreadable file or directory is skipped, and a deeply nested file is unread", () => {
  // The deeply nested file is left out: natively it overflows the stack rather than being reported
  // as too deeply nested, as Bun's RangeError lets it be.
  const dir = project([["a.ts", "var a = 1;\n"], ["secret/b.ts", "var b = 1;\n"]]);
  try {
    chmodSync(join(dir, "secret"), 0o000);
    const r = survey(dir);
    // As root a mode of 000 doesn't stop reading, so the directory is surveyed after all.
    const files: usize = readable(join(dir, "secret")) ? 2 : 1;
    chmodSync(join(dir, "secret"), 0o755);
    assert(r.files === files, `${r.files} files`);
    assert(r.unread.files === 0, `${r.unread.files} unread`);
  } catch (e) {
    assert(false, e.message);
  }
  done(dir);
});

test("the grade counts rejected constructs and guided rewrites per 1000 lines", () => {
  const scores: f64[] = [0, 5, 5.1, 15, 15.1, 40, 40.1, 100, 100.1];
  same(scores.map((s) => grade(s)).join(""), "AABBCCDDF", "grades");
  const r = survey(sample());
  const weighed = (10 * r.counts.reject + 3 * r.counts.guided) as f64;
  const lines = (r.lines > 1000 ? r.lines : 1000) as f64;
  const want = Math.round((weighed * 1000) / lines * 10) / 10;
  assert(r.score === want, `score ${r.score}, not ${want}`);
  const dir = project([["main.ts", "function main(): void {\n  const x: number = 1;\n  console.log(x.toString());\n}\n"]]);
  const text = formatReport(survey(dir));
  assert(text.includes("grade A (score 0 per 1000 lines)"), text);
  done(dir);
});

test("the JSON lists every rule, with zero counts", () => {
  const run = cli(["survey", sample(), "--json"]);
  try {
    const r = JSON.parse<Report>(run.out);
    same(JSON.stringify(r), JSON.stringify(survey(sample())), "the report");
    assert(r.rules.length + r.waiting.length === 58, `${r.rules.length + r.waiting.length} rules`);
  } catch (e) {
    assert(false, `the JSON doesn't parse as a report: ${e.message}\n${run.out}${run.err}`);
  }
});

test("fishc survey prints the grade, the rewrites and what Fish still needs, with locations", () => {
  const run = cli(["survey", sample()]);
  const out = run.out;
  assert(run.code === 0, `exit code ${run.code}: ${run.err}`);
  assert(out.includes("fishc survey: 3 files"), out);
  assert(/grade [A-F] \(score [\d.]+ per 1000 lines, from \d+% of the lines\)/.test(out), out);
  assert(out.includes("top rewrites"), out);
  assert(out.includes("waiting on Fish"), out);
  assert(/e\.g\. src\/broken\.ts:1:7 \(expected/.test(out), out);
});

test("fishc survey refuses a missing directory, a file, and a directory with no TypeScript", () => {
  const missing = cli(["survey", join(sample(), "missing")]);
  assert(missing.err.includes("doesn't exist"), missing.err);
  const file = cli(["survey", join(sample(), "src", "app.ts")]);
  assert(file.code === 2, `a file: exit code ${file.code}`);
  const dir = project([["readme.md", "hi\n"]]);
  const run = cli(["survey", dir]);
  assert(run.code === 2, `no TypeScript: exit code ${run.code}`);
  assert(run.err.includes("holds no TypeScript files"), run.err);
  done(dir);
  const build = cli(["build", "x.fsh", "--json"]);
  assert(build.code === 2, `build --json: exit code ${build.code}`);
});

function big(): string {
  return "const xs = console.debug(f, 1);\n".repeat(10);
}

function steps(r: Ref<Ranking>): string[] {
  return r.curve.steps.map((s) => `${s.feature} ${s.gained.files} ${s.gained.lines} ${s.portable.share}`);
}

test("the curve picks the feature freeing the most lines first, and frees a file only once all it needs exist", () => {
  const one = project([["a.ts", big()], ["b.ts", "for (const k in o) {}\n"], ["c.ts", "namespace N {}\nfor (const k in o) {}\n"]]);
  const two = project([["d.ts", "function main(): void {}\n"]]);
  const r = ranked([one, two]);
  same(`${r.curve.start.files} ${r.curve.start.lines} ${r.curve.start.share}`, "1 1 7.1", "the start");
  list(steps(r), ["The rest of console 1 10 78.5", "for...in 1 1 85.7", "Namespaces 1 2 100"], "the steps");
  const second: Ref<{ rules: string[]; files: usize; lines: usize }> = r.curve.steps[1]!;
  same(`${second.rules.join(",")} ${second.files} ${second.lines}`, "forIn 2 3", "the second step");
  same(r.repos.map((x) => `${x.files}`).join(", "), "3, 1", "the repos' files");
  done(one);
  done(two);
});

test("a project using Buffer ports, but for the Buffer members std lacks, found by name", () => {
  const dir = project([
    ["a.ts", 'import { Buffer } from "node:buffer";\nexport function pack(a: Uint8Array): Buffer {\n  const head = Buffer.alloc(4);\n  head.writeUInt32BE(a.length, 0);\n  return Buffer.concat([head, Buffer.from(a)]);\n}\n'],
    ["b.ts", "export const one = 1;\n"],
  ]);
  const r = ranked([dir]);
  assert(r.curve.start.share < 100, `start share ${r.curve.start.share}`);
  same(r.curve.steps.map((s) => s.feature).join(", "), "Node built-ins", "the steps");
  same(features(dir), '[["Node built-ins"],[]]', "the features");
  done(dir);
});

function selfSteps(r: Ref<Ranking>): string[] {
  const own: Ref<{ dir: string; curve: Curve } | undefined> = r.self;
  if (own === undefined) return ["no self curve"];
  return own.curve.steps.map((s) => `${s.feature} ${s.portable.share}`);
}

test("unread files are left out of the steps but not the shares, and the self curve stands alone", () => {
  const repo = project([["a.ts", big()], ["bad.ts", "const = ;\n"], ["v.tsx", "const v = <div>;\nconst w = 1;\n"]]);
  const self = project([["s.ts", "for (const k in o) {}\n"]]);
  const r = ranked([repo], self);
  same(`${r.repos[0]!.unread.files} ${r.repos[0]!.unread.lines}`, "2 3", "unread");
  list(r.curve.steps.map((s) => `${s.feature} ${s.portable.share}`), ["The rest of console 76.9"], "the steps");
  list(r.curve.unread.map((u) => `${u.feature} ${u.files} ${u.lines}`), ["parser gaps 2 3"], "unread");
  assert(formatRanking(r).includes("also waiting, in files Fish couldn't read"), formatRanking(r));
  list(selfSteps(r), ["for...in 100"], "the self steps");
  done(repo);
  done(self);
});

test("imports wait on other files or Node built-ins by how they are written, and npm packages run", () => {
  const first = project([["a.ts", 'import x from "./x";\n'], ["b.ts", 'import { z } from "zod";\nimport y from "@s/y";\n'], ["c.ts", 'import tty from "node:tty";\nimport crypto = require("crypto");\n']]);
  same(features(first), '[[],[],["Node built-ins","Terminal detection and styled text"]]', "relative, npm and built-in imports");
  done(first);
  const second = project([["a.ts", 'import w from "ws";\nimport { test } from "bun:test";\n'], ["b.ts", 'import x from "~/x";\nimport y from "@/y";\nimport z from "#z";\n'], ["c.ts", 'async function f() { return await import("pkg"); }\n']]);
  same(features(second), `[["Bun's own modules"],["Path aliases"],["Namespace imports"]]`, "bun, aliases and dynamic imports");
  const scans = scanFiles(second);
  const rules = scans[0]!.findings.map((x) => x[0]);
  assert(rules.includes("bunModules"), rules.join(", "));
  done(second);
  const third = project([["a.ts", 'import * as w from "ws";\nexport { x } from "ws";\n'], ["b.ts", 'import q = require("ws");\n'], ["c.ts", 'export * from "ws";\n']]);
  same(features(third), '[[],["Namespace imports"],["Namespace imports"]]', "namespace forms");
  done(third);
});

test("an installed package with no declarations waits on calling JsValues; a typed or missing one doesn't", () => {
  const dir = project([
    ["a.ts", 'import u from "untyped";\n'], ["b.ts", 'import t from "typed";\n'], ["c.ts", 'import m from "missing";\n'],
    ["node_modules/untyped/package.json", '{"name":"untyped","main":"i.js"}'], ["node_modules/untyped/i.js", "module.exports = 1;\n"],
    ["node_modules/typed/package.json", '{"name":"typed","main":"i.js","types":"i.d.ts"}'], ["node_modules/typed/i.js", "module.exports = 1;\n"],
    ["node_modules/typed/i.d.ts", "declare const t: number;\nexport default t;\n"],
  ]);
  same(features(dir), '[["Calling JsValues"],[],[]]', "the features");
  done(dir);
});

test("ties go to the feature carrying most of what waits, then to the name, despite float noise", () => {
  // Ten 1-line files share their line among ten features, so A weighs ten tenths, which floats
  // add to just under 1; B and Z weigh exactly 1, tied with A, which comes first by name.
  let units: Unit[] = [];
  for (let i: i64 = 0; i < 10; i++) {
    let waits = new Set<string>(["A"]);
    for (let k: i64 = 0; k < 9; k++) waits.add(`F${i}-${k}`);
    units.push({ lines: 1, waits, rules: [] });
  }
  units.push({ lines: 2, waits: new Set<string>(["B", "Z"]), rules: [] });
  const made = stepsOf(units, 12, undefined);
  same(made.steps.slice(0, 2).map((s) => s.feature).join(", "), "A, B", "the first two steps");
});

function planShown(s: Ref<Step>): string {
  const p: Ref<{ item: string; done: boolean } | null | undefined> = s.plan;
  if (p === null) return `${s.feature}: null`;
  return `${s.feature}: ${p!.item} ${p!.done}`;
}

test("a plan names each feature's item and whether it is done", () => {
  const dir = project([["a.ts", big() + "for (const k in o) {}\nnamespace N {}\n"], ["plan.md", "## Plan\n\n- [ ] 7. **The rest of console** - console.debug\n  - [x] 9b. **for...in** - keys\n"]]);
  const r = ranked([dir], undefined, planOf(join(dir, "plan.md")));
  list(sorted(r.curve.steps.map((s) => planShown(s))), sorted(["The rest of console: 7 false", "for...in: 9b true", "Namespaces: null"]), "the plan items");
  assert(formatRanking(r, true).includes("(plan item 9b, done)"), formatRanking(r, true));
  done(dir);
  const crlf = project([["plan.md", "- [ ] 1. **`for...in`** - keys\r\n- [x]  2.  **Regex**\r\n- [ ] 3. **Regex**\r\n"]]);
  const plan = planOf(join(crlf, "plan.md"));
  const shown = (title: string): string => {
    const p = plan.get(title);
    return p === undefined ? "undefined" : `${p.item} ${p.done}`;
  };
  same(`${shown("for...in")}, ${shown("regex")}`, "1 false, 2 true", "the items");
  done(crlf);
  const readme = project([["readme.md", "# Hello\n"]]);
  let thrown = "";
  try {
    readPlan(join(readme, "readme.md"));
  } catch (e) {
    thrown = e.message;
  }
  assert(thrown.includes("no '- [ ] N. **Title**' items"), `readPlan gives: ${thrown === "" ? "a plan" : thrown}`);
  done(readme);
});

test("fishc survey --rank prints and gives JSON, and refuses what it can't read", () => {
  const a = project([["a.ts", big()]]);
  const s = project([["s.ts", "const o = { ...p };\n"]]);
  const text = cli(["survey", "--rank", a, "--self", s]).out;
  assert(text.includes("1. The rest of console"), text);
  assert(text.includes(`self-hosting (${s})`), text);
  const json = cli(["survey", "--rank", a, "--json"]).out;
  try {
    same(JSON.stringify(JSON.parse<Ranking>(json)), JSON.stringify(ranked([a])), "the JSON");
  } catch (e) {
    assert(false, `the JSON doesn't parse as a ranking: ${e.message}\n${json}`);
  }
  const refused: string[][] = [
    ["survey", "--rank", a, "--plan", join(a, "missing.md")],
    ["survey", "--rank", a, join(a, "nope")],
    ["survey", a, s],
    ["survey", a, "--self", s],
    ["survey", "--rank"],
    ["survey", "--rank", a, "--self", ""],
    ["build", "x.fsh", "--rank"],
  ];
  for (const args of refused) {
    const run = cli(args.clone());
    assert(run.code === 2, `${args.join(" ")}: exit code ${run.code}`);
  }
  const noSelf = cli(["survey", "--rank", a, "--self"]);
  assert(noSelf.err.includes("fishc:"), noSelf.err);
  const twice = cli(["survey", "--rank", a, a]);
  assert(twice.err.includes("already surveyed"), twice.err);
  // A ranking made without a plan gives no step a plan.
  assert(!json.includes('"plan"'), json);
  done(a);
  done(s);
});

test("a comparison lists the rules that moved, the furthest first, a new rule from nothing", () => {
  const dir = project([["a.ts", "var a = 1;\nvar b = 2;\nconst xs = console.debug(f, 1);\n"]]);
  try {
    const then = readReport(JSON.stringify(survey(dir)));
    writeFileSync(join(dir, "a.ts"), "const a = 1;\nconst xs = console.debug(f, 1) && console.debug(g, 2) && console.debug(h, 3);\ndelete o.k;\n");
    const c = compare(then, survey(dir));
    list(c.rules.map((m) => `${m.id} ${m.then} ${m.now} ${m.change}`), ["A1 2 0 -2", "console 1 3 2", "G7 0 1 1", "R3 0 1 1"], "the rules");
    assert(c.then.counts.reject === 0, `then rejects ${c.then.counts.reject}`);
    assert(c.now.counts.reject === 1, `now rejects ${c.now.counts.reject}`);
    const text = formatComparison(c);
    assert(text.includes("rejected  0 -> 1 (+1)"), text);
    assert(text.includes("      +2  console methods besides log, error and warn (1 -> 3)"), text);
    assert(text.indexOf("rewrites that changed") < text.indexOf("waiting on Fish, changed"), text);
    assert(formatComparison(compare(then, then)).includes("no rule's count changed"), formatComparison(compare(then, then)));
  } catch (e) {
    assert(false, e.message);
  }
  done(dir);
});

// What readReport throws for `text`, or "" when it reads it.
function refusal(text: string): string {
  try {
    readReport(text);
    return "";
  } catch (e) {
    return e.message;
  }
}

function savedRule(fields: string): string {
  return `{"files":1,"lines":3,"rules":[{${fields}}]}`;
}

test("a baseline must be a saved survey report, and is scored again by today's rules", () => {
  assert(refusal("not json").includes("isn't JSON"), refusal("not json"));
  // Bun writes the count 1e999 as JSON.stringify does, null, and leaves an undefined title out.
  const bad = [
    "null", "[]", "5", "{}", '{"rules": []}',
    savedRule('"id":"A1","action":"auto","title":"var","count":null'),
    savedRule('"id":"A1","action":"auto","title":"var","count":-2.5'),
    savedRule('"id":"A1","action":"auto","title":"var","count":"4"'),
    savedRule('"id":"A1","action":"auto","count":4'),
    savedRule('"id":"A1","action":"maybe","title":"var","count":4'),
    '{"files":1,"lines":3,"rules":[{"id":"A1","action":"auto","title":"var","count":1},{"id":"A1","action":"auto","title":"var","count":2}]}',
    '{"files":"1","lines":3,"rules":[]}',
    '{"files":1,"lines":3,"unread":1,"rules":[]}',
  ];
  for (const text of bad) assert(refusal(text).includes("isn't a 'fishc survey --json' report"), `${text}: ${refusal(text) === "" ? "read" : refusal(text)}`);
  // A report saved before `waiting` and `unread` existed, with a score made by older rules.
  try {
    const old = readReport('{"files":1,"lines":36,"score":1628.6,"grade":"F","counts":{},"rules":[{"id":"R3","action":"reject","title":"delete","count":1},{"id":"arrayMethods","action":"unsupported","title":"array methods","count":3}]}');
    same(`${old.unread.files} ${old.unread.lines}`, "0 0", "unread");
    same(`${old.score} ${old.grade ?? "none"} ${old.counts.unsupported} ${old.waiting.map((r) => r.id).join(",")}`, "10 B 3 arrayMethods", "the rescored report");
    let bumped = old.clone();
    for (let i: usize = 0; i < bumped.rules.length; i++) bumped.rules[i]!.count += 100000;
    const text = formatComparison(compare(old, bumped));
    assert(text.includes("+100000  delete (1 -> 100001)"), text);
  } catch (e) {
    assert(false, e.message);
  }
});

test("fishc survey --compare shows what changed since a saved report, and refuses bad baselines", () => {
  const dir = project([["app/a.ts", "var a = 1;\n"], ["old.json", ""], ["bad.json", "{}"], ["text.txt", "nope"]]);
  const app = join(dir, "app");
  try {
    writeFileSync(join(dir, "old.json"), cli(["survey", app, "--json"]).out);
    writeFileSync(join(app, "a.ts"), "var a = 1;\nvar b = 2;\n");
  } catch (e) {
    assert(false, e.message);
  }
  const run = cli(["survey", app, "--compare", join(dir, "old.json")]);
  assert(run.code === 0, `exit code ${run.code}: ${run.err}`);
  assert(run.out.includes("      +1  var: const or let (1 -> 2)"), run.out);
  // The order of the JSON's keys isn't checked: Fish writes an object's keys sorted by name, where
  // Bun writes them as the type declares them.
  const out = cli(["survey", app, "--compare", join(dir, "old.json"), "--json"]).out;
  try {
    const json = JSON.parse<Comparison>(out);
    list(json.rules.map((m) => `${m.id} ${m.action} ${m.title} ${m.then} ${m.now} ${m.change}`), ["A1 auto var: const or let 1 2 1"], "the rules");
  } catch (e) {
    assert(false, `the JSON doesn't parse as a comparison: ${e.message}\n${out}`);
  }
  const expectations: [string[], string][] = [
    [["survey", app, "--compare", join(dir, "bad.json")], "isn't a 'fishc survey --json' report"],
    [["survey", app, "--compare", join(dir, "text.txt")], "isn't JSON"],
    [["survey", app, "--compare", join(dir, "missing.json")], "can't be compared: it doesn't exist"],
    [["survey", app, "--compare", dir], "it isn't a file"],
    [["survey", "--rank", app, "--compare", join(dir, "old.json")], "rankings can't be compared yet"],
  ];
  for (const [args, said] of expectations) {
    const err = cli(args.clone()).err;
    assert(err.includes(said), `${args.join(" ")}: ${err}`);
  }
  const build = cli(["build", "x.fsh", "--compare", "old.json"]);
  assert(build.code === 2, `build --compare: exit code ${build.code}`);
  done(dir);
});

function depsOf(dir: string): Dependencies {
  const d = dependencies(dir);
  if (d === undefined) {
    assert(false, `${dir} has no dependencies`);
    return { counts: { std: 0, planned: 0, native: 0, pure: 0, unknown: 0 }, list: [] };
  }
  return d;
}

function countsOf(d: Ref<Dependencies>): string {
  return `std ${d.counts.std}, planned ${d.counts.planned}, native ${d.counts.native}, pure ${d.counts.pure}, unknown ${d.counts.unknown}`;
}

function pkg(extra: string): string {
  return `{"name":"p","version":"1.0.0"${extra}}`;
}

test("dependencies are sorted into std, planned, native, pure and not installed", () => {
  const dir = project([
    ["app/package.json", '{"dependencies":{"express":"^4","gyp":"1","flagged":"1","built":"1","prebuilt":"1","compiled":"1","plain":"1","@scope/plain":"1","hoisted":"1","missing":"1"},"devDependencies":{"vitest":"^1"}}'],
    ["app/a.ts", "const x = 1;\n"],
    ["app/node_modules/express/package.json", pkg("")],
    ["app/node_modules/gyp/package.json", pkg("")], ["app/node_modules/gyp/binding.gyp", "{}"],
    ["app/node_modules/flagged/package.json", pkg(',"gypfile":true')],
    ["app/node_modules/built/package.json", pkg(',"dependencies":{"node-gyp-build":"^4"}')],
    ["app/node_modules/prebuilt/package.json", pkg(',"optionalDependencies":{"prebuilt-darwin-arm64":"1"}')],
    ["app/node_modules/compiled/package.json", pkg("")], ["app/node_modules/compiled/build/Release/c.node", ""],
    ["app/node_modules/plain/package.json", pkg("")],
    ["app/node_modules/@scope/plain/package.json", pkg("")],
    ["node_modules/hoisted/package.json", pkg("")],
  ]);
  const app = join(dir, "app");
  const d = depsOf(app);
  list(sorted(d.list.map((x) => `${x.name}: ${x.group}`)), sorted([
    "express: std", "gyp: native", "flagged: native", "built: native", "prebuilt: native", "compiled: native",
    "plain: pure", "@scope/plain: pure", "hoisted: pure", "missing: unknown", "vitest: planned",
  ]), "the groups");
  same(countsOf(d), "std 1, planned 1, native 5, pure 3, unknown 1", "the counts");
  let vitest = "none";
  for (const x of d.list) {
    if (x.name !== "vitest") continue;
    const e: Ref<{ name: string; planned: boolean } | undefined> = x.equivalent;
    vitest = `${x.dev} ${x.kind} ${e !== undefined ? `${e.name} ${e.planned}` : "none"}`;
  }
  same(vitest, "true unknown Jest-style test API true", "vitest");
  const r = survey(app);
  same(JSON.stringify(r.dependencies), JSON.stringify(d), "the report's dependencies");
  const text = formatReport(r);
  assert(text.includes("dependencies (11, 1 dev)"), text);
  assert(text.includes("express (serve and Router)"), text);
  assert(/native:\s+5  gyp, flagged, built, prebuilt, compiled/.test(text), text);
  const out = cli(["survey", app, "--json"]).out;
  try {
    const plain = JSON.parse<Report>(out);
    const native = plain.dependencies !== undefined ? plain.dependencies.counts.native : 0;
    assert(native === 5, `${native} native`);
    assert(plain.grade === survey(app).grade, `grade ${plain.grade ?? "none"}`);
  } catch (e) {
    assert(false, `the JSON doesn't parse as a report: ${e.message}\n${out}`);
  }
  done(dir);
});

test("a project without package.json has no dependency section, and a broken one is noted", () => {
  const dir = project([["a.ts", "const x = 1;\n"]]);
  assert(dependencies(dir) === undefined, "dependencies without a package.json");
  assert(!formatReport(survey(dir)).includes("dependencies"), formatReport(survey(dir)));
  done(dir);
  const broken = project([["a.ts", "const x = 1;\n"], ["package.json", "[1, 2]"]]);
  assert(formatReport(survey(broken)).includes("package.json can't be read: it isn't an object"), formatReport(survey(broken)));
  done(broken);
});

// Each dependency as its name, group, equivalent and whether it is a dev dependency.
function described(d: Ref<Dependencies>): string[] {
  return sorted(d.list.map((x) => {
    const e: Ref<{ name: string; planned: boolean } | undefined> = x.equivalent;
    return `${x.name}: ${x.group} ${e !== undefined ? e.name : "undefined"} ${x.dev}`;
  }));
}

test("dependency classification ignores dev helpers, odd names and odd manifests", () => {
  const dir = project([
    ["package.json", '﻿{"dependencies":{"constructor":"1","toString":"1","bench":"1","utils":"1","crypto":"1","shared":"1","async-mutex":"1","bcryptjs":"1","query-string":"1","odd":1},"devDependencies":{"shared":"1","socket.io":"1"}}'],
    ["a.ts", "const x = 1;\n"],
    ["node_modules/bench/package.json", pkg(',"devDependencies":{"bindings":"1","nan":"1"}')],
    ["node_modules/utils/package.json", pkg(',"optionalDependencies":{"linux-utils":"1","@capacitor/android":"1"}')],
    ["node_modules/crypto/package.json", pkg(',"optionalDependencies":{"nan":"1"}')],
    ["node_modules/shared/package.json", pkg("")],
    ["node_modules/socket.io/package.json", pkg("")],
  ]);
  list(described(depsOf(dir)), sorted([
    "constructor: unknown undefined false", "toString: unknown undefined false",
    "bench: pure undefined false", "utils: pure undefined false", "crypto: native undefined false", "shared: pure undefined false",
    "async-mutex: std Semaphore false", "bcryptjs: std std:auth's hashPassword, which hashes with argon2id rather than bcrypt false", "query-string: std URL and URLSearchParams false", "socket.io: pure undefined true",
  ]), "the dependencies");
  done(dir);
  const listed = project([["package.json", '{"dependencies":["express"]}'], ["a.ts", "const x = 1;\n"]]);
  assert(depsOf(listed).list.length === 0, "an array of dependencies gives some");
  done(listed);
  const pnp = project([["package.json", '{"dependencies":{"lodash":"1"}}'], [".pnp.cjs", ""], ["a.ts", "const x = 1;\n"]]);
  const text = formatReport(survey(pnp));
  assert(text.includes("Yarn Plug'n'Play"), text);
  assert(text.includes("not installed:    1  lodash"), text);
  done(pnp);
});

function equivalents(d: Ref<Dependencies>): string[] {
  return d.list.map((x) => {
    const e: Ref<{ name: string; planned: boolean } | undefined> = x.equivalent;
    return e !== undefined ? `${e.name} ${e.planned}` : "undefined";
  });
}

test("pg and postgres are replaced by std's postgres module", () => {
  const dir = project([["package.json", '{"dependencies":{"pg":"8","postgres":"3"}}'], ["a.ts", "const x = 1;\n"]]);
  const d = depsOf(dir);
  same(countsOf(d), "std 2, planned 0, native 0, pure 0, unknown 0", "the counts");
  list(equivalents(d), ["the postgres module's Pool false", "the postgres module's Pool false"], "the equivalents");
  done(dir);
});

test("better-sqlite3 and sqlite3 are replaced by std:sqlite", () => {
  const dir = project([["package.json", '{"dependencies":{"better-sqlite3":"11","sqlite3":"5"}}'], ["a.ts", "const x = 1;\n"]]);
  const d = depsOf(dir);
  same(countsOf(d), "std 2, planned 0, native 0, pure 0, unknown 0", "the counts");
  list(equivalents(d), ["std:sqlite's Database false", "std:sqlite's Database false"], "the equivalents");
  done(dir);
});

test("the AWS SDK's S3 packages are replaced by std:s3", () => {
  const dir = project([["package.json", '{"dependencies":{"@aws-sdk/client-s3":"3","@aws-sdk/s3-request-presigner":"3"}}'], ["a.ts", "const x = 1;\n"]]);
  const d = depsOf(dir);
  same(countsOf(d), "std 2, planned 0, native 0, pure 0, unknown 0", "the counts");
  list(equivalents(d), ["std:s3's S3Client, as Bun's false", "std:s3's S3Client, as Bun's false"], "the equivalents");
  done(dir);
});

test("kysely is replaced by std:query", () => {
  const dir = project([["package.json", '{"dependencies":{"kysely":"0.27"}}'], ["a.ts", "const x = 1;\n"]]);
  const d = depsOf(dir);
  same(countsOf(d), "std 1, planned 0, native 0, pure 0, unknown 0", "the counts");
  list(equivalents(d), ["std:query's Kysely, compiling to SQL for std:postgres and std:sqlite false"], "the equivalents");
  done(dir);
});

test("the OpenTelemetry packages are replaced by std's std:trace module", () => {
  const dir = project([["package.json", '{"dependencies":{"@opentelemetry/api":"1","@opentelemetry/sdk-node":"0.57","@opentelemetry/exporter-trace-otlp-http":"0.57"}}'], ["a.ts", "const x = 1;\n"]]);
  const d = depsOf(dir);
  same(countsOf(d), "std 3, planned 0, native 0, pure 0, unknown 0", "the counts");
  const tracing = "the std:trace module false";
  list(equivalents(d), [tracing, tracing, tracing], "the equivalents");
  done(dir);
});

// Node's own sqlite is synchronous and names its classes otherwise, so an import of it is found
// as a member std lacks, and the report says where std's is.
test("node:sqlite is answered by std:sqlite, bun:sqlite still waits", () => {
  const dir = project([
    ["a.ts", 'import { DatabaseSync } from "node:sqlite";\n'],
    ["b.ts", 'import { Database } from "bun:sqlite";\n'],
  ]);
  same(features(dir), `[["Node built-ins"],["Bun's own modules"]]`, "the features");
  list(builtinsOf(survey(dir)), ["sqlite 1 std:sqlite's Database, each call awaited false"], "the built-ins");
  done(dir);
});

test("ws and the frameworks' WebSocket helpers are replaced by Router.ws", () => {
  const dir = project([["package.json", '{"dependencies":{"ws":"8","express-ws":"5","@hono/node-ws":"1"}}'], ["a.ts", "const x = 1;\n"]]);
  const d = depsOf(dir);
  same(countsOf(d), "std 3, planned 0, native 0, pure 0, unknown 0", "the counts");
  list(equivalents(d), ["Router.ws, for a server false", "Router.ws, for a server false", "Router.ws, for a server false"], "the equivalents");
  done(dir);
});

test("node:readline waits on nothing, as readLine and std:stdin replace it", () => {
  const dir = project([["a.ts", 'import { createInterface } from "node:readline";\n']]);
  same(features(dir), "[[]]", "the features");
  done(dir);
});

function builtinsOf(r: Ref<Report>): string[] {
  const all: Ref<Builtin[] | undefined> = r.builtins;
  if (all === undefined) return [];
  return all.map((b) => {
    const e: Ref<{ name: string; planned: boolean } | undefined> = b.equivalent;
    return e !== undefined ? `${b.module} ${b.files} ${e.name} ${e.planned}` : `${b.module} ${b.files}`;
  });
}

test("each Node built-in waits on the feature that replaces it, and the ranking names those features", () => {
  const dir = project([
    ["a.ts", 'import { isatty } from "node:tty";\nimport { EventEmitter } from "node:events";\n'],
    ["b.ts", 'import { setTimeout } from "node:timers/promises";\n'],
    ["c.ts", 'import vm from "vm";\nimport d = require("tty");\n'],
    ["plan.md", "- [ ] 1. **Terminal detection and styled text**\n- [ ] 2. **EventTarget and EventEmitter**\n"],
  ]);
  // `timers/promises` is std's sleep, so b.ts waits on nothing.
  same(JSON.stringify(scanFiles(dir).filter((f) => f.file.endsWith(".ts")).map((f) => featuresOf(f))), '[["EventTarget and EventEmitter","Terminal detection and styled text"],[],["Node built-ins","Terminal detection and styled text"]]', "the features");
  const r = ranked([dir], undefined, planOf(join(dir, "plan.md")));
  list(r.curve.steps.map((s) => `${planShown(s)} ${s.rules.join(",")}`), [
    "Terminal detection and styled text: 1 false nodeBuiltins",
    // Each frees one 2-line file, so the tie goes by name.
    "EventTarget and EventEmitter: 2 false nodeBuiltins",
    "Node built-ins: null nodeBuiltins",
  ], "the steps");
  const s = survey(dir);
  same(s.waiting[rule(s, "nodeBuiltins", true)]!.examples.map((e) => e.module ?? "undefined").join(", "), "tty, events, timers/promises", "the modules");
  done(dir);
  const second = project([
    ["a.ts", 'export * from "zlib";\nexport { isatty } from "node:tty";\n'],
    ["b.ts", 'import { test } from "node:test";\nimport http from "node:http";\nimport { Console } from "console";\n'],
    ["c.ts", "class A { constructor() {} }\n"],
  ]);
  same(features(second), '[["Terminal detection and styled text"],["Jest-style test API","The rest of console","node:http server shim"],[]]', "re-exports and other built-ins");
  assert(scanFiles(second)[2]!.findings.length === 0, "c.ts has findings");
  done(second);
  // zlib's whole-buffer calls are std's; brotli's aren't yet.
  const zlib = project([
    ["a.ts", 'import { gzipSync, gunzipSync, deflateSync, inflateSync, deflateRawSync, inflateRawSync, unzipSync, gzip, unzip } from "node:zlib";\n'],
    ["b.ts", 'import { gzipSync, brotliCompressSync } from "zlib";\n'],
  ]);
  same(features(zlib), '[[],["Node built-ins"]]', "zlib");
  done(zlib);
  // The global URL and URLSearchParams are std's, but Fish's url module has only the file URL
  // functions, so importing URL from it is refused, and querystring has no std module.
  const url = project([
    ["a.ts", 'const u = new URL("http://h/?a=1");\nconst p = new URLSearchParams(u.search);\n'],
    ["b.ts", 'import { URL } from "node:url";\nimport qs from "querystring";\n'],
  ]);
  same(features(url), '[[],["Node built-ins","node:querystring"]]', "url");
  list(builtinsOf(survey(url)), ["querystring 1 node:querystring true", "url 1 std:url, for fileURLToPath and pathToFileURL false"], "the built-ins");
  done(url);
});

test("child_process's sync calls are std's, and spawn still waits", () => {
  const dir = project([
    ["a.ts", 'import { spawnSync, execFileSync, execSync } from "node:child_process";\n'],
    ["b.ts", 'import { spawn } from "child_process";\n'],
  ]);
  same(features(dir), '[[],["Node built-ins"]]', "the features");
  list(builtinsOf(survey(dir)), ["child_process 1 std:child_process, for spawnSync, execFileSync and execSync false"], "the built-ins");
  done(dir);
});

test("the report lists each Node built-in with its files and what replaces it", () => {
  const dir = project([
    ["a.ts", 'import { isatty } from "node:tty";\nimport { EventEmitter } from "node:events";\n'],
    ["b.ts", 'import tty from "node:tty";\nimport http from "node:http";\n'],
    ["c.ts", 'import vm from "vm";\nimport net from "node:net";\nimport { createSocket } from "node:dgram";\n'],
  ]);
  const r = survey(dir);
  list(builtinsOf(r), [
    "tty 2 Terminal detection and styled text true",
    "dgram 1 UdpSocket false",
    "events 1 EventTarget and EventEmitter true",
    "http 1 node:http server shim true",
    "net 1 TcpListener, TcpStream, UnixListener and UnixStream false",
    "vm 1",
  ], "the built-ins");
  const text = formatReport(r);
  for (const line of [
    "  tty                 2 files  planned: Terminal detection and styled text",
    "  dgram               1 file   in std: UdpSocket",
    "  http                1 file   planned: node:http server shim",
    "  vm                  1 file   nothing planned",
    "  net                 1 file   in std: TcpListener, TcpStream, UnixListener and UnixStream",
  ]) assert(text.includes(line), `missing ${line} in:\n${text}`);
  const out = cli(["survey", dir, "--json"]).out;
  try {
    const parsed = JSON.parse<Report>(out);
    const n = parsed.builtins !== undefined ? parsed.builtins.length : 0;
    assert(n === 6, `${n} built-ins in the JSON`);
  } catch (e) {
    assert(false, `the JSON doesn't parse as a report: ${e.message}\n${out}`);
  }
  done(dir);
  const plain = project([["a.ts", 'import x from "./x";\n']]);
  assert(survey(plain).builtins === undefined, "a report with no built-ins has them");
  assert(!formatReport(survey(plain)).includes("Node built-ins"), formatReport(survey(plain)));
  done(plain);
});

test("optional and trailing rest tuple elements are portable; a leading rest, or one beside optional elements, waits", () => {
  const dir = project([
    ["a.ts", 'const t: [number, string?] = [1];\nconst u: [string, ...number[]] = ["a", 1];\n'],
    ["b.ts", 'const v: [...number[], string] = ["a"];\n'],
    ["c.ts", "const w: [number, string?, ...number[]] = [1];\n"],
  ]);
  same(JSON.stringify(scanFiles(dir).map((f) => f.findings.map((x) => x[0]))), '[[],["tuples"],["tuples"]]', "the findings");
  done(dir);
});

test("node:fs, fs/promises and util are std, and a util member std lacks waits on Node built-ins", () => {
  const dir = project([["a.ts", 'import { readFileSync } from "node:fs";\n'], ["b.ts", 'import { readFile } from "node:fs/promises";\nreadFile("x");\n'], ["c.ts", 'import { parseArgs, format } from "node:util";\n'], ["d.ts", 'import { promisify } from "node:util";\n']]);
  same(features(dir), '[[],[],[],["Node built-ins"]]', "the features");
  done(dir);
});

test("generic arrows not held by a const are portable", () => {
  const dir = project([["a.ts", "const o = { run: <T>(x: T): T => x };\n"]]);
  same(features(dir), "[[]]", "the features");
  done(dir);
});

test("node:fs members the std module answers are portable; others are Node built-ins", () => {
  const dir = project([
    ["a.ts", 'import { readFileSync, statSync, rmSync, mkdirSync, renameSync, copyFileSync, unlinkSync, accessSync, utimesSync, lutimesSync, chmodSync, symlinkSync, linkSync, readlinkSync, constants, openSync, readSync, writeSync, closeSync, fstatSync, ftruncateSync, fchmodSync, fsyncSync } from "node:fs";\n'],
    ["c.ts", 'import { access, utimes, lutimes, chmod, symlink, link, readlink, realpath, constants, open } from "fs/promises";\n'],
    ["b.ts", 'import { appendFileSync } from "fs";\n'],
  ]);
  same(features(dir), '[[],["Node built-ins"],[]]', "the features");
  done(dir);
});

test("generators, async generators, their methods and for await are portable", () => {
  const dir = project([["a.ts", "async function* ticks(): AsyncGenerator<number> { yield 1; }\nclass Feed { async *each(): AsyncGenerator<number> { yield 1; } *all(): Generator<number> { yield 1; } static *none(): Generator<number> { yield 0; } }\nasync function main() { for await (const t of ticks()) console.log(t); }\n"]]);
  same(features(dir), "[[]]", "the features");
  assert(scanFiles(dir)[0]!.findings.length === 0, "a.ts has findings");
  done(dir);
});

test("for await over an array of promises is a guided rewrite, counted as Fish refuses it", () => {
  countsAre([
    "async function f(urls: string[], ps: Promise<number>[]) {",
    "  for await (const x of [Promise.resolve(1)]) {}",
    "  for await (const r of urls.map((u) => fetch(u))) {}",
    "  for await (const p of ps) {}",
    "  for await (const q of ps.toSpliced(0, 1)) {}",
    "  const held = [Promise.resolve(2)];",
    "  for await (const h of held) {}",
    "  for await (const t of ticks()) {}",
    "}",
    "",
  ].join("\n"), ["forAwaitArrays: 5"]);
});

test("std's random functions and hash make Math.random, crypto imports of them, and uuid and nanoid portable", () => {
  const dir = project([
    ["a.ts", 'import { randomUUID, getRandomValues, hash } from "node:crypto";\nexport const id = randomUUID() + Math.random();\n'],
    ["b.ts", 'import { randomUUID, createHash } from "crypto";\nimport { EventEmitter } from "node:events";\n'],
    ["package.json", '{"dependencies":{"uuid":"1","nanoid":"1"}}'],
  ]);
  same(JSON.stringify(scanFiles(dir).filter((f) => f.file.endsWith(".ts")).map((f) => featuresOf(f))), '[[],["EventTarget and EventEmitter"]]', "the features");
  list(described(depsOf(dir)), sorted(["nanoid: std crypto.getRandomValues, to build IDs from false", "uuid: std crypto.randomUUID, for v4 only false"]), "the dependencies");
  done(dir);
});

test("cookie and cookie-parser are replaced by std's cookies", () => {
  const dir = project([["package.json", '{"dependencies":{"cookie":"1","cookie-parser":"1"}}']]);
  list(described(depsOf(dir)), sorted(["cookie: std req.cookies and res.cookies false", "cookie-parser: std req.cookies and res.cookies false"]), "the dependencies");
  done(dir);
});

test("static file packages are replaced by Router.static", () => {
  const dir = project([["package.json", '{"dependencies":{"serve-static":"1","@fastify/static":"1","koa-static":"1","sirv":"1"}}']]);
  list(described(depsOf(dir)), sorted(["@fastify/static: std Router.static false", "koa-static: std Router.static false", "serve-static: std Router.static false", "sirv: std Router.static false"]), "the dependencies");
  done(dir);
});

test("randomBytes gives a Buffer, so Buffer methods called on it port", () => {
  const dir = project([
    ["a.ts", 'import { randomBytes } from "node:crypto";\nexport const t = randomBytes(16).toString("hex");\n'],
    ["b.ts", 'import crypto from "crypto";\nexport const b = crypto.randomBytes(8).readUInt32BE(0) + crypto.randomUUID().length;\n'],
    ["c.ts", 'import { randomBytes, createCipheriv } from "crypto";\n'],
  ]);
  same(features(dir), '[[],[],["Node built-ins"]]', "the features");
  const all = survey(dir).builtins;
  same(all !== undefined ? all.map((b) => b.module).join(", ") : "none", "crypto", "the built-ins");
  done(dir);
});

test("node:assert ports for its default export and ok, and its other names wait on nothing planned", () => {
  const dir = project([
    ["a.ts", 'import assert from "node:assert";\nassert(1 < 2);\nassert.ok(true, "fine");\n'],
    ["b.ts", 'import { ok } from "assert";\nok(1 < 2);\n'],
    ["c.ts", 'import { ok, strictEqual } from "node:assert";\nok(true);\nstrictEqual(1, 1);\n'],
    ["d.ts", 'import assert from "assert";\nassert.deepStrictEqual([1], [1]);\n'],
  ]);
  same(features(dir), '[[],[],["Node built-ins"],["Node built-ins"]]', "the features");
  const all = survey(dir).builtins;
  same(all !== undefined ? all.map((x) => `${x.module} ${x.equivalent !== undefined ? x.equivalent.name : "undefined"}`).join(", ") : "none", "assert std:assert, for the default export and ok", "the built-ins");
  done(dir);
});

test("crypto names std lacks still wait when randomBytes beside them ports", () => {
  const a = project([["a.ts", 'import { randomBytes, createCipheriv } from "node:crypto";\nconsole.log(randomBytes(4), createCipheriv);\n']]);
  const b = project([["b.ts", 'import { randomBytes, randomInt } from "crypto";\nconsole.log(randomBytes(4), randomInt(3));\n']]);
  const c = project([["c.ts", 'import crypto from "crypto";\nconsole.log(crypto.randomBytes(4), crypto.createCipheriv, crypto.randomUUID());\n']]);
  for (const dir of [a, b, c]) {
    same(features(dir), '[["Node built-ins"]]', `${dir}'s features`);
    list(ranked([dir]).curve.steps.map((s) => `${s.gained.files} ${s.portable.share}`), ["1 100"], `${dir}'s steps`);
  }
  const all = survey(b).builtins;
  same(all !== undefined ? all.map((x) => `${x.module} ${x.equivalent !== undefined ? x.equivalent.name : "undefined"}`).join(", ") : "none", "crypto.randomInt undefined", "b's built-ins");
  done(a);
  done(b);
  done(c);
});

test("a spread argument is a guided rewrite unless it spreads a name the file types as a tuple", () => {
  countsAre([
    "function f(a: number, b: string) {}",
    "function g(t: readonly [number, string], xs: number[]) {",
    "  f(...t);",
    "  const u: [number, string] = [1, \"a\"];",
    "  f(...u);",
    "  Math.max(...xs);",
    "}",
    "",
  ].join("\n"), ["spread: 1"]);
});
