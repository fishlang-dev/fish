import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { CompileError, locate } from "./diag.fsh";
import { dependencies, formatDependencies, type Dependencies } from "./deps.fsh";
import { hoistLocals } from "./locals.fsh";
import { surveyHits } from "./migrate.fsh";
import { forEachChild, reborrowNode, type AnyNode } from "./nodes.fsh";
import { parse, type ClassMember, type Expr, type ObjectProp, type Param, type Pattern, type PropertyName, type Specifier, type Stmt, type TupleElement, type TypeMember, type TypeNode } from "./parser.fsh";
import { BUFFER_REFUSED, BUFFER_STATICS, STD_MODULES, stdModule } from "./std.fsh";
import { findTypings } from "./typings.fsh";
import { IMPORT_META_MEMBERS } from "./unsupported.fsh";

// `fishc survey`: how hard an existing TypeScript project is to port, read from its syntax alone.
// The grade counts the work a person does, the migration lint's rejected constructs and guided
// rewrites; constructs Fish doesn't support yet are listed apart, as what Fish itself still needs.

export type Action = "reject" | "unsupported" | "guided" | "auto";
// `feature` names the planned Fish feature that lifts a rule Fish doesn't support yet.
type Rule = { id: string; action: Action; title: string; feature?: string };
// `module` names the Node built-in an import of one brings in.
type Example = { file: string; line: usize; col: usize; note?: string; module?: string };
export type RuleCount = { id: string; action: Action; title: string; feature?: string; count: usize; examples: Example[] };
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
  { id: "R3", action: "reject", title: "delete on an object not declared as a dictionary: Fish objects have fixed layouts; use an Option field, a dictionary type or a Map" },
  { id: "R5", action: "reject", title: "the arguments object: use rest parameters" },
  { id: "R6", action: "reject", title: "Symbol: Fish has no runtime reflection" },
  { id: "R7", action: "reject", title: "declaration merging and module augmentation: Fish types are closed after they are declared" },
  { id: "G1", action: "guided", title: "any: choose a concrete type, a union, unknown narrowed before use, or the dynamic Json value" },
  { id: "G2", action: "guided", title: "a promise dropped un-awaited: add await, or spawn() it to run on its own" },
  { id: "G3", action: "guided", title: "a number used as a count or an index: make it i64, or usize for an index" },
  { id: "G4", action: "guided", title: "class extends with the base used as a type: Fish embeds the base, so a polymorphic hierarchy becomes an interface" },
  { id: "G5", action: "guided", title: "instanceof a class others extend: match on an interface or an enum instead" },
  { id: "G6", action: "guided", title: "indexing an object not declared as a dictionary with a string key, or testing a key known only at run time with 'in': declare it '{ [k: string]: T }' or 'Record<string, T>', or use a Map" },
  { id: "G7", action: "guided", title: "top-level code with side effects: move it into main() or a Lazy<T>" },
  { id: "G8", action: "guided", title: "isNaN after parsing: Fish's parsing gives an Option to check" },
  { id: "G9", action: "guided", title: ".call, .apply and .bind: pass the receiver explicitly or use a closure" },
  { id: "G10", action: "guided", title: "an async callback passed to forEach: use for...of with await, or spawned tasks" },
  { id: "G11", action: "guided", title: "a value aliased and changed from two names: Rc<T> in one thread, shared<T> across tasks, a .clone(), or restructuring" },
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
  { id: "destructuring", action: "guided", title: "destructuring Fish can't take as written: computed keys known only at run time, a default on a whole destructured parameter, or nesting, defaults and rest in a loop head; name the parts, or destructure in the body" },
  { id: "localCaptures", action: "guided", title: "a class or enum declared inside a function that uses the function's variables: pass them to its constructor" },
  { id: "destructuringAssignment", action: "guided", title: "a destructuring assignment used as a value or as a for update: write it as a statement of its own" },
  { id: "defaults", action: "guided", title: "a default Fish can't take as written: before a required parameter, on a parameter that may be null, or neither typed nor a literal; move it last, use '?' and default in the body, or write the type" },
  { id: "declarators", action: "guided", title: "a let with neither a type nor a value: write its type, as in 'let x: string', since Fish doesn't work it out from later assignments" },
  { id: "tuples", action: "unsupported", title: "a rest element before the end of a tuple type, or one beside optional elements" },
  { id: "spread", action: "guided", title: "rest parameters on arrow functions, and spread arguments: Fish takes rest parameters on declared functions and methods, and spreads an array argument only into a rest parameter, or a tuple held in a variable into any parameters" },
  { id: "collections", action: "unsupported", title: "WeakMap and WeakSet", feature: "WeakMap and WeakSet over Rc" },
  { id: "readonlyCollections", action: "unsupported", title: "ReadonlyMap and ReadonlySet (more utility types)", feature: "More utility types" },
  { id: "forAwaitArrays", action: "guided", title: "for await over an array of promises: Fish loops with for await over an async generator or a Channel, so await Promise.all(...) and loop over its result with for...of" },
  { id: "dynamicRegex", action: "reject", title: "regexes built while the program runs: Fish compiles every regex while compiling" },
  { id: "regexStrings", action: "guided", title: "match, matchAll and search given a string, and next() on matchAll: Fish takes a regex literal there, and matchAll gives an array" },
  { id: "regexState", action: "guided", title: "exec or test on a g or y regex, and lastIndex: a Fish regex keeps no state; use matchAll, or drop the flag" },
  { id: "forIn", action: "unsupported", title: "for...in loops over an object's keys", feature: "for...in" },
  { id: "decorators", action: "unsupported", title: "decorators, which Fish runs as macros, so a framework's decorators need a Fish macro of the same name" },
  { id: "namespaces", action: "unsupported", title: "namespaces and module declarations", feature: "Namespaces" },
  { id: "genericFunctionsHeld", action: "unsupported", title: "generic function types held in class fields, arrays or unions, which would box a family of functions" },
  { id: "classForms", action: "unsupported", title: "abstract fields, and '#x in obj' checks" },
  { id: "tagged", action: "guided", title: "tagged templates: a Fish tag takes its strings as 'comptime strings: TemplateStringsArray', so its code over them runs while compiling" },
  { id: "process", action: "unsupported", title: "process members besides argv, env, exit, platform, arch, execPath, cwd, chdir, on, once, kill, pid, stdout.write and stderr.write, and writes to process.env" },
  { id: "bunGlobals", action: "unsupported", title: "Bun members besides file, stdin, write, env, argv, sleep, sleepSync, which, spawn, spawnSync, serve and version" },
  { id: "importMeta", action: "unsupported", title: "import.meta besides its path, file, dir, url, main, dirname and filename members" },
  { id: "timerForms", action: "unsupported", title: "setImmediate, unref on a timer, and more than two arguments passed on to a timer's function" },
  { id: "console", action: "unsupported", title: "console methods besides log, error and warn", feature: "The rest of console" },
  { id: "json", action: "unsupported", title: "JSON.parse revivers, and JSON.stringify's replacer and indent arguments" },
  { id: "nestedFunctions", action: "unsupported", title: "generic or generator function declarations inside a function" },
];

// A rejected construct has no Fish equivalent and needs a redesign; a guided one, a rewrite.
function weight(a: Action): usize {
  if (a === "reject") return 10;
  if (a === "guided") return 3;
  return 0;
}

function bump(counts: Mut<Record<Action, usize>>, a: Action, by: usize) {
  switch (a) {
    case "reject": counts.reject += by; break;
    case "unsupported": counts.unsupported += by; break;
    case "guided": counts.guided += by; break;
    case "auto": counts.auto += by; break;
  }
}

// Score per 1000 lines at the top of each grade, set so published TypeScript packages spread
// across them: a careful codebase scores near 5, a library leaning on `any` near 40, a DOM
// implementation patching prototypes near 90.
const GRADES: [string, f64][] = [["A", 5], ["B", 15], ["C", 40], ["D", 100]];

