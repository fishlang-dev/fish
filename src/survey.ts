import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { CompileError, locate } from "./diag.ts";
import { dependencies, formatDependencies, type Dependencies } from "./deps.ts";
import { hoistLocals } from "./locals.ts";
import { parse, type Stmt } from "./parser.ts";
import { STD_MODULES, stdModule } from "./std.ts";

// `fishc survey`: how hard an existing TypeScript project is to port, read from its syntax alone.
// The grade counts the work a person does, the migration lint's rejected constructs and guided
// rewrites; constructs Fish doesn't support yet are listed apart, as what Fish itself still needs.

export type Action = "reject" | "unsupported" | "guided" | "auto";
// `feature` names the planned Fish feature that lifts a rule Fish doesn't support yet.
type Rule = { id: string; action: Action; title: string; feature?: string };
// `module` names the Node built-in an import of one brings in.
type Example = { file: string; line: number; col: number; note?: string; module?: string };
export type RuleCount = Rule & { count: number; examples: Example[] };
export type Report = {
  files: number; lines: number; unread: { files: number; lines: number }; score: number;
  // None when less than half the lines could be read, since the score wouldn't speak for them.
  grade: string | null;
  counts: Record<Action, number>; rules: RuleCount[]; waiting: RuleCount[];
  // What the project's package.json depends on, when it has one.
  dependencies?: Dependencies;
  // The Node built-ins the project imports, the most used first, when it imports any.
  builtins?: Builtin[];
};
export type Builtin = { module: string; files: number; equivalent?: { name: string; planned: boolean } };

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
  { id: "moduleForms", action: "unsupported", title: "namespace imports, 'import x = require()', 'export =' and dynamic import()", feature: "Namespace imports" },
  { id: "pathAliases", action: "unsupported", title: "imports through path aliases such as '@/lib' or '~/lib'", feature: "Path aliases" },
  { id: "packages", action: "unsupported", title: "imports of npm packages", feature: "npm interop" },
  { id: "nodeBuiltins", action: "unsupported", title: "imports of Node built-in modules such as node:fs", feature: "Node built-ins" },
  { id: "destructuring", action: "guided", title: "destructuring Fish can't take as written: computed keys, a default on a whole destructured parameter, or nesting, defaults and rest in a loop head; name the parts, or destructure in the body" },
  { id: "localCaptures", action: "guided", title: "a class or enum declared inside a function that uses the function's variables: pass them to its constructor" },
  { id: "destructuringAssignment", action: "guided", title: "a destructuring assignment used as a value or as a for update: write it as a statement of its own" },
  { id: "defaults", action: "guided", title: "a default Fish can't take as written: before a required parameter, on a parameter that may be null, or neither typed nor a literal; move it last, use '?' and default in the body, or write the type" },
  { id: "declarators", action: "guided", title: "a let with neither a type nor a value: write its type, as in 'let x: string', since Fish doesn't work it out from later assignments" },
  { id: "tuples", action: "unsupported", title: "optional and rest elements in tuple types", feature: "Optional and rest tuple elements" },
  { id: "spread", action: "guided", title: "rest parameters on arrow functions, and spread arguments: Fish takes rest parameters on declared functions and methods, and spreads an argument only into a rest parameter" },
  { id: "collections", action: "unsupported", title: "WeakMap and WeakSet" },
  { id: "readonlyCollections", action: "unsupported", title: "ReadonlyMap and ReadonlySet (more utility types)", feature: "More utility types" },
  { id: "numberKeys", action: "guided", title: "a Map or Set keyed by 'number': Fish hashes integers and strings, so give it an integer key such as i64" },
  { id: "dynamicRegex", action: "reject", title: "regexes built while the program runs: Fish compiles every regex while compiling" },
  { id: "regexStrings", action: "guided", title: "match, matchAll and search given a string, and next() on matchAll: Fish takes a regex literal there, and matchAll gives an array" },
  { id: "replaceAllString", action: "unsupported", title: "replaceAll with a string", feature: "More string methods" },
  { id: "regexState", action: "guided", title: "exec or test on a g or y regex, and lastIndex: a Fish regex keeps no state; use matchAll, or drop the flag" },
  { id: "forIn", action: "unsupported", title: "for...in loops over an object's keys", feature: "for...in" },
  { id: "decorators", action: "unsupported", title: "decorators (macros, decorators and derive)", feature: "Macros, decorators and derive" },
  { id: "namespaces", action: "unsupported", title: "namespaces and module declarations", feature: "Namespaces" },
  { id: "genericMethods", action: "unsupported", title: "generic function types, generic arrows not held by a const, and generic methods in interfaces", feature: "Functions as values" },
  { id: "classForms", action: "unsupported", title: "#private names and abstract classes", feature: "Abstract classes and #private fields" },
  { id: "tagged", action: "guided", title: "tagged templates: a Fish tag takes its strings as 'comptime strings: TemplateStringsArray', so its code over them runs while compiling" },
  { id: "math", action: "unsupported", title: "Math.random", feature: "Randomness" },
  { id: "process", action: "unsupported", title: "process members besides argv, env and exit, and writes to process.env" },
  { id: "fetch", action: "unsupported", title: "fetch (HTTP client)", feature: "HTTP client" },
  { id: "timers", action: "unsupported", title: "setTimeout and setInterval", feature: "setTimeout and setInterval" },
  { id: "console", action: "unsupported", title: "console methods besides log, error and warn", feature: "The rest of console" },
  { id: "json", action: "unsupported", title: "JSON.parse revivers, and JSON.stringify's replacer and indent arguments" },
  { id: "promiseAll", action: "unsupported", title: "Promise.all and Promise.race", feature: "Promise.all and Promise.race" },
  { id: "nestedFunctions", action: "unsupported", title: "generic or generator function declarations inside a function" },
];

