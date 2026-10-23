import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { CompileError, locate } from "./diag.ts";
import { parse } from "./parser.ts";

// `fishc survey`: how hard an existing TypeScript project is to port, read from its syntax alone.
// The grade counts the work a person does, the migration lint's rejected constructs and guided
// rewrites; constructs Fish doesn't support yet are listed apart, as what Fish itself still needs.

export type Action = "reject" | "unsupported" | "guided" | "auto";
// `feature` names the planned Fish feature that lifts a rule Fish doesn't support yet.
type Rule = { id: string; action: Action; title: string; feature?: string };
type Example = { file: string; line: number; col: number; note?: string };
export type RuleCount = Rule & { count: number; examples: Example[] };
export type Report = {
  files: number; lines: number; unread: { files: number; lines: number }; score: number;
  // None when less than half the lines could be read, since the score wouldn't speak for them.
  grade: string | null;
  counts: Record<Action, number>; rules: RuleCount[]; waiting: RuleCount[];
};

const RULES: Rule[] = [
  { id: "R1", action: "reject", title: "eval and new Function: a native binary has no compiler to run code made at run time" },
  { id: "R2", action: "reject", title: "prototype edits and Object.defineProperty: Fish types have fixed layouts" },
  { id: "R3", action: "reject", title: "delete: Fish objects have fixed layouts; use an Option field or a Map" },
  { id: "G1", action: "guided", title: "any: choose a concrete type, a union, or the dynamic Json value" },
  { id: "G4", action: "guided", title: "class extends: Fish embeds the base, so a polymorphic hierarchy becomes an interface" },
  { id: "G5", action: "guided", title: "instanceof: match on an interface or an enum instead" },
  { id: "G6", action: "guided", title: "indexing an object with a string key: use a Map" },
  { id: "G7", action: "guided", title: "top-level code with side effects: move it into main() or a comptime const" },
  { id: "G8", action: "guided", title: "isNaN after parsing: Fish's parsing gives an Option to check" },
  { id: "G9", action: "guided", title: ".call, .apply and .bind: pass the receiver explicitly or use a closure" },
  { id: "G10", action: "guided", title: "an async callback passed to forEach: use for...of with await, or spawned tasks" },
  { id: "A1", action: "auto", title: "var: const or let" },
  { id: "A2", action: "auto", title: "null, undefined and ?: Option" },
  { id: "A3", action: "auto", title: "== and !=: === and !==" },
  { id: "A4", action: "auto", title: "a top-level let: a const holding an Atomic" },
  { id: "A8", action: "auto", title: "JSON.parse(s) as T: JSON.parse<T>(s)" },
  { id: "A9", action: "auto", title: "function expressions: arrow functions" },
  { id: "parse", action: "unsupported", title: "files Fish's parser can't read", feature: "parser gaps" },
  { id: "unreadable", action: "unsupported", title: "files that couldn't be opened" },
  { id: "jsx", action: "unsupported", title: "JSX in .tsx files", feature: "JSX for server-side HTML" },
  { id: "modules", action: "unsupported", title: "imports and exports between files (multi-file programs)", feature: "Multi-file programs" },
  { id: "packages", action: "unsupported", title: "imports of npm packages", feature: "npm interop" },
  { id: "nodeBuiltins", action: "unsupported", title: "imports of Node built-in modules such as node:fs", feature: "Node built-ins" },
  { id: "destructuring", action: "unsupported", title: "destructuring in declarations and parameters", feature: "Destructuring" },
  { id: "destructuringAssignment", action: "unsupported", title: "destructuring assignments", feature: "Destructuring assignment" },
  { id: "defaults", action: "unsupported", title: "default parameter values", feature: "Default parameter values" },
  { id: "declarators", action: "unsupported", title: "several declarators, or a declaration assigned later", feature: "Several declarators and deferred initialization" },
  { id: "tuples", action: "unsupported", title: "tuple types", feature: "Tuples" },
  { id: "spread", action: "unsupported", title: "rest parameters and array spread", feature: "Rest parameters and array spread" },
  { id: "objectSpread", action: "unsupported", title: "object spread", feature: "Object spread" },
  { id: "arrayMethods", action: "unsupported", title: "array methods such as map, filter and reduce", feature: "Array methods" },
  { id: "collections", action: "unsupported", title: "Map and Set", feature: "Map and Set" },
  { id: "regex", action: "unsupported", title: "regex literals", feature: "Regex" },
  { id: "forIn", action: "unsupported", title: "for...in loops over an object's keys", feature: "for...in" },
  { id: "decorators", action: "unsupported", title: "decorators (macros, decorators and derive)", feature: "Macros, decorators and derive" },
  { id: "namespaces", action: "unsupported", title: "namespaces and module declarations", feature: "Namespaces" },
  { id: "genericMethods", action: "unsupported", title: "type parameters on methods and arrow functions (generic methods, interfaces and arrows)", feature: "Generic methods, interfaces and arrows" },
  { id: "classForms", action: "unsupported", title: "#private names and abstract classes", feature: "Abstract classes and #private fields" },
  { id: "tagged", action: "unsupported", title: "tagged templates", feature: "Comptime tagged templates" },
  { id: "math", action: "unsupported", title: "Math, parseInt, parseFloat and Number() (number parsing and Math)", feature: "Number parsing and Math" },
  { id: "process", action: "unsupported", title: "process (process environment)", feature: "Process environment" },
  { id: "fetch", action: "unsupported", title: "fetch (HTTP client)", feature: "HTTP client" },
  { id: "timers", action: "unsupported", title: "setTimeout and setInterval", feature: "setTimeout and setInterval" },
  { id: "stderr", action: "unsupported", title: "console.error, console.warn, Date.now and performance.now (logging to stderr and clocks)", feature: "Logging to stderr and clocks" },
  { id: "json", action: "unsupported", title: "JSON.parse and JSON.stringify (derive for Json)", feature: "Macros, decorators and derive" },
  { id: "promiseAll", action: "unsupported", title: "Promise.all and Promise.race", feature: "Promise.all and Promise.race" },
  { id: "localDeclarations", action: "unsupported", title: "types, interfaces, enums and classes declared inside a function", feature: "Local declarations" },
  { id: "nestedFunctions", action: "unsupported", title: "function declarations inside a function (nested functions)", feature: "Nested functions" },
];