// Every TypeScript file under `dir`, skipping dependencies, hidden directories, declarations and
// symbolic links (which may loop, or count a file twice); an entry that can't be read is skipped.
// The TypeScript files under `dir`, outside node_modules and dot-directories; with `fish`, its Fish
// files too, as the compiler's own source is read when a ranking is compared with it.
export function sources(dir: string, fish: boolean = false): string[] {
  let found: string[] = [];
  let names: string[] = [];
  try {
    names = readdirSync(dir);
  } catch (_e) {
    return found;
  }
  for (const name of names) {
    const path = join(dir, name);
    let directory = false;
    let file = false;
    try {
      const entry = lstatSync(path);
      directory = entry.isDirectory();
      file = entry.isFile();
    } catch (_e) {
      continue;
    }
    if (directory) {
      if (name !== "node_modules" && !name.startsWith(".")) for (const p of sources(path, fish)) found.push(p);
    } else if (file && /\.(ts|tsx|mts)$/.test(name) && !/\.d\.(ts|mts)$/.test(name)) found.push(path);
    else if (fish && file && name.endsWith(".fsh")) found.push(path);
  }
  return found;
}

// One file as surveyed: its non-blank lines, whether it could be read, and what it shows, in
// source order.
export type FileScan = { file: string; lines: usize; read: boolean; findings: [string, Example][] };

export function scanFiles(dir: string, fish: boolean = false): FileScan[] {
  let paths = sources(dir, fish);
  paths.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  let scans: FileScan[] = [];
  for (const path of paths) scans.push(scanFile(path, relative(dir, path)));
  return scans;
}

// What a failed read or parse says, or `otherwise` for what isn't an Error, as Fish's IoError isn't.
function messageOf(e: Ref<unknown>, otherwise: string): string {
  return e instanceof Error ? e.message : otherwise;
}

function example(file: string, src: string, offset: usize, module: string | undefined): Example {
  const { line, col } = locate(src, offset);
  let e: Example = { file, line, col };
  if (module !== undefined) e.module = module;
  return e;
}

function scanFile(path: string, file: string): FileScan {
  let src = "";
  try {
    src = readFileSync(path, "utf8").replace(/^﻿/, "");
  } catch (e) {
    return { file, lines: 0, read: false, findings: [["unreadable", { file, line: 1, col: 1, note: messageOf(e, "it can't be opened") }]] };
  }
  let lines: usize = 0;
  for (const l of src.split("\n")) if (l.trim() !== "") lines++;
  let findings: [string, Example][] = [];
  try {
    let ids: { last: usize } = { last: 0 };
    let program = parse(src, ids);
    let found = scan(path, program);
    while (found.length > 0) {
      const f = found.shift()!;
      findings.push([f.id, example(file, src, f.at, f.module)]);
    }
    // The reject and guided rules, A1, A3 and A8 come from the migration lint's detector. Its A2, A4 and A9
    // find only what they can fix, so the survey counts those its own wider way.
    for (const hit of surveyHits(program)) findings.push([hit.rule, example(file, src, hit.start, undefined)]);
    for (const offset of captures(program, ids.last)) findings.push(["localCaptures", example(file, src, offset, undefined)]);
  } catch (e) {
    // A file the parser can't read, or too deeply nested to walk, adds none of its findings or
    // lines, so it can't flatter the score.
    let line: usize = 1;
    let col: usize = 1;
    if (e instanceof CompileError) {
      const at = locate(src, e.start);
      line = at.line;
      col = at.col;
    }
    const note = e instanceof Error && e.name === "RangeError" ? "too deeply nested to read" : messageOf(e, "it can't be read");
    const id = path.endsWith(".tsx") && /<[A-Za-z>]/.test(src) ? "jsx" : "parse";
    return { file, lines, read: false, findings: [[id, { file, line, col, note }]] };
  }
  findings.sort((a, b) => {
    const byLine = (a[1].line as i64) - (b[1].line as i64);
    return byLine !== 0 ? byLine : (a[1].col as i64) - (b[1].col as i64);
  });
  return { file, lines, read: true, findings };
}

// The planned Fish features a file waits on, by title; a file the parser can't read waits on
// the parser.
export function featuresOf(f: Ref<FileScan>): string[] {
  let features = new Set<string>();
  for (const [id, example] of f.findings) {
    const feature = featureOf(id, example.module);
    if (feature !== undefined) features.add(feature);
  }
  let sorted = [...features];
  sorted.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return sorted;
}

// The feature a finding waits on: its rule's, or for a Node built-in, the planned feature that
// replaces that module, none when std already does, and "Node built-ins" when nothing will. An
// import of a Fish std module is found only for a member std lacks, which nothing plans.
export function featureOf(id: string, module?: string): string | undefined {
  if (id !== "nodeBuiltins" || module === undefined) return FEATURES.get(id);
  const equivalent = BUILTINS.get(module);
  if (equivalent === undefined) return FEATURES.get(id);
  if (!equivalent.planned && stdModule(module) !== undefined) return FEATURES.get(id);
  return equivalent.planned ? equivalent.name : undefined;
}

// What replaces each Node built-in in Fish: std, only where std covers what the module is used
// for, or a planned feature by its title. A subpath is looked up before its module.
type Equivalent = { name: string; planned: boolean };
const STD = (name: string): Equivalent => ({ name, planned: false });
const PLANNED = (title: string): Equivalent => ({ name: title, planned: true });
const BUILTINS = new Map<string, Equivalent>([
  ["net", STD("TcpListener, TcpStream, UnixListener and UnixStream")], ["worker_threads", STD("spawn and spawnBlocking")], ["string_decoder", STD("TextDecoder, with fatal")],
  ["timers/promises", STD("sleep")],
  // `fetch` and `serve` are the client and the server, but importing `http` itself needs its shim.
  ["http", PLANNED("node:http server shim")], ["console", PLANNED("The rest of console")],
  ["test", PLANNED("Jest-style test API")], ["sqlite", PLANNED("SQLite binding")],
  ["fs/promises", STD("fs/promises, for readFile, writeFile, open, access, utimes, lutimes, chmod, symlink, link, readlink, realpath and watch")], ["fs", STD("fs, for readFileSync, writeFileSync, existsSync, statSync and lstatSync with throwIfNoEntry, readdirSync with withFileTypes, realpathSync, mkdtempSync, rmSync, mkdirSync, renameSync, copyFileSync, unlinkSync, accessSync, utimesSync, lutimesSync, chmodSync, symlinkSync, linkSync, readlinkSync, openSync, readSync, writeSync, closeSync, fstatSync, ftruncateSync, fchmodSync, fsyncSync and constants with the open flags")], ["util", STD("util, for format, inspect, isDeepStrictEqual and parseArgs")], ["path", STD("path, for join, dirname, basename, extname, resolve, relative, normalize, isAbsolute, parse and format")], ["crypto", STD("crypto, for createHash, createHmac, randomBytes, randomUUID, getRandomValues and hash")],
  // fetch and serve speak HTTPS, but importing `https` needs the same shim as `http`, and `tls`
  // Node's own connect and its sockets with events.
  ["https", PLANNED("node:http server shim")], ["tls", PLANNED("node:tls")], ["http2", PLANNED("HTTP/2")], ["child_process", STD("child_process, for spawnSync, execFileSync and execSync")],
  ["events", PLANNED("EventTarget and EventEmitter")], ["url", STD("url, for fileURLToPath and pathToFileURL")], ["querystring", PLANNED("node:querystring")],
  ["os", STD("os, for hostname, tmpdir, homedir, platform and availableParallelism")], ["zlib", STD("zlib, for gzipSync, gunzipSync, deflateSync, inflateSync, deflateRawSync, inflateRawSync and unzipSync, and those seven as promises")], ["stream", STD("ReadableStream and WritableStream, as globals")],
  ["buffer", STD("Buffer, for from, alloc, allocUnsafe, concat, byteLength, compare, equals, toString, indexOf and includes of text, and the read methods")], ["assert", STD("assert, for the default export and ok")], ["timers", STD("the setTimeout and setInterval globals")],
  // `dns` isn't here: connect and fetch look host names up, but no plan item gives `dns.lookup`.
  // `buffer` is the Buffer global; its methods std lacks, such as `writeUInt32BE`, are found by name.
  // `crypto` is more than std's random functions and one-shot hashes: an import of only those is portable.
  ["readline", STD("the readLine global and the stdin module, for lines, text and bytes")], ["dgram", STD("UdpSocket")],
  ["process", STD("process, for argv, env, exit, platform, arch, execPath, cwd, chdir, pid, on, once, kill, signals, stdout.write and stderr.write")], ["perf_hooks", STD("the global performance, for now()")],
  ["async_hooks", PLANNED("Task-local context")], ["tty", PLANNED("Terminal detection and styled text")],
]);
const FEATURES = features();