// A rejected construct has no Fish equivalent and needs a redesign; a guided one, a rewrite.
const WEIGHTS: Record<Action, number> = { reject: 10, guided: 3, auto: 0, unsupported: 0 };
// Score per 1000 lines at the top of each grade, set so published TypeScript packages spread
// across them: a careful codebase scores near 5, a library leaning on `any` near 40, a DOM
// implementation patching prototypes near 90.
const GRADES: [string, number][] = [["A", 5], ["B", 15], ["C", 40], ["D", 100]];
const MODULE_FORMS = new Set(["import", "importEquals", "exportAll", "exportAsNamespace", "exportAssign", "exportDefault", "exportNamed"]);

type Node = { kind: string; start: number; end: number; [key: string]: unknown };
const isNode = (v: unknown): v is Node => typeof v === "object" && v !== null && typeof (v as Node).kind === "string" && typeof (v as Node).start === "number";
const named = (n: unknown, name: string) => isNode(n) && n.kind === "ident" && n.name === name;
// Whether a Map's or a Set's type arguments key it by `number`, a float Fish doesn't hash.
const numberKey = (args: unknown) => Array.isArray(args) && isNode(args[0]) && args[0].kind === "ref" && args[0].name === "number";
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
    const program = parse(src);
    scan(program, (id, offset, module) => findings.push([id, { file, ...position(src, offset), ...(module && { module }) }]));
    for (const offset of captures(program)) findings.push(["localCaptures", { file, ...position(src, offset) }]);
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
  return [...new Set(f.findings.flatMap(([id, example]) => featureOf(id, example.module) ?? []))].sort();
}

// The feature a finding waits on: its rule's, or for a Node built-in, the planned feature that
// replaces that module, none when std already does, and "Node built-ins" when nothing will.
export function featureOf(id: string, module?: string): string | undefined {
  if (id !== "nodeBuiltins" || module === undefined) return FEATURES.get(id);
  const equivalent = BUILTINS.get(module);
  return equivalent ? (equivalent.planned ? equivalent.name : undefined) : FEATURES.get(id);
}