// A rejected construct has no Fish equivalent and needs a redesign; a guided one, a rewrite.
const WEIGHTS: Record<Action, number> = { reject: 10, guided: 3, auto: 0, unsupported: 0 };
// Score per 1000 lines at the top of each grade, set so published TypeScript packages spread
// across them: a careful codebase scores near 5, a library leaning on `any` near 40, a DOM
// implementation patching prototypes near 90.
const GRADES: [string, number][] = [["A", 5], ["B", 15], ["C", 40], ["D", 100]];
const ARRAY_METHODS = new Set(["map", "filter", "find", "findIndex", "some", "every", "reduce", "forEach", "flatMap", "sort", "splice"]);
const MODULE_FORMS = new Set(["import", "importEquals", "exportAll", "exportAsNamespace", "exportAssign", "exportDefault", "exportNamed"]);
const LOCAL_FORMS = new Set(["enum", "typeAlias", "interface"]);

type Node = { kind: string; start: number; end: number; [key: string]: unknown };
const isNode = (v: unknown): v is Node => typeof v === "object" && v !== null && typeof (v as Node).kind === "string" && typeof (v as Node).start === "number";
const named = (n: unknown, name: string) => isNode(n) && n.kind === "ident" && n.name === name;
const memberOf = (n: unknown, object: string, names: string[]) => isNode(n) && n.kind === "member" && named(n.object, object) && names.includes(n.name as string);
const isPrivate = (name: unknown) => typeof name === "string" && name.startsWith("#");