function features(): Map<string, string> {
  let m = new Map<string, string>();
  for (const r of RULES) if (r.feature !== undefined) m.set(r.id, r.feature);
  return m;
}

type Found = { count: usize; examples: Example[] };

export function survey(dir: string): Report {
  const scans = scanFiles(dir);
  let found = new Map<string, Found>();
  let lines: usize = 0;
  let unread: { files: usize; lines: usize } = { files: 0, lines: 0 };
  for (const f of scans) {
    if (f.read) lines += f.lines;
    else {
      unread.files++;
      unread.lines += f.lines;
    }
    for (const [id, example] of f.findings) add(found, id, example);
  }
  let all: RuleCount[] = [];
  for (const r of RULES) {
    const had = found.get(r.id);
    const count = had !== undefined ? had.count : 0;
    const examples: Example[] = had !== undefined ? had.examples : [];
    const feature = r.feature;
    if (feature !== undefined) all.push({ id: r.id, action: r.action, title: r.title, feature, count, examples });
    else all.push({ id: r.id, action: r.action, title: r.title, count, examples });
  }
  const deps = dependencies(dir);
  const builtins = builtinsOf(scans);
  let result = report(scans.length, lines, unread, all);
  if (deps !== undefined) result.dependencies = deps;
  if (builtins.length > 0) result.builtins = builtins;
  return result;
}

// Each Node built-in imported, with how many files import it and what replaces it.
function builtinsOf(scans: Ref<FileScan[]>): Builtin[] {
  let files = new Map<string, Set<string>>();
  for (const f of scans) {
    for (const [id, example] of f.findings) {
      const module = example.module;
      if (id !== "nodeBuiltins" || module === undefined) continue;
      const had = files.get(module);
      let set = had !== undefined ? had : new Set<string>();
      set.add(f.file);
      files.set(module, set);
    }
  }
  let out: Builtin[] = [];
  for (const [module, set] of files) {
    let b: Builtin = { module, files: set.size };
    const equivalent = BUILTINS.get(module);
    if (equivalent !== undefined) b.equivalent = equivalent;
    out.push(b);
  }
  out.sort((a, b) => (a.files !== b.files ? (b.files as i64) - (a.files as i64) : a.module < b.module ? -1 : 1));
  return out;
}

// A report from its rules' counts: the counts by action, the score and the grade, so a saved
// report read back is scored by the same rules as a fresh one.
function report(files: usize, lines: usize, unread: { files: usize; lines: usize }, all: RuleCount[]): Report {
  let counts: Record<Action, usize> = { reject: 0, unsupported: 0, guided: 0, auto: 0 };
  let weighted: usize = 0;
  for (const r of all) {
    bump(counts, r.action, r.count);
    weighted += weight(r.action) * r.count;
  }
  // Per 1000 lines, and never per fewer, so one finding in a small script doesn't swing the grade.
  const score = Math.round(((weighted * 1000) as f64) / Math.max(lines as f64, 1000) * 10) / 10;
  const graded = lines > 0 && lines >= unread.lines;
  let rules: RuleCount[] = [];
  let waiting: RuleCount[] = [];
  while (all.length > 0) {
    const r = all.shift()!;
    if (r.action === "unsupported") waiting.push(r);
    else rules.push(r);
  }
  rules.sort(byCount);
  waiting.sort(byCount);
  return { files, lines, unread, score, grade: graded ? grade(score) : null, counts, rules, waiting };
}

function byCount(a: Ref<RuleCount>, b: Ref<RuleCount>): i64 {
  const byWeight = (weight(b.action) as i64) - (weight(a.action) as i64);
  return byWeight !== 0 ? byWeight : (b.count as i64) - (a.count as i64);
}

// Records a finding, keeping three examples.
function add(found: Mut<Map<string, Found>>, id: string, example: Ref<Example>) {
  const had = found.get(id);
  let entry: Found = had !== undefined ? had : { count: 0, examples: [] };
  entry.count++;
  if (entry.examples.length < 3) entry.examples.push(copied(example));
  found.set(id, entry);
}

function copied(e: Ref<Example>): Example {
  let c: Example = { file: e.file, line: e.line, col: e.col };
  if (e.note !== undefined) c.note = e.note;
  if (e.module !== undefined) c.module = e.module;
  return c;
}

export function grade(score: f64): string {
  for (const [name, top] of GRADES) if (score <= top) return name;
  return "F";
}

// Where each local class or enum using its function's variables starts. Hoisting rewrites the
// tree it reads, so it runs after every other reading of it, numbering the nodes it makes after
// the parser's last id; a file it can't hoist adds none.
function captures(program: Mut<Stmt[]>, last: usize): usize[] {
  try {
    let env = { names: { local: new Set<string>(), madeUp: new Map<string, string>() }, ids: { last } };
    return hoistLocals(env, program, true).captured;
  } catch (_e) {
    return [];
  }
}

// A rule a file shows, at an offset, with the Node built-in a `nodeBuiltins` finding brings in.
type Hit = { id: string; at: usize; module: string | undefined };

// A std module imported whole, by its local name, with what it exports: a member it doesn't
// have still waits, though the import is portable.
type Whole = { module: string; has: Set<string>; names: Map<string, string> };

// A spread argument, which fills only a rest parameter unless it spreads a name the file
// declares as a tuple, judged once its tuples are known.
type Spread = { at: usize; name: string | undefined };
// What a `for await` loops over, judged once the file's arrays are known: whether it is an array
// whatever the file declares, and the name it reads.
type Loop = { at: usize; array: boolean; name: string | undefined };

// A walk over one file at `path`, whose packages its imports name. A node is judged before the
// nodes it holds, so the node ids a holder marks are all marked when those nodes are judged:
// `envKeys` holds the `process.env` nodes read by key or whole through Object.entries and
// Object.keys, which Fish takes (any other use of it, it doesn't), `statements` the destructuring
// assignments written as statements of their own, `metaRead` the `import.meta` nodes whose
// member is read, `heads` the declarations heading a loop, and `writes` the `process.stdout` and
// `process.stderr` nodes whose `write` is read.
type Scan = {
  path: string; hits: Hit[]; ownBun: boolean; wholes: Map<string, Whole>; exports: Map<string, Set<string>>;
  envKeys: Set<usize>; statements: Set<usize>; metaRead: Set<usize>; heads: Set<usize>; writes: Set<usize>;
  spreads: Spread[]; loops: Loop[]; tuples: Set<string>; arrays: Set<string>;
};

function note(s: Mut<Scan>, id: string, at: usize) {
  s.hits.push({ id, at, module: undefined });
}

