import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { CompileError, locate } from "./diag.ts";
import { dependencies, formatDependencies, type Dependencies } from "./deps.ts";
import { hoistLocals } from "./locals.ts";
import { isNode, named, surveyHits, type Node } from "./migrate.ts";
import { nextId, renumber } from "./nodes.ts";
import { parse, type Stmt } from "./parser.ts";
import { STD_MODULES, stdModule } from "./std.ts";
import { findTypings } from "./typings.ts";

// `fishc survey`: how hard an existing TypeScript project is to port, read from its syntax alone.
// The grade counts the work a person does, the migration lint's rejected constructs and guided
// rewrites; constructs Fish doesn't support yet are listed apart, as what Fish itself still needs.

export type Action = "reject" | "unsupported" | "guided" | "auto";
// `feature` names the planned Fish feature that lifts a rule Fish doesn't support yet.
type Rule = { id: string; action: Action; title: string; feature?: string };
// `module` names the Node built-in an import of one brings in.
type Example = { file: string; line: usize; col: usize; note?: string; module?: string };
export type RuleCount = Rule & { count: usize; examples: Example[] };
export type Report = {
  files: usize; lines: usize; unread: { files: usize; lines: usize }; score: f64;
  // None when less than half the lines could be read, since the score wouldn't speak for them.
  grade: string | null;
  counts: Record<Action, usize>; rules: RuleCount[]; waiting: RuleCount[];
  // What the project's package.json depends on, when it has one.
  dependencies?: Dependencies;
  // The Node built-ins the project imports, the most used first, when it imports any.
  builtins?: Builtin[];
};
export type Builtin = { module: string; files: usize; equivalent?: { name: string; planned: boolean } };