// Every TypeScript file under `dir`, skipping dependencies, hidden directories, declarations and
// symbolic links (which may loop, or count a file twice); an entry that can't be read is skipped.
export function sources(dir: string): string[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names.flatMap((name) => {
    const path = join(dir, name);
    let entry;
    try {
      entry = lstatSync(path);
    } catch {
      return [];
    }
    if (entry.isDirectory()) return name === "node_modules" || name.startsWith(".") ? [] : sources(path);
    return entry.isFile() && /\.(ts|tsx|mts)$/.test(name) && !/\.d\.(ts|mts)$/.test(name) ? [path] : [];
  });
}

// One file as surveyed: its non-blank lines, whether it could be read, and what it shows, in
// source order.
export type FileScan = { file: string; lines: number; read: boolean; findings: [string, Example][] };

export function scanFiles(dir: string): FileScan[] {
  return sources(dir).sort().map((path) => scanFile(path, relative(dir, path)));
}

function scanFile(path: string, file: string): FileScan {
  let src: string;
  try {
    src = readFileSync(path, "utf8").replace(/^\uFEFF/, "");
  } catch (e) {
    return { file, lines: 0, read: false, findings: [["unreadable", { file, line: 1, col: 1, note: e instanceof Error ? e.message : String(e) }]] };
  }
  const lines = src.split("\n").filter((l) => l.trim() !== "").length;
  const findings: [string, Example][] = [];
  try {
    scan(parse(src), (id, offset) => findings.push([id, { file, ...position(src, offset) }]));
  } catch (e) {
    // A file the parser can't read, or too deeply nested to walk, adds none of its findings or
    // lines, so it can't flatter the score.
    const at = e instanceof CompileError ? position(src, e.start) : { line: 1, col: 1 };
    const note = e instanceof RangeError ? "too deeply nested to read" : e instanceof Error ? e.message : String(e);
    return { file, lines, read: false, findings: [[path.endsWith(".tsx") && /<[A-Za-z>]/.test(src) ? "jsx" : "parse", { file, ...at, note }]] };
  }
  findings.sort(([, a], [, b]) => a.line - b.line || a.col - b.col);
  return { file, lines, read: true, findings };
}

// The planned Fish features a file waits on, by title; a file the parser can't read waits on
// the parser.
export function featuresOf(f: FileScan): string[] {
  return [...new Set(f.findings.flatMap(([id]) => featureOf(id) ?? []))].sort();
}

export const featureOf = (id: string) => FEATURES.get(id);
const FEATURES = new Map(RULES.flatMap((r) => (r.feature ? [[r.id, r.feature] as const] : [])));

export function survey(dir: string): Report {
  const scans = scanFiles(dir);
  const found = new Map<string, { count: number; examples: Example[] }>();
  let lines = 0;
  const unread = { files: 0, lines: 0 };
  for (const f of scans) {
    if (f.read) lines += f.lines;
    else {
      unread.files++;
      unread.lines += f.lines;
    }
    for (const [id, example] of f.findings) add(found, id, example);
  }
  const all = RULES.map((r) => ({ ...r, count: found.get(r.id)?.count ?? 0, examples: found.get(r.id)?.examples ?? [] }));
  const counts: Record<Action, number> = { reject: 0, unsupported: 0, guided: 0, auto: 0 };
  for (const r of all) counts[r.action] += r.count;
  const weighted = all.reduce((sum, r) => sum + WEIGHTS[r.action] * r.count, 0);
  // Per 1000 lines, and never per fewer, so one finding in a small script doesn't swing the grade.
  const score = Math.round((weighted * 1000) / Math.max(lines, 1000) * 10) / 10;
  const graded = lines > 0 && lines >= unread.lines;
  const byCount = (a: RuleCount, b: RuleCount) => WEIGHTS[b.action] - WEIGHTS[a.action] || b.count - a.count;
  return {
    files: scans.length, lines, unread, score, grade: graded ? grade(score) : null, counts,
    rules: all.filter((r) => r.action !== "unsupported").sort(byCount),
    waiting: all.filter((r) => r.action === "unsupported").sort(byCount),
  };
}