// The rules a file's tree shows, each at its offset, in the order the walk meets them.
function scan(path: string, program: Ref<Stmt[]>): Hit[] {
  let s: Scan = {
    path, hits: [], ownBun: false, wholes: new Map<string, Whole>(), exports: new Map<string, Set<string>>(),
    envKeys: new Set<usize>(), statements: new Set<usize>(), metaRead: new Set<usize>(), heads: new Set<usize>(), writes: new Set<usize>(),
    spreads: [], loops: [], tuples: new Set<string>(), arrays: new Set<string>(),
  };
  for (const st of program) {
    if (st.kind === "let" && st.keyword === "let") note(s, "A4", st.start);
    else if (st.kind === "export" && st.body.kind === "let" && st.body.keyword === "let") note(s, "A4", st.body.start);
  }
  for (const st of program) {
    if (st.kind !== "import") continue;
    const name = stdModule(st.module);
    const whole = st.namespace !== undefined ? st.namespace : st.default;
    if (name === undefined || whole === undefined) continue;
    const has = stdExports(s, name);
    s.wholes.set(whole, { module: builtinModule(st.module), has, names: nameModules(name) });
  }
  for (const st of program) if (declaresBun(st)) s.ownBun = true;
  visit({ of: "stmts", node: program }, s, 0, false);
  let late: Hit[] = [];
  for (const loop of s.loops) if (loop.array || (loop.name !== undefined && s.arrays.has(loop.name))) late.push({ id: "forAwaitArrays", at: loop.at, module: undefined });
  for (const a of s.spreads) if (a.name === undefined || !s.tuples.has(a.name)) late.push({ id: "spread", at: a.at, module: undefined });
  while (late.length > 0) s.hits.push(late.shift()!);
  return s.hits;
}

// Walks a tree, judging each node before those it holds. `depth` counts the functions a node
// sits in, and `ambient` marks declarations under `declare`.
function visit(n: AnyNode, s: Mut<Scan>, depth: usize, ambient: boolean): void {
  if (n.of !== "stmts") judge(reborrowNode(n), s, depth, ambient);
  const inner = deepens(reborrowNode(n)) ? depth + 1 : depth;
  const under = ambient || (n.of === "stmt" && n.node.kind === "declare");
  forEachChild(n, (c) => visit(c, s, inner, under));
}

// Whether a node is a function whose body its descendants sit in.
function deepens(n: AnyNode): boolean {
  if (n.of === "expr") return n.node.kind === "function" || n.node.kind === "arrow";
  if (n.of === "stmt") return n.node.kind === "function";
  if (n.of === "func") return true;
  if (n.of === "objectProp") return n.node.kind === "method" || n.node.kind === "get" || n.node.kind === "set";
  if (n.of === "classMember") return n.node.kind === "method" || n.node.kind === "constructor" || n.node.kind === "get" || n.node.kind === "set";
  return false;
}

function judge(n: AnyNode, s: Mut<Scan>, depth: usize, ambient: boolean) {
  switch (n.of) {
    case "expr":
      exprRules(n.node, s);
      break;
    case "stmt":
      stmtRules(n.node, s, depth, ambient);
      break;
    case "func":
      decorators(s, n.node.decorators);
      if (depth > 0 && (n.node.typeParams.length > 0 || n.node.generator)) note(s, "nestedFunctions", n.node.start);
      params(s, n.node.params, false);
      break;
    case "typeNode":
      typeRules(n.node, s);
      break;
    case "typeMember":
      typeMemberRules(n.node, s);
      break;
    case "objectProp":
      objectPropRules(n.node, s);
      break;
    case "classMember":
      classMemberRules(n.node, s);
      break;
    case "param":
      decorators(s, n.node.decorators);
      break;
    case "pattern":
      if (n.node.kind === "expr" && n.node.expr.kind === "destructure") s.statements.add(n.node.expr.id);
      break;
    default:
      break;
  }
}

function decorators(s: Mut<Scan>, list: Ref<Expr[] | undefined>) {
  if (list !== undefined) for (const d of list) note(s, "decorators", d.start);
}

// Whether a node is the identifier `name`.
function named(e: Ref<Expr>, name: string): boolean {
  return e.kind === "ident" && e.name === name;
}

function identName(e: Ref<Expr>): string | undefined {
  return e.kind === "ident" ? e.name : undefined;
}

// `process.env.X` or `process.env[k]`, which Fish reads but doesn't yet write.
function envEntry(e: Ref<Expr>): boolean {
  if (e.kind !== "member" && e.kind !== "index") return false;
  const o: Ref<Expr> = e.object;
  return o.kind === "member" && named(o.object, "process") && o.name === "env";
}

function processEnv(e: Ref<Expr>): boolean {
  return e.kind === "member" && named(e.object, "process") && e.name === "env";
}

const literalString = (e: Ref<Expr>): boolean => e.kind === "string" || (e.kind === "template" && e.exprs.length === 0);
// The members of Bun's global that std's Bun module has.
const BUN_MEMBERS = ["file", "stdin", "write", "env", "argv", "sleep", "sleepSync", "which", "spawn", "spawnSync", "serve", "version"];
const PROCESS_MEMBERS = ["argv", "env", "exit", "platform", "arch", "execPath", "cwd", "chdir", "on", "once", "kill", "pid"];
// The process members Fish takes only for their write, as in `process.stdout.write(text)`.
const STREAMS = ["stdout", "stderr"];
// The array methods that give a new array, as in `for await (const r of urls.map(fetch))`.
const ARRAY_MAKERS = new Set(["map", "filter", "slice", "concat", "flat", "flatMap", "toSorted", "toReversed", "toSpliced", "with"]);

// Whether an expression is an array whatever names the file declares: a literal, an array
// method's result or `Array.from`. Read from syntax alone, so an array reached any other way is
// missed.
function arrayMade(e: Ref<Expr>): boolean {
  if (e.kind === "array") return true;
  if (e.kind !== "call" || e.callee.kind !== "member") return false;
  return ARRAY_MAKERS.has(e.callee.name) || (named(e.callee.object, "Array") && e.callee.name === "from");
}

// The rules an expression shows by itself, each with where to point: a call's own method name
// rather than the start of a long chain.
function exprRules(e: Ref<Expr>, s: Mut<Scan>) {
  if (e.kind === "call") callRules(e, s);
  else if (e.kind === "new") {
    const args: Ref<Expr[] | undefined> = e.args;
    if (args !== undefined) for (const a of args) if (a.kind === "spread") s.spreads.push({ at: a.start, name: identName(a.value) });
    if (named(e.callee, "WeakMap") || named(e.callee, "WeakSet")) note(s, "collections", e.start);
    if (named(e.callee, "RegExp") && args !== undefined && !args.every(literalString)) note(s, "dynamicRegex", e.start);
  } else if (e.kind === "member") memberRules(e, s);
  else if (e.kind === "meta") {
    if (e.name === "import.meta" && !s.metaRead.has(e.id)) note(s, "importMeta", e.start);
  } else if (e.kind === "unary") {
    if (e.op === "delete" && envEntry(e.operand)) note(s, "process", e.start);
  } else if (e.kind === "assign") {
    if (envEntry(e.target)) note(s, "process", e.start);
  } else if (e.kind === "update") {
    if (envEntry(e.operand)) note(s, "process", e.start);
  } else if (e.kind === "index") {
    const object: Ref<Expr> = e.object;
    if (envEntry(e) && !e.optional) s.envKeys.add(object.id);
    const index: Ref<Expr> = e.index;
    if (object.kind === "meta" && index.kind === "string" && IMPORT_META_MEMBERS.includes(index.value)) s.metaRead.add(object.id);
  } else if (e.kind === "function") {
    note(s, "A9", e.start);
    params(s, e.params, false);
  } else if (e.kind === "arrow") params(s, e.params, true);
  // A destructuring assignment ports as a statement of its own.
  else if (e.kind === "destructure") {
    if (!s.statements.has(e.id)) note(s, "destructuringAssignment", e.start);
  } else if (e.kind === "tagged") {
    // `String.raw` is a tag Fish has.
    const tag: Ref<Expr> = e.tag;
    if (!(tag.kind === "member" && tag.name === "raw" && named(tag.object, "String"))) note(s, "tagged", e.start);
  } else if (e.kind === "privateName") note(s, "classForms", e.start);
  else if (e.kind === "import") {
    // A dynamic `import("x")` names its module as its first argument.
    let specifier: string | undefined = undefined;
    if (e.args.length > 0) {
      const first: Ref<Expr> = e.args[0]!;
      if (first.kind === "string") specifier = first.value;
    }
    moduleRule(s, e.start, { specifier, form: true, namespaced: false, exportAll: false, std: true, names: [] });
  } else if (e.kind === "class") decorators(s, e.decorators);
}