const RULES: Rule[] = [
  { id: "R1", action: "reject", title: "eval and new Function: a native binary has no compiler to run code made at run time" },
  { id: "R2", action: "reject", title: "prototype edits and Object.defineProperty: Fish types have fixed layouts" },
  { id: "R3", action: "reject", title: "delete: Fish objects have fixed layouts; use an Option field or a Map" },
  { id: "R5", action: "reject", title: "the arguments object: use rest parameters" },
  { id: "R6", action: "reject", title: "Symbol: Fish has no runtime reflection" },
  { id: "R7", action: "reject", title: "declaration merging and module augmentation: Fish types are closed after they are declared" },
  { id: "G1", action: "guided", title: "any: choose a concrete type, a union, or the dynamic Json value" },
  { id: "G2", action: "guided", title: "a promise dropped un-awaited: add await, or spawn() it to run on its own" },
  { id: "G3", action: "guided", title: "a number used as a count or an index: make it i64, or usize for an index" },
  { id: "G4", action: "guided", title: "class extends with the base used as a type: Fish embeds the base, so a polymorphic hierarchy becomes an interface" },
  { id: "G5", action: "guided", title: "instanceof a class others extend: match on an interface or an enum instead" },
  { id: "G6", action: "guided", title: "indexing an object with a string key: use a Map" },
  { id: "G7", action: "guided", title: "top-level code with side effects: move it into main() or a Lazy<T>" },
  { id: "G8", action: "guided", title: "isNaN after parsing: Fish's parsing gives an Option to check" },
  { id: "G9", action: "guided", title: ".call, .apply and .bind: pass the receiver explicitly or use a closure" },
  { id: "G10", action: "guided", title: "an async callback passed to forEach: use for...of with await, or spawned tasks" },
  { id: "G11", action: "guided", title: "a value aliased and changed from two names: shared<T>, a .clone(), or restructuring" },
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
  { id: "bunModules", action: "unsupported", title: "imports of Bun's own modules such as bun:test", feature: "Bun's own modules" },
  { id: "untypedPackages", action: "unsupported", title: "imports of installed npm packages with no TypeScript declarations", feature: "Calling JsValues" },
  { id: "nodeBuiltins", action: "unsupported", title: "imports of Node built-in modules such as node:fs", feature: "Node built-ins" },
  { id: "destructuring", action: "guided", title: "destructuring Fish can't take as written: computed keys, a default on a whole destructured parameter, or nesting, defaults and rest in a loop head; name the parts, or destructure in the body" },
  { id: "localCaptures", action: "guided", title: "a class or enum declared inside a function that uses the function's variables: pass them to its constructor" },
  { id: "destructuringAssignment", action: "guided", title: "a destructuring assignment used as a value or as a for update: write it as a statement of its own" },
  { id: "defaults", action: "guided", title: "a default Fish can't take as written: before a required parameter, on a parameter that may be null, or neither typed nor a literal; move it last, use '?' and default in the body, or write the type" },
  { id: "declarators", action: "guided", title: "a let with neither a type nor a value: write its type, as in 'let x: string', since Fish doesn't work it out from later assignments" },
  { id: "tuples", action: "unsupported", title: "a rest element before the end of a tuple type, or one beside optional elements" },
  { id: "spread", action: "guided", title: "rest parameters on arrow functions, and spread arguments: Fish takes rest parameters on declared functions and methods, and spreads an argument only into a rest parameter" },
  { id: "collections", action: "unsupported", title: "WeakMap and WeakSet" },
  { id: "readonlyCollections", action: "unsupported", title: "ReadonlyMap and ReadonlySet (more utility types)", feature: "More utility types" },
  { id: "forAwaitArrays", action: "guided", title: "for await over an array of promises: Fish loops with for await over an async generator or a Channel, so await Promise.all(...) and loop over its result with for...of" },
  { id: "numberKeys", action: "guided", title: "a Map or Set keyed by 'number': Fish hashes integers and strings, so give it an integer key such as i64" },
  { id: "dynamicRegex", action: "reject", title: "regexes built while the program runs: Fish compiles every regex while compiling" },
  { id: "regexStrings", action: "guided", title: "match, matchAll and search given a string, and next() on matchAll: Fish takes a regex literal there, and matchAll gives an array" },
  { id: "regexState", action: "guided", title: "exec or test on a g or y regex, and lastIndex: a Fish regex keeps no state; use matchAll, or drop the flag" },
  { id: "forIn", action: "unsupported", title: "for...in loops over an object's keys", feature: "for...in" },
  { id: "decorators", action: "unsupported", title: "decorators (macros, decorators and derive)", feature: "Macros, decorators and derive" },
  { id: "namespaces", action: "unsupported", title: "namespaces and module declarations", feature: "Namespaces" },
  { id: "genericFunctionsHeld", action: "unsupported", title: "generic function types held in class fields, arrays or unions, which would box a family of functions" },
  { id: "classForms", action: "unsupported", title: "abstract fields, and '#x in obj' checks" },
  { id: "tagged", action: "guided", title: "tagged templates: a Fish tag takes its strings as 'comptime strings: TemplateStringsArray', so its code over them runs while compiling" },
  { id: "process", action: "unsupported", title: "process members besides argv, env and exit, and writes to process.env" },
  { id: "timerForms", action: "unsupported", title: "setImmediate, unref on a timer, and more than two arguments passed on to a timer's function" },
  { id: "console", action: "unsupported", title: "console methods besides log, error and warn", feature: "The rest of console" },
  { id: "json", action: "unsupported", title: "JSON.parse revivers, and JSON.stringify's replacer and indent arguments" },
  { id: "nestedFunctions", action: "unsupported", title: "generic or generator function declarations inside a function" },
];

// A rejected construct has no Fish equivalent and needs a redesign; a guided one, a rewrite.
const WEIGHTS: Record<Action, usize> = { reject: 10, guided: 3, auto: 0, unsupported: 0 };
// Score per 1000 lines at the top of each grade, set so published TypeScript packages spread
// across them: a careful codebase scores near 5, a library leaning on `any` near 40, a DOM
// implementation patching prototypes near 90.
const GRADES: [string, f64][] = [["A", 5], ["B", 15], ["C", 40], ["D", 100]];
const MODULE_FORMS = new Set(["import", "importEquals", "exportAll", "exportAsNamespace", "exportAssign", "exportDefault", "exportNamed"]);