// Records a finding, keeping three examples.
function add(found: Map<string, { count: number; examples: Example[] }>, id: string, example: Example) {
  const entry = found.get(id) ?? { count: 0, examples: [] };
  found.set(id, entry);
  entry.count++;
  if (entry.examples.length < 3) entry.examples.push(example);
}

function position(src: string, offset: number) {
  const { line, col } = locate(src, offset);
  return { line, col };
}

export function grade(score: number): string {
  return GRADES.find(([, top]) => score <= top)?.[0] ?? "F";
}

// Walks a program without recursion, so a deeply nested file can't overflow the stack. `depth`
// counts the functions a node sits in, and `ambient` marks declarations under `declare`.
function scan(program: unknown[], note: (id: string, offset: number) => void) {
  for (const s of program) {
    const top = isNode(s) && (s.kind === "export" || s.kind === "declare") && isNode(s.body) ? s.body : s;
    if (!isNode(top)) continue;
    if (top.kind === "expr" && !(isNode(top.expr) && top.expr.kind === "string") && !callsMain(top.expr)) note("G7", top.start);
    if (top.kind === "let" && top.keyword === "let" && !(isNode(s) && s.kind === "declare")) note("A4", top.start);
  }
  const stack: [unknown, number, boolean][] = program.map((s) => [s, 0, false]);
  const heads = new WeakSet<object>();
  // Spreads written in an object literal, which a different feature lifts than array spread.
  const inObjects = new WeakSet<object>();
  while (stack.length > 0) {
    const [value, depth, ambient] = stack.pop()!;
    if (Array.isArray(value)) {
      for (const v of value) stack.push([v, depth, ambient]);
      continue;
    }
    if (typeof value !== "object" || value === null) continue;
    const o = value as Record<string, unknown>;
    if (Array.isArray(o.decorators)) for (const d of o.decorators) if (isNode(d)) note("decorators", d.start);
    let inner = depth;
    let under = ambient;
    if (isNode(o)) {
      if ((o.kind === "forOf" || o.kind === "forIn") && isNode(o.left)) heads.add(o.left);
      if (o.kind === "object" && Array.isArray(o.props)) for (const p of o.props) if (isNode(p) && p.kind === "spread") inObjects.add(p);
      for (const [id, at] of classify(o, depth, ambient, heads.has(o), inObjects.has(o))) note(id, at);
      if (Array.isArray(o.params)) params(o.params as Record<string, unknown>[], note);
      if (Array.isArray(o.params) && "body" in o) inner++;
      if (o.kind === "declare") under = true;
    }
    for (const [key, child] of Object.entries(o)) if (key !== "start" && key !== "end" && typeof child === "object") stack.push([child, inner, under]);
  }
}

// `main()` at the top level, or `main().catch(...)`, which a Fish program's `main` replaces.
function callsMain(e: unknown): boolean {
  if (!isNode(e) || e.kind !== "call") return false;
  if (named(e.callee, "main")) return true;
  return isNode(e.callee) && e.callee.kind === "member" && ["catch", "then"].includes(e.callee.name as string) && callsMain(e.callee.object);
}

function params(list: Record<string, unknown>[], note: (id: string, offset: number) => void) {
  for (const p of list) {
    if (isNode(p.default)) note("defaults", p.default.start);
    if (p.rest) note("spread", p.start as number);
    if (isNode(p.pattern) && p.pattern.kind !== "ident") note("destructuring", p.pattern.start);
    if (p.optional) note("A2", p.start as number);
  }
}