// What replaces each Node built-in in Fish: std, only where std covers what the module is used
// for, or a planned feature by its title. A subpath is looked up before its module.
const STD = (name: string) => ({ name, planned: false });
const PLANNED = (title: string) => ({ name: title, planned: true });
const BUILTINS = new Map<string, { name: string; planned: boolean }>([
  // `net` is TCP here; a socket path (Unix domain sockets) isn't told apart from an address.
  ["net", STD("TcpListener and TcpStream")], ["worker_threads", STD("spawn")], ["string_decoder", STD("TextDecoder")],
  ["timers/promises", STD("sleep")],
  // `http` is a client as well as a server, and Fish has only the server so far.
  ["http", PLANNED("HTTP client")], ["console", PLANNED("The rest of console")],
  ["test", PLANNED("Test runner")], ["sqlite", PLANNED("SQLite binding")],
  ["fs", PLANNED("Async file I/O")], ["path", PLANNED("Path utilities")], ["crypto", PLANNED("Hashing")],
  ["https", PLANNED("TLS")], ["tls", PLANNED("TLS")], ["http2", PLANNED("HTTP/2")], ["child_process", PLANNED("Process spawning")],
  ["events", PLANNED("EventTarget and EventEmitter")], ["url", PLANNED("URL and query strings")], ["querystring", PLANNED("URL and query strings")],
  ["os", STD("os, for hostname, tmpdir, homedir, platform and availableParallelism")], ["zlib", PLANNED("Response compression")], ["stream", PLANNED("ReadableStream")],
  ["buffer", PLANNED("Base64 and hex")], ["assert", PLANNED("assert")], ["timers", PLANNED("setTimeout and setInterval")],
  ["readline", PLANNED("Reading standard input")], ["dns", PLANNED("DNS and IPv6")], ["dgram", PLANNED("UDP sockets")],
  ["process", STD("process, for argv, env and exit")],
  ["async_hooks", PLANNED("Task-local context")], ["tty", PLANNED("Terminal detection and styled text")],
  // console.log prints as util.inspect does, but no plan gives util itself, as inspect or format.
]);
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
  const deps = dependencies(dir);
  const builtins = builtinsOf(scans);
  return { ...report(scans.length, lines, unread, all), ...(deps && { dependencies: deps }), ...(builtins.length > 0 && { builtins }) };
}

// Each Node built-in imported, with how many files import it and what replaces it.
function builtinsOf(scans: FileScan[]): Builtin[] {
  const files = new Map<string, Set<string>>();
  for (const f of scans) {
    for (const [id, example] of f.findings) {
      if (id !== "nodeBuiltins" || example.module === undefined) continue;
      files.set(example.module, (files.get(example.module) ?? new Set()).add(f.file));
    }
  }
  return [...files].map(([module, set]) => {
    const equivalent = BUILTINS.get(module);
    return { module, files: set.size, ...(equivalent && { equivalent }) };
  }).sort((a, b) => b.files - a.files || (a.module < b.module ? -1 : 1));
}

// A report from its rules' counts: the counts by action, the score and the grade, so a saved
// report read back is scored by the same rules as a fresh one.
function report(files: number, lines: number, unread: { files: number; lines: number }, all: RuleCount[]): Report {
  const counts: Record<Action, number> = { reject: 0, unsupported: 0, guided: 0, auto: 0 };
  for (const r of all) counts[r.action] += r.count;
  const weighted = all.reduce((sum, r) => sum + WEIGHTS[r.action] * r.count, 0);
  // Per 1000 lines, and never per fewer, so one finding in a small script doesn't swing the grade.
  const score = Math.round((weighted * 1000) / Math.max(lines, 1000) * 10) / 10;
  const graded = lines > 0 && lines >= unread.lines;
  const byCount = (a: RuleCount, b: RuleCount) => WEIGHTS[b.action] - WEIGHTS[a.action] || b.count - a.count;
  return {
    files, lines, unread, score, grade: graded ? grade(score) : null, counts,
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

// Where each local class or enum using its function's variables starts. Hoisting renames the
// tree it reads, so it reads a copy, and a file it can't hoist adds none.
function captures(program: Stmt[]): number[] {
  const found: number[] = [];
  try {
    hoistLocals(structuredClone(program), (local) => found.push(local.start));
  } catch {
    return [];
  }
  return found;
}

// Walks a program without recursion, so a deeply nested file can't overflow the stack. `depth`
// counts the functions a node sits in, and `ambient` marks declarations under `declare`.
function scan(program: unknown[], note: (id: string, offset: number, module?: string) => void) {
  for (const s of program) {
    const top = isNode(s) && (s.kind === "export" || s.kind === "declare") && isNode(s.body) ? s.body : s;
    if (!isNode(top)) continue;
    if (top.kind === "expr" && !(isNode(top.expr) && top.expr.kind === "string") && !callsMain(top.expr)) note("G7", top.start);
    if (top.kind === "let" && top.keyword === "let" && !(isNode(s) && s.kind === "declare")) note("A4", top.start);
  }
  const stack: [unknown, number, boolean][] = program.map((s) => [s, 0, false]);
  const heads = new WeakSet<object>();
  // Spreads written as call arguments, which fill only a rest parameter.
  const inCalls = new WeakSet<object>();
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
      if ((o.kind === "call" || o.kind === "new") && Array.isArray(o.args)) for (const a of o.args) if (isNode(a) && a.kind === "spread") inCalls.add(a);
      for (const [id, at, module] of classify(o, depth, ambient, heads.has(o), inCalls.has(o))) note(id, at, module);
      if (Array.isArray(o.params)) params(o.params as Record<string, unknown>[], note, o.kind === "arrow");
      if (Array.isArray(o.params) && "body" in o) inner++;
      if (o.kind === "declare") under = true;
    }
    for (const [key, child] of Object.entries(o)) if (key !== "start" && key !== "end" && typeof child === "object") stack.push([child, inner, under]);
  }
}