// Whether a Map's or a Set's type arguments key it by `number`, a float Fish doesn't hash.
const numberKey = (args: unknown) => Array.isArray(args) && isNode(args[0]) && args[0].kind === "ref" && args[0].name === "number";
const memberOf = (n: unknown, object: string, names: string[]) => isNode(n) && n.kind === "member" && named(n.object, object) && names.includes(n.name as string);

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
export type FileScan = { file: string; lines: usize; read: boolean; findings: [string, Example][] };

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
    const program = parse(src, { last: 0 });
    scan(path, program, (id, offset, module) => findings.push([id, { file, ...position(src, offset), ...(module && { module }) }]));
    // The reject and guided rules, A1, A3 and A8 come from the migration lint's detector. Its A2, A4 and A9
    // find only what they can fix, so the survey counts those its own wider way.
    for (const hit of surveyHits(program)) findings.push([hit.rule, { file, ...position(src, hit.start) }]);
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
// replaces that module, none when std already does, and "Node built-ins" when nothing will. An
// import of a Fish std module is found only for a member std lacks, which nothing plans.
export function featureOf(id: string, module?: string): string | undefined {
  if (id !== "nodeBuiltins" || module === undefined) return FEATURES.get(id);
  const equivalent = BUILTINS.get(module);
  if (equivalent && !equivalent.planned && stdModule(module)) return FEATURES.get(id);
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
  ["test", PLANNED("Jest-style test API")], ["sqlite", PLANNED("SQLite binding")],
  ["fs/promises", STD("fs/promises, for readFile and writeFile")], ["fs", STD("fs, for readFileSync, writeFileSync, existsSync, statSync, lstatSync, readdirSync, realpathSync, mkdtempSync and rmSync")], ["util", STD("util, for format, inspect, isDeepStrictEqual and parseArgs")], ["path", STD("path, for join, dirname, basename, extname, resolve, relative and normalize")], ["crypto", PLANNED("Hashing")],
  ["https", PLANNED("TLS")], ["tls", PLANNED("TLS")], ["http2", PLANNED("HTTP/2")], ["child_process", STD("child_process, for spawnSync, execFileSync and execSync")],
  ["events", PLANNED("EventTarget and EventEmitter")], ["url", PLANNED("URL and query strings")], ["querystring", PLANNED("URL and query strings")],
  ["os", STD("os, for hostname, tmpdir, homedir, platform and availableParallelism")], ["zlib", PLANNED("Response compression")], ["stream", PLANNED("ReadableStream")],
  ["buffer", PLANNED("Typed arrays and DataView")], ["assert", STD("assert, for the default export and ok")], ["timers", STD("the setTimeout and setInterval globals")],
  // `dns` isn't here: connect and fetch look host names up, but no plan item gives `dns.lookup`.
  // `buffer` is more than the base64 and hex std has: `Buffer` is a typed array with endian reads.
  // `crypto` is more than the random functions std has: an import of only those is portable.
  ["readline", PLANNED("Reading standard input")], ["dgram", PLANNED("UDP sockets")],
  ["process", STD("process, for argv, env and exit")], ["perf_hooks", STD("the global performance, for now()")],
  ["async_hooks", PLANNED("Task-local context")], ["tty", PLANNED("Terminal detection and styled text")],
]);
const FEATURES = new Map(RULES.flatMap((r) => (r.feature ? [[r.id, r.feature] as const] : [])));

export function survey(dir: string): Report {
  const scans = scanFiles(dir);
  const found = new Map<string, { count: usize; examples: Example[] }>();
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
  }).sort((a, b) => (b.files as i64) - (a.files as i64) || (a.module < b.module ? -1 : 1));
}