// The rules a node shows by itself, each with where to point: a call's own method name rather
// than the start of a long chain.
function classify(n: Node, depth: number, ambient: boolean, head: boolean, inObject: boolean): [string, number][] {
  const found: [string, number][] = [];
  const at = n.kind === "call" && isNode(n.callee) && n.callee.kind === "member" ? n.callee.end - String(n.callee.name).length : n.start;
  const push = (id: string) => found.push([id, at]);
  switch (n.kind) {
    case "call":
      callRules(n, push);
      break;
    case "new":
      if (named(n.callee, "Function")) push("R1");
      if (["Map", "Set", "WeakMap", "WeakSet"].some((name) => named(n.callee, name))) push("collections");
      break;
    case "member":
      if (n.name === "prototype") push("R2");
      if (named(n.object, "process")) push("process");
      if (isPrivate(n.name)) push("classForms");
      break;
    case "unary":
      if (n.op === "delete") push("R3");
      break;
    case "binary":
      if (n.op === "instanceof") push("G5");
      if (n.op === "==" || n.op === "!=") push("A3");
      break;
    case "index":
      if (isNode(n.index) && (n.index.kind === "string" || n.index.kind === "template")) push("G6");
      break;
    case "ref":
      if (n.name === "any") push("G1");
      if (n.name === "null" || n.name === "undefined") push("A2");
      if (["Map", "Set", "ReadonlyMap", "ReadonlySet"].includes(n.name as string)) push("collections");
      break;
    case "let":
      letRules(n, ambient, head, push);
      break;
    case "export":
      // `export function` with a body is how Fish exports to C; other exports are between files.
      if (!ambient && !(isNode(n.body) && n.body.kind === "function" && n.body.body !== undefined)) push("modules");
      break;
    case "function":
      // A declaration carries `macro` and an expression a body; a function type has neither.
      if (!("macro" in n) && "body" in n) push("A9");
      else if ("macro" in n && depth > 0) push("nestedFunctions");
      break;
    case "method":
    case "get":
    case "set":
    case "property":
    case "field":
      memberRules(n, push);
      break;
  }
  if (n.kind === "spread") push(inObject ? "objectSpread" : "spread");
  const simple: Record<string, string> = { tuple: "tuples", destructure: "destructuringAssignment", regex: "regex", tagged: "tagged", forIn: "forIn", namespace: "namespaces", privateName: "classForms" };
  if (simple[n.kind]) push(simple[n.kind]!);
  if (n.kind === "as" && isNode(n.expr) && n.expr.kind === "call" && memberOf(n.expr.callee, "JSON", ["parse"])) push("A8");
  if (n.kind === "arrow" && (n.typeParams as unknown[]).length > 0) push("genericMethods");
  // A dynamic `import("x")` names its module as its first argument.
  const [first] = Array.isArray(n.args) ? n.args : [];
  const dynamic = n.kind === "import" && isNode(first) && first.kind === "string" ? first.value : undefined;
  if (MODULE_FORMS.has(n.kind)) push(moduleRule(n.module ?? n.require ?? dynamic));
  if (LOCAL_FORMS.has(n.kind) && depth > 0) push("localDeclarations");
  // A class's base is one expression; an interface's are a list, which Fish keeps.
  if ("members" in n && isNode(n.extends)) push("G4");
  if (n.kind === "class" && depth > 0 && n.name !== undefined) push("localDeclarations");
  if (n.abstract === true && "members" in n) push("classForms");
  return found;
}