function callRules(e: Ref<Extract<Expr, { kind: "call" }>>, s: Mut<Scan>) {
  const callee: Ref<Expr> = e.callee;
  for (const a of e.args) if (a.kind === "spread") s.spreads.push({ at: a.start, name: identName(a.value) });
  const at = callee.kind === "member" ? callee.end - (callee.name.length as usize) : e.start;
  if (named(callee, "setImmediate") || named(callee, "clearImmediate")) note(s, "timerForms", at);
  if ((named(callee, "setTimeout") || named(callee, "setInterval")) && e.args.length > 4) note(s, "timerForms", at);
  if (callee.kind !== "member") return;
  const name = callee.name;
  if (name === "unref") note(s, "timerForms", at);
  if (named(callee.object, "console") && name !== "log" && name !== "error" && name !== "warn") note(s, "console", at);
  // Fish's parse takes no reviver, and its stringify one value.
  if (named(callee.object, "JSON") && (name === "parse" || name === "stringify") && e.args.length > 1) note(s, "json", at);
  // Object.entries(process.env) and Object.keys(process.env) read the whole environment.
  if (named(callee.object, "Object") && (name === "entries" || name === "keys") && e.args.length > 0 && processEnv(e.args[0]!)) s.envKeys.add(e.args[0]!.id);
  // A regex literal ports; one built while the program runs can't.
  if (e.args.length > 0 && (e.args[0]!.kind === "string" || e.args[0]!.kind === "template") && (name === "match" || name === "matchAll" || name === "search")) note(s, "regexStrings", at);
  const object: Ref<Expr> = callee.object;
  if (name === "next" && object.kind === "call" && object.callee.kind === "member" && object.callee.name === "matchAll") note(s, "regexStrings", at);
  if ((name === "exec" || name === "test") && object.kind === "regex" && /[gy]/.test(object.flags)) note(s, "regexState", at);
}

function memberRules(e: Ref<Extract<Expr, { kind: "member" }>>, s: Mut<Scan>) {
  const object: Ref<Expr> = e.object;
  if (e.name === "write" && object.kind === "member" && named(object.object, "process") && STREAMS.includes(object.name)) s.writes.add(object.id);
  if (named(object, "process") && !PROCESS_MEMBERS.includes(e.name) && !(STREAMS.includes(e.name) && s.writes.has(e.id))) note(s, "process", e.start);
  if (named(object, "process") && e.name === "env" && !s.envKeys.has(e.id)) note(s, "process", e.start);
  if (!s.ownBun && named(object, "Bun") && !BUN_MEMBERS.includes(e.name)) note(s, "bunGlobals", e.start);
  if (envEntry(e) && !e.optional) s.envKeys.add(object.id);
  if (object.kind === "meta" && IMPORT_META_MEMBERS.includes(e.name)) s.metaRead.add(object.id);
  if (e.name === "lastIndex") note(s, "regexState", e.start);
  // A Buffer member std lacks: a static on the global, or a method only Buffer has.
  if ((BUFFER_REFUSED.has(e.name) && !s.writes.has(object.id)) || (named(object, "Buffer") && !BUFFER_STATICS.includes(e.name) && e.name !== "BYTES_PER_ELEMENT")) s.hits.push({ id: "nodeBuiltins", at: e.start, module: "buffer" });
  if (object.kind !== "ident") return;
  const whole = s.wholes.get(object.name);
  if (whole === undefined || whole.has.has(e.name)) return;
  const filed = whole.names.get(e.name);
  s.hits.push({ id: "nodeBuiltins", at: e.start, module: filed !== undefined ? filed : whole.module });
}

function stmtRules(st: Ref<Stmt>, s: Mut<Scan>, depth: usize, ambient: boolean) {
  switch (st.kind) {
    case "let":
      for (const d of st.declarations) {
        const init: Ref<Expr | undefined> = d.init;
        // `const { file } = import.meta` reads its members.
        if (d.target.kind === "object" && init !== undefined && init.kind === "meta") s.metaRead.add(init.id);
        const name = d.target.kind === "ident" ? d.target.name : undefined;
        if (name === undefined) continue;
        const type: Ref<TypeNode | undefined> = d.type;
        if ((type !== undefined && arrayType(type)) || (init !== undefined && arrayMade(init))) s.arrays.add(name);
        if (type !== undefined && tupleType(type)) s.tuples.add(name);
      }
      const head = s.heads.has(st.id);
      letRules(st, s, ambient, head);
      break;
    case "forOf":
      s.heads.add(st.left.id);
      if (st.await) s.loops.push({ at: st.right.start, array: arrayMade(st.right), name: identName(st.right) });
      break;
    case "forIn":
      s.heads.add(st.left.id);
      note(s, "forIn", st.start);
      break;
    case "namespace":
      note(s, "namespaces", st.start);
      break;
    case "expr":
      if (st.expr.kind === "destructure") s.statements.add(st.expr.id);
      break;
    case "function":
      decorators(s, st.decorators);
      // Nested functions work, except generic and generator ones.
      if (depth > 0 && (st.typeParams.length > 0 || st.generator)) note(s, "nestedFunctions", st.start);
      params(s, st.params, false);
      break;
    case "class":
    case "enum":
    case "typeAlias":
    case "interface":
      decorators(s, st.decorators);
      break;
    case "import":
      moduleRule(s, st.start, { specifier: st.module, form: st.namespace !== undefined, namespaced: st.namespace !== undefined, exportAll: false, std: true, names: specifierNames(st.named) });
      break;
    case "importEquals":
      moduleRule(s, st.start, { specifier: st.require, form: true, namespaced: false, exportAll: false, std: false, names: [] });
      break;
    case "exportAll":
      moduleRule(s, st.start, { specifier: st.module, form: st.alias !== undefined, namespaced: false, exportAll: true, std: st.alias === undefined, names: [] });
      break;
    case "exportAsNamespace":
    case "exportAssign":
      moduleRule(s, st.start, { specifier: undefined, form: true, namespaced: false, exportAll: false, std: false, names: [] });
      break;
    case "exportNamed":
      moduleRule(s, st.start, { specifier: st.module, form: false, namespaced: false, exportAll: false, std: true, names: specifierNames(st.specifiers) });
      break;
    default:
      break;
  }
}

function specifierNames(list: Ref<Specifier[] | undefined>): string[] {
  let names: string[] = [];
  if (list !== undefined) for (const sp of list) names.push(sp.name);
  return names;
}

function typeRules(t: Ref<TypeNode>, s: Mut<Scan>) {
  switch (t.kind) {
    case "ref":
      if (t.name === "null" || t.name === "undefined") note(s, "A2", t.start);
      if (t.name === "WeakMap" || t.name === "WeakSet") note(s, "collections", t.start);
      if (t.name === "ReadonlyMap" || t.name === "ReadonlySet") note(s, "readonlyCollections", t.start);
      break;
    case "tuple":
      if (restMidway(t.elements)) note(s, "tuples", t.start);
      break;
    case "array":
      if (genericFunctionType(t.element)) note(s, "genericFunctionsHeld", t.start);
      break;
    case "union":
      if (t.types.some(genericFunctionType)) note(s, "genericFunctionsHeld", t.start);
      break;
    case "function":
      params(s, t.params, false);
      break;
    case "import":
      moduleRule(s, t.start, { specifier: t.module, form: false, namespaced: false, exportAll: false, std: true, names: [] });
      break;
    default:
      break;
  }
}