// Whether Fish takes a parameter's default as written: trailing, on a type without null, and
// typed or a literal that says its type.
function takesDefault(p: Record<string, unknown>, after: Record<string, unknown>[]): boolean {
  const d = p.default as { kind: string; op?: string; operand?: { kind: string }; exprs?: unknown[] };
  const literal = ["int", "float", "string", "bool"].includes(d.kind) || (d.kind === "template" && d.exprs?.length === 0) || (d.kind === "unary" && d.op === "-" && ["int", "float"].includes(d.operand?.kind ?? ""));
  const nullable = (t: unknown): boolean => isNode(t) && ((t.kind === "ref" && (t.name === "null" || t.name === "undefined")) || (t.kind === "union" && (t.types as unknown[]).some(nullable)));
  const empty = d.kind === "null" || (d.kind === "ident" && (d as { name?: string }).name === "undefined");
  const property = Array.isArray(p.modifiers) && p.modifiers.length > 0;
  return !property && after.every((q) => isNode(q.default) || q.optional || q.rest) && (isNode(p.type) || literal) && (!nullable(p.type) || empty);
}

// `main()` at the top level, or `main().catch(...)`, which a Fish program's `main` replaces.
function callsMain(e: unknown): boolean {
  if (!isNode(e) || e.kind !== "call") return false;
  if (named(e.callee, "main")) return true;
  return isNode(e.callee) && e.callee.kind === "member" && ["catch", "then"].includes(e.callee.name as string) && callsMain(e.callee.object);
}

function params(list: Record<string, unknown>[], note: (id: string, offset: number) => void, arrow: boolean) {
  for (const [i, p] of list.entries()) {
    if (isNode(p.default) && !takesDefault(p, list.slice(i + 1))) note("defaults", p.default.start);
    if (p.rest && arrow) note("spread", p.start as number);
    if (isNode(p.pattern) && p.pattern.kind !== "ident" && (isNode(p.default) || !fishPattern(p.pattern))) note("destructuring", p.pattern.start);
    if (p.optional) note("A2", p.start as number);
  }
}

// The rules a node shows by itself, each with where to point: a call's own method name rather
// than the start of a long chain.
// Generic arrows a const holds, which Fish declares as generic functions, and the members of
// interfaces, whose generic methods Fish doesn't have.
// `process.env.X` or `process.env[k]`, which Fish reads but doesn't yet write.
const envEntry = (t: unknown) => isNode(t) && (t.kind === "member" || t.kind === "index") && isNode(t.object) && t.object.kind === "member" && named(t.object.object, "process") && t.object.name === "env";
// The `process.env` nodes read by key, which Fish takes; any other use of it, it doesn't.
const envKeys = new WeakSet<object>();

const heldArrows = new WeakSet<object>();
const statementDestructures = new WeakSet<object>();
const interfaceMembers = new WeakSet<object>();