// What an import or re-export needs: another file of the program (a relative path, or a path
// alias written as `~/`, `@/` or `#`), a Node built-in, or an npm package, told apart by how its
// specifier is written.
function moduleRule(specifier: unknown): string {
  if (typeof specifier !== "string" || /^([./#~]|@\/)/.test(specifier)) return "modules";
  return specifier.startsWith("node:") || NODE_MODULES.has(specifier.split("/")[0]!) ? "nodeBuiltins" : "packages";
}

// Node's own modules, fixed so the answer doesn't depend on the runtime running the survey.
const NODE_MODULES = new Set(["assert", "async_hooks", "buffer", "child_process", "cluster", "console", "constants", "crypto",
  "dgram", "diagnostics_channel", "dns", "domain", "events", "fs", "http", "http2", "https", "inspector", "module", "net", "os",
  "path", "perf_hooks", "process", "punycode", "querystring", "readline", "repl", "stream", "string_decoder", "sys", "timers",
  "tls", "trace_events", "tty", "url", "util", "v8", "vm", "wasi", "worker_threads", "zlib"]);

function callRules(n: Node, push: (id: string) => void) {
  const callee = n.callee as Node;
  if (named(callee, "eval") || named(callee, "Function")) push("R1");
  if (memberOf(callee, "Object", ["defineProperty", "defineProperties", "setPrototypeOf"])) push("R2");
  if (named(callee, "isNaN") || memberOf(callee, "Number", ["isNaN"])) push("G8");
  if (["parseInt", "parseFloat", "Number"].some((name) => named(callee, name)) || memberOf(callee, "Number", ["parseInt", "parseFloat"]) || (isNode(callee) && callee.kind === "member" && named(callee.object, "Math"))) push("math");
  if (named(callee, "fetch")) push("fetch");
  if (["setTimeout", "setInterval", "clearTimeout", "clearInterval"].some((name) => named(callee, name))) push("timers");
  if (memberOf(callee, "console", ["error", "warn"]) || memberOf(callee, "Date", ["now"]) || memberOf(callee, "performance", ["now"])) push("stderr");
  if (memberOf(callee, "JSON", ["parse", "stringify"])) push("json");
  if (memberOf(callee, "Promise", ["all", "race", "allSettled", "any"])) push("promiseAll");
  if (!isNode(callee) || callee.kind !== "member") return;
  const name = callee.name as string;
  if (["call", "apply", "bind"].includes(name)) push("G9");
  const [first] = n.args as Node[];
  if (name === "forEach" && isNode(first) && (first.kind === "arrow" || first.kind === "function") && first.async) push("G10");
  if (ARRAY_METHODS.has(name)) push("arrayMethods");
}

function letRules(n: Node, ambient: boolean, head: boolean, push: (id: string) => void) {
  const declarations = n.declarations as { target: Node; init: unknown }[];
  if (n.keyword === "var" && !ambient) push("A1");
  // A declaration under `declare` describes a value defined elsewhere, so it has no initializer.
  if (declarations.length > 1 || (!head && !ambient && declarations.some((d) => !d.init))) push("declarators");
  if (declarations.some((d) => d.target.kind !== "ident")) push("destructuring");
}

function memberRules(n: Node, push: (id: string) => void) {
  if (n.optional === true) push("A2");
  if (isPrivate(n.name) || (Array.isArray(n.modifiers) && n.modifiers.includes("abstract"))) push("classForms");
  if (n.kind === "method" && Array.isArray(n.typeParams) && n.typeParams.length > 0) push("genericMethods");
}

// The report as text: what was read, the grade, the rewrites that cost most, then what Fish
// still needs before the project can be ported.
export function formatReport(r: Report): string {
  const example = (e: Example) => `${e.file}:${e.line}:${e.col}${e.note ? ` (${e.note})` : ""}`;
  const top = (rules: RuleCount[]) => rules.filter((x) => x.count > 0).slice(0, 10)
    .map((x) => `  ${String(x.count).padStart(5)}  ${x.title}\n         e.g. ${example(x.examples[0]!)}`);
  const rewrites = top(r.rules.filter((x) => x.action !== "auto"));
  const waiting = top(r.waiting);
  const plural = (n: number, what: string) => `${n} ${what}${n === 1 ? "" : "s"}`;
  const unread = r.unread.files > 0 ? [`  unread:   ${plural(r.unread.files, "file")} (${plural(r.unread.lines, "line")}), not in the score`] : [];
  const share = r.lines + r.unread.lines === 0 ? 0 : Math.round((r.lines * 100) / (r.lines + r.unread.lines));
  const verdict = r.grade ? `grade ${r.grade} (score ${r.score} per 1000 lines${share < 100 ? `, from ${share}% of the lines` : ""})`
    : `no grade: only ${share}% of the lines could be read`;
  return [
    `fishc survey: ${plural(r.files, "file")}, ${plural(r.lines, "line")} read`,
    verdict,
    `  rejected: ${r.counts.reject}`,
    `  guided:   ${r.counts.guided}`,
    `  auto-fix: ${r.counts.auto}`,
    ...unread,
    ...(rewrites.length ? ["", "top rewrites", ...rewrites] : []),
    ...(waiting.length ? ["", "waiting on Fish", ...waiting] : []),
  ].join("\n");
}