function typeMemberRules(m: Ref<TypeMember>, s: Mut<Scan>) {
  if (m.kind === "property") {
    if (m.optional) note(s, "A2", m.start);
  } else if (m.kind === "method") {
    if (m.optional) note(s, "A2", m.start);
    params(s, m.params, false);
  } else params(s, m.params, false);
}

function objectPropRules(p: Ref<ObjectProp>, s: Mut<Scan>) {
  if (p.kind === "method" || p.kind === "get" || p.kind === "set") params(s, p.params, false);
}

function classMemberRules(m: Ref<ClassMember>, s: Mut<Scan>) {
  decorators(s, m.decorators);
  if (m.kind === "field") {
    if (m.optional) note(s, "A2", m.start);
    if (m.modifiers.includes("abstract")) note(s, "classForms", m.start);
    const type: Ref<TypeNode | undefined> = m.type;
    if (type !== undefined && genericFunctionType(type)) note(s, "genericFunctionsHeld", m.start);
  } else if (m.kind === "method") {
    if (m.optional) note(s, "A2", m.start);
    params(s, m.params, false);
  } else if (m.kind !== "staticBlock") params(s, m.params, false);
}

// Whether a tuple's first rest element is before its end, or beside optional elements.
function restMidway(elements: Ref<TupleElement[]>): boolean {
  for (let i: usize = 0; i < elements.length; i++) if (elements[i]!.rest) return i < elements.length - 1 || elements.some((e) => e.optional);
  return false;
}

// An array type, or a tuple one, which is an array too.
function arrayType(t: Ref<TypeNode>): boolean {
  return t.kind === "array" || t.kind === "tuple" || (t.kind === "ref" && (t.name === "Array" || t.name === "ReadonlyArray"));
}

// A tuple type, readonly or not.
function tupleType(t: Ref<TypeNode>): boolean {
  return t.kind === "tuple" || (t.kind === "operator" && t.op === "readonly" && t.type.kind === "tuple");
}

// A generic function type, as `<T>(x: T) => T`.
function genericFunctionType(t: Ref<TypeNode>): boolean {
  return t.kind === "function" && t.typeParams.length > 0;
}

// Whether Fish takes a parameter's default as written: trailing, on a type without null, and
// typed or a literal that says its type.
function takesDefault(p: Ref<Param>, d: Ref<Expr>, list: Ref<Param[]>, after: usize): boolean {
  if (p.modifiers.length > 0) return false;
  for (let i = after; i < list.length; i++) if (list[i]!.default === undefined && !list[i]!.optional && !list[i]!.rest) return false;
  const type: Ref<TypeNode | undefined> = p.type;
  if (type === undefined) return literalDefault(d);
  return !nullable(type) || d.kind === "null" || (d.kind === "ident" && d.name === "undefined");
}

// A literal that says its type.
function literalDefault(d: Ref<Expr>): boolean {
  if (d.kind === "int" || d.kind === "float" || d.kind === "string" || d.kind === "bool") return true;
  if (d.kind === "template") return d.exprs.length === 0;
  return d.kind === "unary" && d.op === "-" && (d.operand.kind === "int" || d.operand.kind === "float");
}

function nullable(t: Ref<TypeNode>): boolean {
  if (t.kind === "ref") return t.name === "null" || t.name === "undefined";
  return t.kind === "union" && t.types.some(nullable);
}

// The rules a parameter list shows, and the names it gives arrays and tuples.
function params(s: Mut<Scan>, list: Ref<Param[]>, arrow: boolean) {
  for (let i: usize = 0; i < list.length; i++) {
    const p: Ref<Param> = list[i]!;
    const name = p.pattern.kind === "ident" ? p.pattern.name : undefined;
    const type: Ref<TypeNode | undefined> = p.type;
    if (name !== undefined && type !== undefined && arrayType(type)) s.arrays.add(name);
    if (name !== undefined && type !== undefined && tupleType(type)) s.tuples.add(name);
    const d: Ref<Expr | undefined> = p.default;
    if (d !== undefined && !takesDefault(p, d, list, i + 1)) note(s, "defaults", d.start);
    if (p.rest && arrow) note(s, "spread", p.start);
    if (p.pattern.kind !== "ident" && (d !== undefined || !fishPattern(p.pattern))) note(s, "destructuring", p.pattern.start);
    if (p.optional) note(s, "A2", p.start);
  }
}

// A pattern's key Fish takes: a name, or a computed key that may be known while compiling, as a
// literal, a template, or a name or member holding one; a `Symbol` names no field.
function patternKey(k: Ref<PropertyName>): boolean {
  if (typeof k === "string") return true;
  if (k.kind === "member") return !named(k.object, "Symbol");
  return k.kind === "string" || k.kind === "int" || k.kind === "float" || k.kind === "template" || k.kind === "ident";
}

// A pattern of names, holes and renames only, with no defaults, rest or nesting.
function plainPattern(p: Ref<Pattern>): boolean {
  if (p.kind === "array") return p.rest === undefined && p.elements.every((x) => x === undefined || x.kind === "ident");
  return p.kind === "object" && p.rest === undefined && p.props.every((q) => patternKey(q.key) && q.value.kind === "ident");
}

// A pattern Fish destructures in a declaration or a parameter: names, renames, defaults, holes,
// nesting and rest, with keys known while compiling.
function fishPattern(p: Ref<Pattern>): boolean {
  switch (p.kind) {
    case "ident":
      return true;
    case "default":
      return fishPattern(p.target);
    case "array": {
      for (const x of p.elements) if (x !== undefined && !fishPattern(x)) return false;
      const rest: Ref<Pattern | undefined> = p.rest;
      return rest === undefined || fishPattern(rest);
    }
    case "object": {
      for (const q of p.props) if (!patternKey(q.key) || !fishPattern(q.value)) return false;
      const rest: Ref<Pattern | undefined> = p.rest;
      return rest === undefined || fishPattern(rest);
    }
    default:
      return false;
  }
}

function letRules(st: Ref<Extract<Stmt, { kind: "let" }>>, s: Mut<Scan>, ambient: boolean, head: boolean) {
  // A declaration under `declare` describes a value defined elsewhere, so it has no initializer.
  if (!head && !ambient && st.declarations.some((d) => d.init === undefined && d.type === undefined)) note(s, "declarators", st.start);
  // A loop head's plain pattern, of names, holes and renames, is one Fish takes apart.
  if (st.declarations.some((d) => d.target.kind !== "ident" && !(head ? plainPattern(d.target) : fishPattern(d.target)))) note(s, "destructuring", st.start);
}

// Whether a top-level statement, seen through one `export` or `declare`, names something Bun, so
// the file's Bun isn't Bun's global. A local of that name inside a function isn't seen.
function declaresBun(st: Ref<Stmt>): boolean {
  if (st.kind === "export" || st.kind === "declare") return namesBun(st.body);
  return namesBun(st);
}

function namesBun(top: Ref<Stmt>): boolean {
  if (top.kind === "import") {
    const d = top.default;
    const ns = top.namespace;
    if ((d !== undefined && d === "Bun") || (ns !== undefined && ns === "Bun")) return true;
    const list: Ref<Specifier[] | undefined> = top.named;
    if (list !== undefined) for (const sp of list) if ((sp.alias !== undefined ? sp.alias : sp.name) === "Bun") return true;
    return false;
  }
  if (top.kind === "let") return top.declarations.some((d) => d.target.kind === "ident" && d.target.name === "Bun");
  if (top.kind === "function" || top.kind === "class" || top.kind === "enum" || top.kind === "namespace" || top.kind === "typeAlias" || top.kind === "interface" || top.kind === "importEquals" || top.kind === "exportAsNamespace") {
    const name = top.name;
    return name !== undefined && name === "Bun";
  }
  return false;
}