// A report from its rules' counts: the counts by action, the score and the grade, so a saved
// report read back is scored by the same rules as a fresh one.
function report(files: usize, lines: usize, unread: { files: usize; lines: usize }, all: RuleCount[]): Report {
  const counts: Record<Action, usize> = { reject: 0, unsupported: 0, guided: 0, auto: 0 };
  for (const r of all) counts[r.action] += r.count;
  const weighted = all.reduce((sum, r) => sum + WEIGHTS[r.action] * r.count, 0);
  // Per 1000 lines, and never per fewer, so one finding in a small script doesn't swing the grade.
  const score = Math.round((weighted * 1000) / Math.max(lines, 1000) * 10) / 10;
  const graded = lines > 0 && lines >= unread.lines;
  const byCount = (a: RuleCount, b: RuleCount) => (WEIGHTS[b.action] as i64) - (WEIGHTS[a.action] as i64) || (b.count as i64) - (a.count as i64);
  return {
    files, lines, unread, score, grade: graded ? grade(score) : null, counts,
    rules: all.filter((r) => r.action !== "unsupported").sort(byCount),
    waiting: all.filter((r) => r.action === "unsupported").sort(byCount),
  };
}

// Records a finding, keeping three examples.
function add(found: Map<string, { count: usize; examples: Example[] }>, id: string, example: Example) {
  const entry = found.get(id) ?? { count: 0, examples: [] };
  found.set(id, entry);
  entry.count++;
  if (entry.examples.length < 3) entry.examples.push(example);
}

function position(src: string, offset: usize) {
  const { line, col } = locate(src, offset);
  return { line, col };
}

export function grade(score: f64): string {
  return GRADES.find(([, top]) => score <= top)?.[0] ?? "F";
}

// Where each local class or enum using its function's variables starts. Hoisting renames the
// tree it reads, so it reads a copy, and a file it can't hoist adds none.
function captures(program: Stmt[]): usize[] {
  const found: usize[] = [];
  try {
    const ids = { last: 0 };
    hoistLocals({ names: { local: new Set(), madeUp: new Map() }, ids }, renumber(structuredClone(program), () => nextId(ids)), (local) => found.push(local.start));
  } catch {
    return [];
  }
  return found;
}

// Walks a program without recursion, so a deeply nested file can't overflow the stack. `depth`
// counts the functions a node sits in, and `ambient` marks declarations under `declare`. `path` is
// the file's, whose packages its imports name.
function scan(path: string, program: unknown[], note: (id: string, offset: usize, module?: string) => void) {
  for (const s of program) {
    const top = isNode(s) && (s.kind === "export" || s.kind === "declare") && isNode(s.body) ? s.body : s;
    if (!isNode(top)) continue;
    if (top.kind === "let" && top.keyword === "let" && !(isNode(s) && s.kind === "declare")) note("A4", top.start);
  }
  // A std module imported whole, by its local name, with what it exports: a member it doesn't
  // have still waits, though the import is portable.
  const wholes = new Map<string, { module: string; has: Set<string>; names: Record<string, string> }>();
  for (const s of program) {
    if (!isNode(s) || s.kind !== "import" || typeof s.module !== "string") continue;
    const name = stdModule(s.module);
    const whole = (s.namespace ?? s.default) as string | undefined;
    if (name && whole) wholes.set(whole, { module: builtinModule(s.module), has: stdExports(name), names: NAME_MODULES[name] ?? {} });
  }
  const stack: [unknown, usize, boolean][] = program.map((s) => [s, 0, false]);
  const scanning: Scanning = { path, envKeys: new WeakSet(), statementDestructures: new WeakSet() };
  const heads = new WeakSet<object>();
  // Spreads written as call arguments, which fill only a rest parameter.
  const inCalls = new WeakSet<object>();
  // The names the file declares as arrays, and its `for await` loops, judged once both are known.
  const arrays = new Set<string>();
  const awaitLoops: Node[] = [];
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
      if (o.kind === "forOf" && o.await === true) awaitLoops.push(o);
      for (const name of arrayNames(o)) arrays.add(name);
      if ((o.kind === "call" || o.kind === "new") && Array.isArray(o.args)) for (const a of o.args) if (isNode(a) && a.kind === "spread") inCalls.add(a);
      for (const [id, at, module] of classify(scanning, o, depth, ambient, heads.has(o), inCalls.has(o))) note(id, at, module);
      const whole = o.kind === "member" && isNode(o.object) && o.object.kind === "ident" ? wholes.get(o.object.name as string) : undefined;
      if (whole && !whole.has.has(o.name as string)) note("nodeBuiltins", o.start as usize, Object.hasOwn(whole.names, o.name as string) ? whole.names[o.name as string] : whole.module);
      if (Array.isArray(o.params)) params(o.params as Record<string, unknown>[], note, o.kind === "arrow");
      if (Array.isArray(o.params) && "body" in o) inner++;
      if (o.kind === "declare") under = true;
    }
    for (const [key, child] of Object.entries(o)) if (key !== "start" && key !== "end" && typeof child === "object") stack.push([child, inner, under]);
  }
  for (const loop of awaitLoops) if (isNode(loop.right) && arrayValue(loop.right, arrays)) note("forAwaitArrays", loop.right.start);
}