function classify(n: Node, depth: number, ambient: boolean, head: boolean, argument: boolean): [string, number, string?][] {
  const found: [string, number, string?][] = [];
  const at = n.kind === "call" && isNode(n.callee) && n.callee.kind === "member" ? n.callee.end - String(n.callee.name).length : n.start;
  const push = (id: string) => found.push([id, at]);
  switch (n.kind) {
    case "call":
      callRules(n, push);
      break;
    case "new":
      if (named(n.callee, "Function")) push("R1");
      if (["WeakMap", "WeakSet"].some((name) => named(n.callee, name))) push("collections");
      if (["Map", "Set"].some((name) => named(n.callee, name)) && numberKey(n.typeArgs)) push("numberKeys");
      break;
    case "member":
      if (n.name === "prototype") push("R2");
      if (named(n.object, "process") && !["argv", "env", "exit"].includes(n.name as string)) push("process");
      if (named(n.object, "process") && n.name === "env" && !envKeys.has(n)) push("process");
      if (envEntry(n) && !n.optional) envKeys.add(n.object as object);
      if (isPrivate(n.name)) push("classForms");
      break;
    case "unary":
      if (n.op === "delete") push("R3");
      if (n.op === "delete" && envEntry(n.operand)) push("process");
      break;
    case "assign":
      if (envEntry(n.target)) push("process");
      break;
    case "update":
      if (envEntry(n.operand)) push("process");
      break;
    case "binary":
      if (n.op === "instanceof") push("G5");
      if (n.op === "==" || n.op === "!=") push("A3");
      break;
    case "index":
      if (isNode(n.index) && (n.index.kind === "string" || n.index.kind === "template")) push("G6");
      if (envEntry(n) && !n.optional) envKeys.add(n.object as object);
      break;
    case "ref":
      if (n.name === "any") push("G1");
      if (n.name === "null" || n.name === "undefined") push("A2");
      if (["WeakMap", "WeakSet"].includes(n.name as string)) push("collections");
      if (["ReadonlyMap", "ReadonlySet"].includes(n.name as string)) push("readonlyCollections");
      if (["Map", "Set"].includes(n.name as string) && numberKey(n.args)) push("numberKeys");
      break;
    case "let":
      letRules(n, ambient, head, push);
      break;
    case "function":
      // A declaration carries `macro` and an expression a body; a function type has neither.
      if (!("macro" in n) && "body" in n) push("A9");
      // Nested functions work, except generic and generator ones.
      else if ("macro" in n && depth > 0 && ((Array.isArray(n.typeParams) && n.typeParams.length > 0) || n.generator === true)) push("nestedFunctions");
      break;
    case "method":
    case "get":
    case "set":
    case "property":
    case "field":
      memberRules(n, push);
      break;
  }
  if (n.kind === "spread" && argument) push("spread");
  // A regex literal ports; one built while the program runs can't.
  if (n.kind === "call" && isNode(n.callee) && n.callee.kind === "member") {
    const [first] = n.args as Node[];
    const literal = isNode(first) && (first.kind === "string" || first.kind === "template");
    const name = n.callee.name as string;
    if (literal && ["match", "matchAll", "search"].includes(name)) push("regexStrings");
    if (name === "next" && isNode(n.callee.object) && n.callee.object.kind === "call" && isNode(n.callee.object.callee) && n.callee.object.callee.kind === "member" && n.callee.object.callee.name === "matchAll") push("regexStrings");
    if (name === "replaceAll" && literal) push("replaceAllString");
  }
  const literal = (a: unknown) => isNode(a) && (a.kind === "string" || (a.kind === "template" && (a.exprs as unknown[]).length === 0));
  if (n.kind === "new" && named(n.callee, "RegExp") && !((n.args as Node[] | undefined) ?? []).every(literal)) push("dynamicRegex");
  if (n.kind === "call" && isNode(n.callee) && n.callee.kind === "member" && (n.callee.name === "exec" || n.callee.name === "test") && isNode(n.callee.object) && n.callee.object.kind === "regex" && /[gy]/.test(n.callee.object.flags as string)) push("regexState");
  if (n.kind === "member" && n.name === "lastIndex") push("regexState");
  // A destructuring assignment ports as a statement of its own.
  if (n.kind === "expr" && isNode(n.expr) && n.expr.kind === "destructure") statementDestructures.add(n.expr);
  if (n.kind === "destructure" && !statementDestructures.has(n)) push("destructuringAssignment");
  const simple: Record<string, string> = { tagged: "tagged", forIn: "forIn", namespace: "namespaces", privateName: "classForms" };
  if (Object.hasOwn(simple, n.kind)) push(simple[n.kind]!);
  if (n.kind === "tuple" && (n.elements as Node[]).some((e) => e.optional || e.rest)) push("tuples");
  if (n.kind === "as" && isNode(n.expr) && n.expr.kind === "call" && memberOf(n.expr.callee, "JSON", ["parse"])) push("A8");
  if (n.kind === "arrow" && (n.typeParams as unknown[]).length > 0 && !heldArrows.has(n)) push("genericMethods");
  if (n.kind === "function" && Array.isArray(n.typeParams) && n.typeParams.length > 0 && Array.isArray(n.params) && "returns" in n) push("genericMethods");
  if (n.kind === "interface" && Array.isArray(n.members)) for (const m of n.members as object[]) interfaceMembers.add(m);
  // A dynamic `import("x")` names its module as its first argument.
  const [first] = Array.isArray(n.args) ? n.args : [];
  const dynamic = n.kind === "import" && isNode(first) && first.kind === "string" ? first.value : undefined;
  const specifier = n.module ?? n.require ?? dynamic;
  const rule = MODULE_FORMS.has(n.kind) ? moduleRule(n, specifier) : undefined;
  if (rule) found.push([rule, at, rule === "nodeBuiltins" ? builtinModule(String(specifier)) : undefined]);
  // A class's base is one expression; an interface's are a list, which Fish keeps.
  if ("members" in n && isNode(n.extends)) push("G4");
  if (n.abstract === true && "members" in n) push("classForms");
  return found;
}