// An import, export or re-export as the module rules read it: its specifier, whether it is in a
// form Fish refuses, whether it is a namespace import or `export *`, whether Fish's std may answer
// it, and the names it imports or re-exports.
type Use = { specifier: string | undefined; form: boolean; namespaced: boolean; exportAll: boolean; std: boolean; names: string[] };

// What an import, export or re-export still needs, if anything: imports and exports between the
// program's files work, except in the forms Fish refuses; a path alias (`~/`, `@/` or `#`), a
// Node built-in, one of Bun's modules or an npm package is told apart by how its specifier is
// written. An npm package imported by name runs in the embedded JS engine, bundled while
// compiling, whole or by name; one imported dynamically, through 'import x = require()' or
// re-exported whole isn't.
function moduleRule(s: Mut<Scan>, at: usize, u: Ref<Use>) {
  const specifier = u.specifier;
  if (specifier === undefined) {
    if (u.form) note(s, "moduleForms", at);
    return;
  }
  if (/^[#~]|^@\//.test(specifier)) {
    note(s, "pathAliases", at);
    return;
  }
  if (specifier.startsWith(".")) {
    if (u.form) note(s, "moduleForms", at);
    return;
  }
  if (stdHas(s, u, specifier)) return;
  if (specifier.startsWith("node:") || NODE_MODULES.has(specifier.split("/")[0]!)) {
    const modules = waitingModules(s, u.names, specifier);
    for (const module of modules) s.hits.push({ id: "nodeBuiltins", at, module });
    return;
  }
  let rule: string | undefined = undefined;
  if (specifier === "bun" || specifier.startsWith("bun:")) rule = "bunModules";
  else if ((u.form && !u.namespaced) || u.exportAll) rule = "moduleForms";
  else if (untyped(s.path, specifier)) rule = "untypedPackages";
  if (rule !== undefined) note(s, rule, at);
}

// Whether a package is installed with no declarations, which Fish types it from; one not
// installed is the dependency report's to note.
function untyped(from: string, specifier: string): boolean {
  const found = findTypings(from, specifier);
  return "missing" in found && !found.missing.startsWith("can't find the package");
}

// Whether an import of a Node built-in is one Fish's std module answers: the module whole, or
// only names it has.
function stdHas(s: Mut<Scan>, u: Ref<Use>, specifier: string): boolean {
  const name = stdModule(specifier);
  if (name === undefined || !u.std) return false;
  const has = stdExports(s, name);
  return u.names.every((n) => has.has(n));
}

// Names of a std module's Node counterpart that wait on something besides the module's own
// equivalent, by the built-in each is filed under. randomInt has no plan item, so it is filed under its own name, which nothing replaces.
// Node's tls.connect takes options and gives a socket with events, where std's is awaited and
// gives a TcpStream, so it waits on Node's tls.
function nameModules(name: string): Map<string, string> {
  let m = new Map<string, string>();
  if (name === "crypto") {
    m.set("randomInt", "crypto.randomInt");
  } else if (name === "tls") m.set("connect", "tls");
  return m;
}

// What a std module exports that ports as written: its functions and its consts, less those
// filed elsewhere. Each module's are found once per file.
function stdExports(s: Mut<Scan>, name: string): Set<string> {
  const known = s.exports.get(name);
  if (known !== undefined) return known;
  const filed = nameModules(name);
  let has = new Set<string>();
  let ids: { last: usize } = { last: 0 };
  let program: Stmt[] = [];
  // Std's modules always parse; one that didn't would export nothing.
  try {
    program = parse(STD_MODULES[name]!, ids);
  } catch (_e) {
    program = [];
  }
  for (const st of program) {
    let names: string[] = [];
    if (st.kind === "exportNamed") for (const sp of st.specifiers) names.push(sp.alias !== undefined ? sp.alias : sp.name);
    if (st.kind === "export" && st.body.kind === "function") names.push(st.body.name);
    if (st.kind === "export" && st.body.kind === "let") for (const d of st.body.declarations) if (d.target.kind === "ident") names.push(d.target.name);
    for (const n of names) if (!filed.has(n)) has.add(n);
  }
  s.exports.set(name, has);
  return s.exports.get(name)!;
}

// The built-ins an import waits on, one for each that a name std lacks is filed under, so a file
// importing names that wait on different features waits on all of them.
function waitingModules(s: Mut<Scan>, names: Ref<string[]>, specifier: string): string[] {
  const name = stdModule(specifier);
  const module = builtinModule(specifier);
  if (name === undefined) return [module];
  const has = stdExports(s, name);
  const filed = nameModules(name);
  let modules: string[] = [];
  for (const n of names) {
    if (has.has(n)) continue;
    const other = filed.get(n);
    const m = other !== undefined ? other : module;
    if (!modules.includes(m)) modules.push(m);
  }
  return modules.length > 0 ? modules : [module];
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

function plural(n: usize, what: string): string {
  return `${n} ${what}${n === 1 ? "" : "s"}`;
}

function exampleText(e: Ref<Example>): string {
  const note = e.note;
  return `${e.file}:${e.line}:${e.col}${note !== undefined && note !== "" ? ` (${note})` : ""}`;
}

// The ten rules counting most, each with its first example.
function top(rules: Ref<RuleCount[]>): string[] {
  let lines: string[] = [];
  for (const x of rules) {
    if (x.count === 0) continue;
    if (lines.length === 10) break;
    lines.push(`  ${`${x.count}`.padStart(5)}  ${x.title}\n         e.g. ${exampleText(x.examples[0]!)}`);
  }
  return lines;
}

function builtinLine(b: Ref<Builtin>): string {
  const e: Ref<Equivalent | undefined> = b.equivalent;
  const by = e !== undefined ? (e.planned ? `planned: ${e.name}` : `in std: ${e.name}`) : "nothing planned";
  return `  ${b.module.padEnd(16)}${`${b.files}`.padStart(5)} file${b.files === 1 ? " " : "s"}  ${by}`;
}

// The report as text: what was read, the grade, the rewrites that cost most, then what Fish
// still needs before the project can be ported.
export function formatReport(r: Ref<Report>): string {
  const rewrites = top(r.rules.filter((x) => x.action !== "auto"));
  const waiting = top(r.waiting);
  const share = r.lines + r.unread.lines === 0 ? 0 : Math.round(((r.lines * 100) as f64) / ((r.lines + r.unread.lines) as f64));
  const grade = r.grade;
  const verdict = grade !== null ? `grade ${grade} (score ${r.score} per 1000 lines${share < 100 ? `, from ${share}% of the lines` : ""})`
    : `no grade: only ${share}% of the lines could be read`;
  let lines = [
    `fishc survey: ${plural(r.files, "file")}, ${plural(r.lines, "line")} read`,
    verdict,
    `  rejected: ${r.counts.reject}`,
    `  guided:   ${r.counts.guided}`,
    `  auto-fix: ${r.counts.auto}`,
  ];
  if (r.unread.files > 0) lines.push(`  unread:   ${plural(r.unread.files, "file")} (${plural(r.unread.lines, "line")}), not in the score`);
  const deps: Ref<Dependencies | undefined> = r.dependencies;
  if (deps !== undefined) for (const l of formatDependencies(deps)) lines.push(l);
  const builtins: Ref<Builtin[] | undefined> = r.builtins;
  if (builtins !== undefined) {
    lines.push("");
    lines.push("Node built-ins");
    for (const b of builtins) lines.push(builtinLine(b));
  }
  if (rewrites.length > 0) {
    lines.push("");
    lines.push("top rewrites");
    for (const l of rewrites) lines.push(l);
  }
  if (waiting.length > 0) {
    lines.push("");
    lines.push("waiting on Fish");
    for (const l of waiting) lines.push(l);
  }
  return lines.join("\n");
}

// A summary of one survey, as a comparison shows it then and now.
type Summary = { files: usize; lines: usize; unread: { files: usize; lines: usize }; score: f64; grade: string | null; counts: Record<Action, usize> };
type Moved = { id: string; action: Action; title: string; then: usize; now: usize; change: i64 };
export type Comparison = { then: Summary; now: Summary; rules: Moved[] };

// A saved report's fields as read back. Fish checks their types as it parses; TypeScript doesn't,
// so each is still checked where it is read.
type SavedRule = { id?: string; action?: string; title?: string; count?: usize };
type SavedReport = { files?: usize; lines?: usize; unread?: { files?: usize; lines?: usize }; rules?: SavedRule[]; waiting?: SavedRule[] };

const isObject = (v: Ref<unknown>): boolean => typeof v === "object" && v !== null && !Array.isArray(v);
const isNull = (v: Ref<unknown>): boolean => v === null;
const isCount = (n: Ref<unknown>): boolean => typeof n === "number" && Number.isInteger(n) && n >= 0;

function actionOf(a: string): Action | undefined {
  if (a === "reject") return "reject";
  if (a === "unsupported") return "unsupported";
  if (a === "guided") return "guided";
  if (a === "auto") return "auto";
  return undefined;
}

// A saved `fishc survey --json` report, checked enough to compare with, and scored again by
// today's rules, so a change in how scores are made isn't mistaken for a change in the project.
// A report saved before `waiting` or `unread` existed lists every rule in `rules`, and had none
// unread. Its rules keep only what a comparison reads.
/** @throws {Error} */
export function readReport(text: string): Report {
  try {
    JSON.parse(text);
  } catch (_e) {
    throw new Error("it isn't JSON");
  }
  const bad = "it isn't a 'fishc survey --json' report";
  if (!text.trimStart().startsWith("{")) throw new Error(bad);
  let o: SavedReport = {};
  try {
    o = JSON.parse<SavedReport>(text);
  } catch (_e) {
    throw new Error(bad);
  }
  const rules: Ref<SavedRule[] | undefined> = o.rules;
  const waiting: Ref<SavedRule[] | undefined> = o.waiting;
  if (rules === undefined || !Array.isArray(rules) || (waiting !== undefined && !Array.isArray(waiting))) throw new Error(bad);
  let all: RuleCount[] = [];
  let ids = new Set<string>();
  for (const x of rules) all.push(savedRule(x, ids, bad));
  if (waiting !== undefined) for (const x of waiting) all.push(savedRule(x, ids, bad));
  const u: Ref<{ files?: usize; lines?: usize } | undefined> = o.unread;
  let unread: { files: usize; lines: usize } = { files: 0, lines: 0 };
  if (u !== undefined && !isNull(u)) {
    if (!isObject(u) || !isCount(u.files) || !isCount(u.lines)) throw new Error(bad);
    unread = { files: u.files!, lines: u.lines! };
  }
  const files = o.files;
  const lines = o.lines;
  if (files === undefined || lines === undefined || !isCount(files) || !isCount(lines)) throw new Error(bad);
  return report(files, lines, unread, all);
}

/** @throws {Error} */
function savedRule(x: Ref<SavedRule>, ids: Mut<Set<string>>, bad: string): RuleCount {
  if (!isObject(x)) throw new Error(bad);
  const id = x.id;
  const title = x.title;
  const count = x.count;
  const action = x.action;
  if (typeof (id as unknown) !== "string" || typeof (title as unknown) !== "string" || !isCount(count)) throw new Error(bad);
  const known = typeof (action as unknown) === "string" ? actionOf(action!) : undefined;
  if (known === undefined || ids.has(id!)) throw new Error(bad);
  ids.add(id!);
  return { id: id!, action: known, title: title!, count: count!, examples: [] };
}

function summaryOf(r: Ref<Report>): Summary {
  return { files: r.files, lines: r.lines, unread: { files: r.unread.files, lines: r.unread.lines }, score: r.score, grade: r.grade, counts: { reject: r.counts.reject, unsupported: r.counts.unsupported, guided: r.counts.guided, auto: r.counts.auto } };
}

// Counts each of a report's rules into `moved`, then or now. The current report's action and
// title win, a rule's wording may have changed since.
function tally(moved: Mut<Map<string, Moved>>, list: Ref<RuleCount[]>, now: boolean) {
  for (const r of list) {
    const had = moved.get(r.id);
    let m: Moved = had !== undefined ? had : { id: r.id, action: r.action, title: r.title, then: 0, now: 0, change: 0 };
    if (now) {
      m.action = r.action;
      m.title = r.title;
      m.now = r.count;
    } else m.then = r.count;
    moved.set(r.id, m);
  }
}

// What changed between two surveys: the summaries, and every rule whose count moved, the
// furthest first, a rule missing from either counting as none there.
export function compare(then: Ref<Report>, now: Ref<Report>): Comparison {
  let moved = new Map<string, Moved>();
  tally(moved, then.rules, false);
  tally(moved, then.waiting, false);
  tally(moved, now.rules, true);
  tally(moved, now.waiting, true);
  let rules: Moved[] = [];
  for (const m of moved.values()) {
    const change = (m.now as i64) - (m.then as i64);
    if (change !== 0) rules.push({ id: m.id, action: m.action, title: m.title, then: m.then, now: m.now, change });
  }
  rules.sort((a, b) => (Math.abs(a.change) !== Math.abs(b.change) ? Math.abs(b.change) - Math.abs(a.change) : a.id < b.id ? -1 : 1));
  return { then: summaryOf(then), now: summaryOf(now), rules };
}

function delta(a: f64, b: f64): string {
  const d = Math.round((b - a) * 10) / 10;
  return d === 0 ? "" : ` (${d > 0 ? "+" : ""}${d})`;
}

function pair(label: string, a: usize, b: usize): string {
  return `  ${label.padEnd(10)}${a} -> ${b}${delta(a as f64, b as f64)}`;
}

function movedLine(m: Ref<Moved>): string {
  return `  ${`${m.change > 0 ? "+" : ""}${m.change}`.padStart(6)}  ${m.title} (${m.then} -> ${m.now})`;
}

export function formatComparison(c: Ref<Comparison>): string {
  const then: Ref<Summary> = c.then;
  const now: Ref<Summary> = c.now;
  const porter = c.rules.filter((m) => m.action !== "unsupported");
  const waiting = c.rules.filter((m) => m.action === "unsupported");
  const thenGrade = then.grade;
  const nowGrade = now.grade;
  let lines = [
    `grade ${thenGrade !== null ? thenGrade : "none"} -> ${nowGrade !== null ? nowGrade : "none"}, score ${then.score} -> ${now.score}${delta(then.score, now.score)} per 1000 lines`,
    pair("files", then.files, now.files),
    pair("lines", then.lines, now.lines),
    pair("unread", then.unread.lines, now.unread.lines),
    pair("rejected", then.counts.reject, now.counts.reject),
    pair("guided", then.counts.guided, now.counts.guided),
    pair("auto-fix", then.counts.auto, now.counts.auto),
    pair("waiting", then.counts.unsupported, now.counts.unsupported),
  ];
  if (c.rules.length === 0) {
    lines.push("");
    lines.push("no rule's count changed");
  }
  if (porter.length > 0) {
    lines.push("");
    lines.push("rewrites that changed");
    for (const m of porter) lines.push(movedLine(m));
  }
  if (waiting.length > 0) {
    lines.push("");
    lines.push("waiting on Fish, changed");
    for (const m of waiting) lines.push(movedLine(m));
  }
  return lines.join("\n");
}