// The array methods that give a new array, as in `for await (const r of urls.map(fetch))`.
const ARRAY_MAKERS = new Set(["map", "filter", "slice", "concat", "flat", "flatMap", "toSorted", "toReversed"]);

// Whether an expression is an array: a literal, an array method's result, `Array.from`, or a name
// the file declares as one. Read from syntax alone, so an array reached any other way is missed.
function arrayValue(e: unknown, arrays: Set<string>): boolean {
  if (!isNode(e)) return false;
  if (e.kind === "array") return true;
  if (e.kind === "ident") return arrays.has(e.name as string);
  if (e.kind !== "call" || !isNode(e.callee) || e.callee.kind !== "member") return false;
  return ARRAY_MAKERS.has(e.callee.name as string) || (named(e.callee.object, "Array") && e.callee.name === "from");
}

// The names a declaration or a parameter list gives an array: by an array type, or a value that is one.
function arrayNames(n: Node): string[] {
  const typed = (t: unknown) => isNode(t) && (t.kind === "array" || t.kind === "tuple" || (t.kind === "ref" && (t.name === "Array" || t.name === "ReadonlyArray")));
  const declared = (target: unknown) => (isNode(target) && target.kind === "ident" ? [target.name as string] : []);
  if (n.kind === "let" && Array.isArray(n.declarations)) {
    return (n.declarations as Record<string, unknown>[]).flatMap((d) => (typed(d.type) || arrayValue(d.init, new Set()) ? declared(d.target) : []));
  }
  if (Array.isArray(n.params)) return (n.params as Record<string, unknown>[]).flatMap((p) => (typed(p.type) ? declared(p.pattern) : []));
  return [];
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

function params(list: Record<string, unknown>[], note: (id: string, offset: usize) => void, arrow: boolean) {
  for (const [i, p] of list.entries()) {
    if (isNode(p.default) && !takesDefault(p, list.slice(i + 1))) note("defaults", p.default.start);
    if (p.rest && arrow) note("spread", p.start as usize);
    if (isNode(p.pattern) && p.pattern.kind !== "ident" && (isNode(p.default) || !fishPattern(p.pattern))) note("destructuring", p.pattern.start);
    if (p.optional) note("A2", p.start as usize);
  }
}

// What a scan of one file at `path` notes as it goes: the `process.env` nodes read by key, which
// Fish takes (any other use of it, it doesn't), and the destructuring assignments written as
// statements of their own.
type Scanning = { path: string; envKeys: WeakSet<object>; statementDestructures: WeakSet<object> };

// The rules a node shows by itself, each with where to point: a call's own method name rather
// than the start of a long chain.
// `process.env.X` or `process.env[k]`, which Fish reads but doesn't yet write.
const envEntry = (t: unknown) => isNode(t) && (t.kind === "member" || t.kind === "index") && isNode(t.object) && t.object.kind === "member" && named(t.object.object, "process") && t.object.name === "env";

function classify({ path, envKeys, statementDestructures }: Scanning, n: Node, depth: usize, ambient: boolean, head: boolean, argument: boolean): [string, usize, string?][] {
  const found: [string, usize, string?][] = [];
  const at = n.kind === "call" && isNode(n.callee) && n.callee.kind === "member" ? n.callee.end - String(n.callee.name).length : n.start;
  const push = (id: string) => found.push([id, at]);
  switch (n.kind) {
    case "call":
      callRules(n, push);
      break;
    case "new":
      if (["WeakMap", "WeakSet"].some((name) => named(n.callee, name))) push("collections");
      if (["Map", "Set"].some((name) => named(n.callee, name)) && numberKey(n.typeArgs)) push("numberKeys");
      break;
    case "member":
      if (named(n.object, "process") && !["argv", "env", "exit"].includes(n.name as string)) push("process");
      if (named(n.object, "process") && n.name === "env" && !envKeys.has(n)) push("process");
      if (envEntry(n) && !n.optional) envKeys.add(n.object as object);
      break;
    case "unary":
      if (n.op === "delete" && envEntry(n.operand)) push("process");
      break;
    case "assign":
      if (envEntry(n.target)) push("process");
      break;
    case "update":
      if (envEntry(n.operand)) push("process");
      break;
    case "binary":
      break;
    case "index":
      if (envEntry(n) && !n.optional) envKeys.add(n.object as object);
      break;
    case "ref":
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
  if (n.kind === "tuple") {
    const elements = n.elements as Node[];
    const rest = elements.findIndex((e) => e.rest);
    if (rest >= 0 && (rest < elements.length - 1 || elements.some((e) => e.optional))) push("tuples");
  }
  if ((n.kind === "array" && genericFunctionType(n.element)) || (n.kind === "union" && (n.types as unknown[]).some(genericFunctionType))) push("genericFunctionsHeld");
  // A dynamic `import("x")` names its module as its first argument.
  const [first] = Array.isArray(n.args) ? n.args : [];
  const dynamic = n.kind === "import" && isNode(first) && first.kind === "string" ? first.value : undefined;
  const specifier = n.module ?? n.require ?? dynamic;
  const rule = MODULE_FORMS.has(n.kind) ? moduleRule(path, n, specifier) : undefined;
  if (rule === "nodeBuiltins") for (const module of waitingModules(n, String(specifier))) found.push([rule, at, module]);
  else if (rule) found.push([rule, at]);
  return found;
}

// What an import, export or re-export still needs, if anything: imports and exports between the
// program's files work, except in the forms Fish refuses; a path alias (`~/`, `@/` or `#`), a
// Node built-in, one of Bun's modules or an npm package is told apart by how its specifier is
// written. An npm package imported by name runs in the embedded JS engine, bundled while
// compiling, whole or by name; one imported dynamically, through 'import x = require()' or
// re-exported whole isn't.
function moduleRule(path: string, n: Node, specifier: unknown): string | undefined {
  const form = n.kind === "importEquals" || n.kind === "exportAssign" || n.kind === "exportAsNamespace" || n.kind === "import" && (n.namespace !== undefined || !("module" in n)) || (n.kind === "exportAll" && n.alias !== undefined);
  if (typeof specifier !== "string") return form ? "moduleForms" : undefined;
  if (/^[#~]|^@\//.test(specifier)) return "pathAliases";
  if (specifier.startsWith(".")) return form ? "moduleForms" : undefined;
  if (stdHas(n, specifier)) return undefined;
  if (specifier.startsWith("node:") || NODE_MODULES.has(specifier.split("/")[0]!)) return "nodeBuiltins";
  if (specifier === "bun" || specifier.startsWith("bun:")) return "bunModules";
  if ((form && !(n.kind === "import" && n.namespace !== undefined)) || n.kind === "exportAll") return "moduleForms";
  return untyped(path, specifier) ? "untypedPackages" : undefined;
}

// Whether a package is installed with no declarations, which Fish types it from; one not
// installed is the dependency report's to note.
function untyped(from: string, specifier: string): boolean {
  const found = findTypings(from, specifier);
  return "missing" in found && !found.missing.startsWith("can't find the package");
}

// Whether an import of a Node built-in is one Fish's std module answers: the module whole, or
// only names it has.
function stdHas(n: Node, specifier: string): boolean {
  const name = stdModule(specifier);
  if (!name || (n.kind !== "import" && n.kind !== "exportNamed" && n.kind !== "exportAll") || (n.kind === "exportAll" && n.alias !== undefined)) return false;
  const has = stdExports(name);
  const names = (n.kind === "exportNamed" ? n.specifiers : n.named) as { name: string }[] | undefined;
  return (names ?? []).every((sp) => has.has(sp.name));
}

// Names of a std module's Node counterpart that wait on something besides the module's own
// equivalent, by the built-in each is filed under. Node's randomBytes gives a Buffer and std's a
// u8[], so code calling Buffer methods on it, as 'randomBytes(16).toString("hex")', waits on typed
// arrays. randomInt has no plan item, so it is filed under its own name, which nothing replaces.
const NAME_MODULES: Record<string, Record<string, string>> = { crypto: { randomBytes: "buffer", randomInt: "crypto.randomInt" } };

// What a std module exports that ports as written: its functions and its consts, less those.
function stdExports(name: string): Set<string> {
  const names = NAME_MODULES[name] ?? {};
  return new Set(parse(STD_MODULES[name]!, { last: 0 }).flatMap((s) => (s.kind !== "export" ? [] : s.body.kind === "function" ? [s.body.name] : s.body.kind === "let" ? s.body.declarations.flatMap((d) => (d.target.kind === "ident" ? [d.target.name] : [])) : [])).filter((n) => !Object.hasOwn(names, n)));
}

// The built-ins an import waits on, one for each that a name std lacks is filed under, so a file
// importing names that wait on different features waits on all of them.
function waitingModules(n: Node, specifier: string): string[] {
  const name = stdModule(specifier);
  const module = builtinModule(specifier);
  if (!name) return [module];
  const named = ((n.kind === "exportNamed" ? n.specifiers : n.named) as { name: string }[] | undefined) ?? [];
  const has = stdExports(name);
  const names = NAME_MODULES[name] ?? {};
  const lacking = named.filter((sp) => !has.has(sp.name));
  if (lacking.length === 0) return [module];
  return [...new Set(lacking.map((sp) => (Object.hasOwn(names, sp.name) ? names[sp.name]! : module)))];
}

// The built-in an import names: its subpath when that has its own equivalent, else its module.
function builtinModule(specifier: string): string {
  const path = specifier.replace(/^node:/, "").replace(/\/$/, "");
  return BUILTINS.has(path) ? path : path.split("/")[0]!;
}

// Node's own modules, fixed so the answer doesn't depend on the runtime running the survey.
export const NODE_MODULES = new Set(["assert", "async_hooks", "buffer", "child_process", "cluster", "console", "constants", "crypto",
  "dgram", "diagnostics_channel", "dns", "domain", "events", "fs", "http", "http2", "https", "inspector", "module", "net", "os",
  "path", "perf_hooks", "process", "punycode", "querystring", "readline", "repl", "stream", "string_decoder", "sys", "timers",
  "tls", "trace_events", "tty", "url", "util", "v8", "vm", "wasi", "worker_threads", "zlib"]);

function callRules(n: Node, push: (id: string) => void) {
  const callee = n.callee as Node;
  if (named(callee, "setImmediate") || named(callee, "clearImmediate")) push("timerForms");
  if ((named(callee, "setTimeout") || named(callee, "setInterval")) && (n.args as unknown[]).length > 4) push("timerForms");
  if (isNode(callee) && callee.kind === "member" && callee.name === "unref") push("timerForms");
  if (isNode(callee) && callee.kind === "member" && named(callee.object, "console") && !["log", "error", "warn"].includes(callee.name as string)) push("console");
  // Fish's parse takes no reviver, and its stringify one value.
  if (memberOf(callee, "JSON", ["parse", "stringify"]) && (n.args as unknown[]).length > 1) push("json");
  if (!isNode(callee) || callee.kind !== "member") return;
  const name = callee.name as string;
  const [first] = n.args as Node[];
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
  // A declaration under `declare` describes a value defined elsewhere, so it has no initializer.
  if (!head && !ambient && declarations.some((d) => !d.init && !d.type)) push("declarators");
  // A loop head's plain pattern, of names, holes and renames, is one Fish takes apart.
  if (declarations.some((d) => d.target.kind !== "ident" && !(head ? plainPattern(d.target) : fishPattern(d.target)))) push("destructuring");
}

// A generic function type, as `<T>(x: T) => T`, seen through parentheses.
function genericFunctionType(t: unknown): boolean {
  if (!isNode(t)) return false;
  if (t.kind === "parenthesized") return genericFunctionType(t.type);
  return t.kind === "function" && Array.isArray(t.typeParams) && t.typeParams.length > 0 && "returns" in t;
}

function memberRules(n: Node, push: (id: string) => void) {
  if (n.optional === true) push("A2");
  if (n.kind === "field" && Array.isArray(n.modifiers) && n.modifiers.includes("abstract")) push("classForms");
  if (n.kind === "field" && genericFunctionType(n.type)) push("genericFunctionsHeld");
}

// The report as text: what was read, the grade, the rewrites that cost most, then what Fish
// still needs before the project can be ported.
export function formatReport(r: Report): string {
  const example = (e: Example) => `${e.file}:${e.line}:${e.col}${e.note ? ` (${e.note})` : ""}`;
  const top = (rules: RuleCount[]) => rules.filter((x) => x.count > 0).slice(0, 10)
    .map((x) => `  ${String(x.count).padStart(5)}  ${x.title}\n         e.g. ${example(x.examples[0]!)}`);
  const rewrites = top(r.rules.filter((x) => x.action !== "auto"));
  const waiting = top(r.waiting);
  const plural = (n: usize, what: string) => `${n} ${what}${n === 1 ? "" : "s"}`;
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
type Moved = { id: string; action: Action; title: string; then: usize; now: usize; change: i64 };
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
  return report(o.files as usize, o.lines as usize, unread as { files: usize; lines: usize }, all as RuleCount[]);
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
  const rules = [...moved.values()].map((m) => ({ ...m, change: (m.now as i64) - (m.then as i64) })).filter((m) => m.change !== 0)
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change) || (a.id < b.id ? -1 : 1));
  const summary = ({ files, lines, unread, score, grade, counts }: Report): Summary => ({ files, lines, unread, score, grade, counts });
  return { then: summary(then), now: summary(now), rules };
}

export function formatComparison(c: Comparison): string {
  const { then, now } = c;
  const delta = (a: f64, b: f64) => {
    const d = Math.round((b - a) * 10) / 10;
    return d === 0 ? "" : ` (${d > 0 ? "+" : ""}${d})`;
  };
  const pair = (label: string, a: usize, b: usize) => `  ${label.padEnd(10)}${a} -> ${b}${delta(a as f64, b as f64)}`;
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