// What an import, export or re-export still needs, if anything: imports and exports between the
// program's files work, except in the forms Fish refuses; a path alias (`~/`, `@/` or `#`), a
// Node built-in or an npm package is told apart by how its specifier is written.
function moduleRule(n: Node, specifier: unknown): string | undefined {
  const form = n.kind === "importEquals" || n.kind === "exportAssign" || n.kind === "exportAsNamespace" || n.kind === "import" && (n.namespace !== undefined || !("module" in n)) || (n.kind === "exportAll" && n.alias !== undefined);
  if (typeof specifier !== "string") return form ? "moduleForms" : undefined;
  if (/^[#~]|^@\//.test(specifier)) return "pathAliases";
  if (specifier.startsWith(".")) return form ? "moduleForms" : undefined;
  if (stdHas(n, specifier)) return undefined;
  return specifier.startsWith("node:") || NODE_MODULES.has(specifier.split("/")[0]!) ? "nodeBuiltins" : "packages";
}

// Whether an import of a Node built-in is one Fish's std module answers: the module whole, or
// only names it has.
function stdHas(n: Node, specifier: string): boolean {
  const name = stdModule(specifier);
  if (!name || (n.kind !== "import" && n.kind !== "exportNamed" && n.kind !== "exportAll") || (n.kind === "exportAll" && n.alias !== undefined)) return false;
  const has = new Set(parse(STD_MODULES[name]!).flatMap((s) => (s.kind === "export" && s.body.kind === "function" ? [s.body.name] : [])));
  const names = (n.kind === "exportNamed" ? n.specifiers : n.named) as { name: string }[] | undefined;
  return (names ?? []).every((sp) => has.has(sp.name));
}

// The built-in an import names: its subpath when that has its own equivalent, else its module.
function builtinModule(specifier: string): string {
  const path = specifier.replace(/^node:/, "").replace(/\/$/, "");
  return BUILTINS.has(path) ? path : path.split("/")[0]!;
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
  if (memberOf(callee, "Math", ["random"])) push("math");
  if (named(callee, "fetch")) push("fetch");
  if (["setTimeout", "setInterval", "clearTimeout", "clearInterval"].some((name) => named(callee, name))) push("timers");
  if (isNode(callee) && callee.kind === "member" && named(callee.object, "console") && !["log", "error", "warn"].includes(callee.name as string)) push("console");
  // Fish's parse takes no reviver, and its stringify one value.
  if (memberOf(callee, "JSON", ["parse", "stringify"]) && (n.args as unknown[]).length > 1) push("json");
  if (memberOf(callee, "Promise", ["all", "race", "allSettled", "any"])) push("promiseAll");
  if (!isNode(callee) || callee.kind !== "member") return;
  const name = callee.name as string;
  if (["call", "apply", "bind"].includes(name)) push("G9");
  const [first] = n.args as Node[];
  if (name === "forEach" && isNode(first) && (first.kind === "arrow" || first.kind === "function") && first.async) push("G10");
}

// A pattern of names, holes and renames only, with no defaults, rest or nesting.
function plainPattern(p: Node): boolean {
  const name = (x: unknown) => x === undefined || x === null || (isNode(x) && x.kind === "ident");
  if (p.kind === "array") return !p.rest && (p.elements as unknown[]).every(name);
  return p.kind === "object" && !p.rest && (p.props as Node[]).every((q) => typeof q.key === "string" && name(q.value));
}

// A pattern Fish destructures in a declaration or a parameter: names, renames, defaults, holes,
// nesting and rest, with keys written as names.
function fishPattern(p: Node): boolean {
  const part = (x: unknown) => x === undefined || x === null || (isNode(x) && fishPattern(x));
  if (p.kind === "ident") return true;
  if (p.kind === "default") return isNode(p.target) && fishPattern(p.target);
  if (p.kind === "array") return (p.elements as unknown[]).every(part) && part(p.rest);
  return p.kind === "object" && (p.props as Node[]).every((q) => typeof q.key === "string" && part(q.value)) && part(p.rest);
}

function letRules(n: Node, ambient: boolean, head: boolean, push: (id: string) => void) {
  const declarations = n.declarations as { target: Node; type: unknown; init: unknown }[];
  if (n.keyword === "const") for (const d of declarations) if (isNode(d.init) && d.init.kind === "arrow" && d.target.kind === "ident") heldArrows.add(d.init);
  if (n.keyword === "var" && !ambient) push("A1");
  // A declaration under `declare` describes a value defined elsewhere, so it has no initializer.
  if (!head && !ambient && declarations.some((d) => !d.init && !d.type)) push("declarators");
  // A loop head's plain pattern, of names, holes and renames, is one Fish takes apart.
  if (declarations.some((d) => d.target.kind !== "ident" && !(head ? plainPattern(d.target) : fishPattern(d.target)))) push("destructuring");
}

function memberRules(n: Node, push: (id: string) => void) {
  if (n.optional === true) push("A2");
  if (isPrivate(n.name) || (Array.isArray(n.modifiers) && n.modifiers.includes("abstract"))) push("classForms");
  if (n.kind === "method" && Array.isArray(n.typeParams) && n.typeParams.length > 0 && interfaceMembers.has(n)) push("genericMethods");
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
    ...(r.dependencies ? formatDependencies(r.dependencies) : []),
    ...(r.builtins ? ["", "Node built-ins", ...r.builtins.map((b) => {
      const by = b.equivalent ? (b.equivalent.planned ? `planned: ${b.equivalent.name}` : `in std: ${b.equivalent.name}`) : "nothing planned";
      return `  ${b.module.padEnd(16)}${String(b.files).padStart(5)} file${b.files === 1 ? " " : "s"}  ${by}`;
    })] : []),
    ...(rewrites.length ? ["", "top rewrites", ...rewrites] : []),
    ...(waiting.length ? ["", "waiting on Fish", ...waiting] : []),
  ].join("\n");
}

// A summary of one survey, as a comparison shows it then and now.
type Summary = Pick<Report, "files" | "lines" | "unread" | "score" | "grade" | "counts">;
type Moved = { id: string; action: Action; title: string; then: number; now: number; change: number };
export type Comparison = { then: Summary; now: Summary; rules: Moved[] };

// A saved `fishc survey --json` report, checked enough to compare with, and scored again by
// today's rules, so a change in how scores are made isn't mistaken for a change in the project.
// A report saved before `waiting` or `unread` existed lists every rule in `rules`, and had none
// unread.
export function readReport(text: string): Report {
  let r: unknown;
  try {
    r = JSON.parse(text);
  } catch {
    throw new Error("it isn't JSON");
  }
  const bad = new Error("it isn't a 'fishc survey --json' report");
  const count = (n: unknown) => typeof n === "number" && Number.isInteger(n) && n >= 0;
  const o = r as Partial<Record<keyof Report, unknown>> | null;
  if (typeof o !== "object" || o === null || Array.isArray(o) || !Array.isArray(o.rules) || (o.waiting !== undefined && !Array.isArray(o.waiting))) throw bad;
  const all = [...o.rules, ...((o.waiting as unknown[] | undefined) ?? [])];
  const ids = new Set<string>();
  for (const x of all) {
    const rule = x as Partial<RuleCount> | null;
    if (typeof rule !== "object" || rule === null || typeof rule.id !== "string" || typeof rule.title !== "string" || !count(rule.count)) throw bad;
    if (!["reject", "unsupported", "guided", "auto"].includes(rule.action as string) || ids.has(rule.id)) throw bad;
    ids.add(rule.id);
  }
  const unread = (o.unread ?? { files: 0, lines: 0 }) as { files: unknown; lines: unknown };
  if (!count(o.files) || !count(o.lines) || typeof unread !== "object" || unread === null || !count(unread.files) || !count(unread.lines)) throw bad;
  return report(o.files as number, o.lines as number, unread as { files: number; lines: number }, all as RuleCount[]);
}

// What changed between two surveys: the summaries, and every rule whose count moved, the
// furthest first, a rule missing from either counting as none there.
export function compare(then: Report, now: Report): Comparison {
  const moved = new Map<string, Moved>();
  const tally = (report: Report, side: "then" | "now") => {
    for (const r of [...report.rules, ...report.waiting]) {
      // The current report's action and title win, a rule's wording may have changed since.
      const m = moved.get(r.id) ?? { id: r.id, action: r.action, title: r.title, then: 0, now: 0, change: 0 };
      moved.set(r.id, { ...m, ...(side === "now" && { action: r.action, title: r.title }), [side]: r.count });
    }
  };
  tally(then, "then");
  tally(now, "now");
  const rules = [...moved.values()].map((m) => ({ ...m, change: m.now - m.then })).filter((m) => m.change !== 0)
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change) || (a.id < b.id ? -1 : 1));
  const summary = ({ files, lines, unread, score, grade, counts }: Report): Summary => ({ files, lines, unread, score, grade, counts });
  return { then: summary(then), now: summary(now), rules };
}

export function formatComparison(c: Comparison): string {
  const { then, now } = c;
  const delta = (a: number, b: number) => {
    const d = Math.round((b - a) * 10) / 10;
    return d === 0 ? "" : ` (${d > 0 ? "+" : ""}${d})`;
  };
  const pair = (label: string, a: number, b: number) => `  ${label.padEnd(10)}${a} -> ${b}${delta(a, b)}`;
  const line = (m: Moved) => `  ${((m.change > 0 ? "+" : "") + m.change).padStart(6)}  ${m.title} (${m.then} -> ${m.now})`;
  const porter = c.rules.filter((m) => m.action !== "unsupported");
  const waiting = c.rules.filter((m) => m.action === "unsupported");
  return [
    `grade ${then.grade ?? "none"} -> ${now.grade ?? "none"}, score ${then.score} -> ${now.score}${delta(then.score, now.score)} per 1000 lines`,
    pair("files", then.files, now.files),
    pair("lines", then.lines, now.lines),
    pair("unread", then.unread.lines, now.unread.lines),
    pair("rejected", then.counts.reject, now.counts.reject),
    pair("guided", then.counts.guided, now.counts.guided),
    pair("auto-fix", then.counts.auto, now.counts.auto),
    pair("waiting", then.counts.unsupported, now.counts.unsupported),
    ...(c.rules.length === 0 ? ["", "no rule's count changed"] : []),
    ...(porter.length ? ["", "rewrites that changed", ...porter.map(line)] : []),
    ...(waiting.length ? ["", "waiting on Fish, changed", ...waiting.map(line)] : []),
  ].join("\n");
}
