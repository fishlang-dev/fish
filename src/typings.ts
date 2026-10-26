import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { CompileError, locate } from "./diag.ts";
import { parse, type Stmt } from "./parser.ts";

// A package's declarations, found as TypeScript's `bundler` resolution finds them: the file and
// the package directory holding it, or why there is none, said in the words of a message.
export type Typings = { file: string; package: string } | { missing: string };

// The `exports` conditions a declaration is looked up under, in TypeScript's bundler mode.
const CONDITIONS = new Set(["types", "import", "default"]);

const isFile = (path: string) => existsSync(path) && statSync(path).isFile();
const isDirectory = (path: string) => existsSync(path) && statSync(path).isDirectory();
const relativeSpecifier = (s: string) => /^\.\.?(\/|$)/.test(s);
// A path's real one, or the path itself where that can't be read; reading it then says why.
const real = (path: string) => {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
};

// The declaration file for a bare specifier imported from the file `from`: the nearest
// node_modules holding the package, or `@types` for it, from the importing file's directory up.
// A found file is given by its real path, as TypeScript follows a symlinked package, so what it
// imports in turn is looked for beside where it really is.
export function findTypings(from: string, specifier: string): Typings {
  const parts = specifier.split("/");
  const scoped = specifier.startsWith("@");
  const name = parts.slice(0, scoped ? 2 : 1).join("/");
  const sub = parts.slice(scoped ? 2 : 1).join("/");
  if (name === "" || (scoped && parts.length < 2)) return { missing: `'${specifier}' isn't a package name` };
  const types = `@types/${scoped ? name.slice(1).replace("/", "__") : name}`;
  let untyped: string | undefined;
  let typed = false;
  for (let dir = resolve(dirname(from)); ; dir = dirname(dir)) {
    for (const candidate of [name, types]) {
      const root = join(dir, "node_modules", candidate);
      if (!isDirectory(root)) continue;
      if (candidate === types) typed = true;
      const found = fromPackage(root, sub, candidate === types ? `${types}${sub ? `/${sub}` : ""}` : specifier);
      if ("file" in found) return { file: real(found.file), package: real(found.package) };
      // A package without declarations may still have them in `@types`, here or further up.
      untyped ??= found.missing;
    }
    if (dirname(dir) === dir) break;
  }
  if (untyped) return { missing: `${untyped}, ${typed ? `and '${types}' doesn't declare it either` : `and there is no '${types}'`}; Fish types a package from its declarations` };
  return { missing: `can't find the package '${name}': no 'node_modules/${name}' in '${resolve(dirname(from))}' or any directory above it; install it with npm` };
}

// The declaration a package directory gives for a subpath, '' for the package itself.
function fromPackage(root: string, sub: string, shown: string): Typings {
  const manifest = join(root, "package.json");
  let pkg: Record<string, unknown> = {};
  if (isFile(manifest)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(manifest, "utf8"));
    } catch {
      return { missing: `'${shown}' has a package.json that isn't JSON` };
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return { missing: `'${shown}' has a package.json that isn't an object` };
    pkg = parsed as Record<string, unknown>;
  }
  const at = (file: string | undefined): Typings | undefined => (file === undefined ? undefined : { file, package: root });
  if (pkg.exports !== undefined && pkg.exports !== null) {
    const key = sub === "" ? "." : `./${sub}`;
    const target = exportsTarget(pkg.exports, key, root);
    if (!target.matched) return { missing: `'${shown}' doesn't export '${key}' in its package.json 'exports'` };
    return at(target.file) ?? { missing: `'${shown}' exports '${key}', but none of what it maps it to has a declaration file` };
  }
  if (sub !== "") return at(subpath(join(root, sub))) ?? { missing: `'${shown}' has no declaration for '${sub}'` };
  // `typings` is read first, and a file it names that isn't there leaves index.d.ts, as tsc does.
  const named = ["typings", "types"].find((f) => typeof pkg[f] === "string");
  if (named) return at(declarationFor(join(root, pkg[named] as string)) ?? declarationFor(join(root, "index"))) ?? { missing: `'${shown}' names '${pkg[named]}' as its '${named}', which isn't there` };
  const main = typeof pkg.main === "string" ? declarationFor(join(root, pkg.main)) : undefined;
  return at(main ?? declarationFor(join(root, "index"))) ?? { missing: `'${shown}' has no TypeScript declarations: its package.json gives no 'types', and it has no index.d.ts` };
}

// A subpath's declaration, as tsc looks: the file first, then a directory's package.json, whose
// `typings`, `types` or `main` say where and whose `exports` counts only at a package's root,
// then its index.
function subpath(path: string): string | undefined {
  const file = /\.[a-z]+$/i.test(path) ? declarationFor(path) : [`${path}.d.ts`].find(isFile);
  if (file !== undefined) return file;
  if (isDirectory(path)) {
    let pkg: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(readFileSync(join(path, "package.json"), "utf8"));
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) pkg = parsed as Record<string, unknown>;
    } catch {
      // No package.json, or one that isn't JSON, says nothing here.
    }
    const field = ["typings", "types", "main"].find((f) => typeof pkg[f] === "string");
    const named = field === undefined ? undefined : declarationFor(join(path, pkg[field] as string));
    if (named !== undefined) return named;
  }
  return declarationFor(path);
}

// The declaration file for a path as a package or a re-export names it: itself when it is one,
// the one beside a JavaScript or TypeScript file, or for a path without an extension its `.d.ts`
// or its directory's index.
export function declarationFor(path: string): string | undefined {
  if (/\.d\.[mc]?ts$/.test(path)) return isFile(path) ? path : undefined;
  const js = /\.([mc]?)js$/.exec(path);
  if (js) return [path.slice(0, -js[0].length) + `.d.${js[1]}ts`].find(isFile);
  const ts = /\.([mc]?)ts$/.exec(path);
  if (ts) return [path, path.slice(0, -ts[0].length) + `.d.${ts[1]}ts`].find(isFile);
  return [`${path}.d.ts`, join(path, "index.d.ts")].find(isFile);
}

// What `exports` maps a subpath to, `.` for the package itself: whether any entry matches, and
// the declaration found through it. A string or conditions stand for the package alone; a map's
// exact subpath comes first, then the `*` pattern with the longest prefix, the longer pattern on
// a tie, its match put where the target has a `*`.
function exportsTarget(exports: unknown, key: string, root: string): { matched: boolean; file?: string } {
  const map = typeof exports === "object" && !Array.isArray(exports) && Object.keys(exports as object).some((k) => k.startsWith("."));
  // A target excluded with null isn't exported at all.
  const outcome = (found: string | null | undefined) => (found === null ? { matched: false } : { matched: true, file: found });
  if (!map) return key === "." ? outcome(conditioned(exports, (t) => target(root, t))) : { matched: false };
  const entries = exports as Record<string, unknown>;
  if (Object.hasOwn(entries, key)) return outcome(conditioned(entries[key], (t) => target(root, t)));
  let best: { prefix: string; pattern: string; value: unknown; match: string } | undefined;
  for (const [pattern, value] of Object.entries(entries)) {
    const star = pattern.indexOf("*");
    if (star < 0) continue;
    const [prefix, suffix] = [pattern.slice(0, star), pattern.slice(star + 1)];
    if (!key.startsWith(prefix) || !key.endsWith(suffix) || key.length < prefix.length + suffix.length) continue;
    const better = !best || prefix.length > best.prefix.length || (prefix.length === best.prefix.length && pattern.length > best.pattern.length);
    if (better) best = { prefix, pattern, value, match: key.slice(prefix.length, key.length - suffix.length) };
  }
  if (!best) return { matched: false };
  const match = best.match;
  return outcome(conditioned(best.value, (t) => target(root, t.replaceAll("*", match))));
}

// An `exports` target as a file inside the package: written from `./`, never leaving it or
// reaching into node_modules, and naming a file exactly.
function target(root: string, t: string): string | undefined {
  if (!t.startsWith("./") || t.split("/").some((part) => part === ".." || part === "node_modules")) return undefined;
  if (!/\.[a-z]+$/i.test(t)) return undefined;
  return declarationFor(join(root, t));
}

// A target through its conditions, in their own key order, each that matches tried until one
// gives a declaration; an array's entries likewise. Null excludes it, ending the search.
function conditioned(t: unknown, resolve: (target: string) => string | undefined): string | null | undefined {
  if (t === null) return null;
  if (typeof t === "string") return resolve(t);
  if (Array.isArray(t)) {
    for (const entry of t) {
      const found = conditioned(entry, resolve);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (typeof t !== "object") return undefined;
  for (const [condition, value] of Object.entries(t)) {
    if (!CONDITIONS.has(condition)) continue;
    const found = conditioned(value, resolve);
    if (found !== undefined) return found;
  }
  return undefined;
}

// A name a declaration file exports: the statement declaring it, the file and text it is in, and
// what other names mean where it is declared.
export type Declared = { file: string; src: string; at: Stmt; resolve: (name: string) => Declared | undefined };
// A declaration file's exports, with why any of what it re-exports from couldn't be read.
export type Exports = { names: Map<string, Declared>; problems: string[] };

type Scope = { file: string; src: string; statements: Stmt[] };
// One pass of a lookup: the files it has finished, those it is reading, and what the previous
// pass found, given where a file is reached again through its own re-exports. Files are parsed
// once for the whole lookup.
type Parsed = { src: string; statements: Stmt[] } | string;
type Lookup = { done: Map<string, Exports>; reading: Set<string>; before: Map<string, Exports>; parsed: Map<string, Parsed>; cyclic: boolean };

// The names a declaration file exports, each with where it is declared, or why the file can't
// be read; for a types package written as `declare module "pkg"`, the names that module exports.
// Where re-exports go round in a cycle, passes repeat, each starting the cycle from what the last
// found, until no file's exports grow: `export *` only adds names, so this ends.
export function exportsOf(file: string, specifier?: string): Exports | string {
  const parsed = new Map<string, Parsed>();
  const size = (m: Map<string, Exports>) => [...m.values()].reduce((n, x) => n + x.names.size, 0);
  let before = new Map<string, Exports>();
  for (;;) {
    const lookup: Lookup = { done: new Map(), reading: new Set(), before, parsed, cyclic: false };
    const made = read(file, specifier, lookup);
    if (typeof made === "string" || !lookup.cyclic || (before.size > 0 && size(lookup.done) === size(before))) return made;
    before = lookup.done;
  }
}

// Why a file couldn't be read, in a message's words.
const REASONS: Record<string, string> = { EACCES: "permission denied", ENOENT: "it isn't there", EISDIR: "it is a directory" };

function parsedFile(file: string, lookup: Lookup): Parsed {
  const known = lookup.parsed.get(file);
  if (known !== undefined) return known;
  let made: Parsed;
  try {
    const src = readFileSync(file, "utf8");
    try {
      made = { src, statements: parse(src) };
    } catch (e) {
      if (!(e instanceof CompileError)) throw e;
      const { line, col } = locate(src, e.start);
      made = `can't read the declarations in '${file}:${line}:${col}': ${e.message}`;
    }
  } catch (e) {
    if (e instanceof CompileError) throw e;
    const code = (e as { code?: string }).code;
    made = `can't read the declarations in '${file}': ${code ? REASONS[code] ?? code : (e as Error).message}`;
  }
  lookup.parsed.set(file, made);
  return made;
}

// Whether a declaration file is a module, as one with a top-level import or export is; one
// without declares globals.
const isModule = (statements: Stmt[]) => statements.some((s) => ["import", "importEquals", "export", "exportNamed", "exportAll", "exportDefault", "exportAssign"].includes(s.kind));

function read(file: string, specifier: string | undefined, lookup: Lookup): Exports | string {
  const key = `${file}\n${specifier ?? ""}`;
  const done = lookup.done.get(key);
  if (done) return done;
  if (lookup.reading.has(key)) {
    lookup.cyclic = true;
    return lookup.before.get(key) ?? { names: new Map(), problems: [] };
  }
  const parsed = parsedFile(file, lookup);
  if (typeof parsed === "string") return parsed;
  const { src, statements } = parsed;
  const ambient = specifier === undefined ? undefined : statements.map(unwrap).find((s): s is Extract<Stmt, { kind: "namespace" }> => s.kind === "namespace" && s.quoted && s.name === specifier);
  if (!ambient && !isModule(statements)) return `'${file}' declares globals, not a module`;
  lookup.reading.add(key);
  const made = exportsIn({ file, src, statements: ambient ? ambient.body ?? [] : statements }, lookup);
  lookup.reading.delete(key);
  lookup.done.set(key, made);
  return made;
}

// A statement under `declare` or `export`.
function unwrap(s: Stmt): Stmt {
  return s.kind === "declare" || s.kind === "export" ? unwrap(s.body) : s;
}

// The names a declaration gives.
function declares(s: Stmt): string[] {
  const d = unwrap(s);
  if (d.kind === "let") return d.declarations.flatMap((x) => (x.target.kind === "ident" ? [x.target.name] : []));
  if (d.kind === "function" || d.kind === "interface" || d.kind === "typeAlias" || d.kind === "enum") return [d.name];
  if (d.kind === "class" && d.name !== undefined) return [d.name];
  if (d.kind === "namespace" && !d.quoted && !d.global) return [d.name];
  return [];
}

// What a name in a declaration file stands for: a declaration of its own, a name imported from
// another module, or a whole module imported as a namespace.
type Binding = { kind: "own"; at: Stmt } | { kind: "import"; module: string; name: string; at: Stmt } | { kind: "namespace"; module: string; at: Stmt };

// A namespace's body sees the names around it, which `outer` gives.
function exportsIn(scope: Scope, lookup: Lookup, outer?: (name: string) => Declared | undefined): Exports {
  const declared = (at: Stmt): Declared => ({ file: scope.file, src: scope.src, at, resolve: (name) => binding(name) });
  const local = new Map<string, Binding>();
  for (const s of scope.statements) {
    for (const n of declares(s)) if (!local.has(n)) local.set(n, { kind: "own", at: s });
    if (s.kind === "import") {
      if (s.default) local.set(s.default, { kind: "import", module: s.module, name: "default", at: s });
      if (s.namespace) local.set(s.namespace, { kind: "namespace", module: s.module, at: s });
      for (const sp of s.named ?? []) local.set(sp.alias ?? sp.name, { kind: "import", module: s.module, name: sp.name, at: s });
    }
    const equals = s.kind === "export" ? s.body : s;
    if (equals.kind === "importEquals" && equals.require !== undefined) local.set(equals.name, { kind: "namespace", module: equals.require, at: s });
  }
  const names = new Map<string, Declared>();
  const problems: string[] = [];
  const set = (name: string, d: Declared | undefined) => d && !names.has(name) && names.set(name, d);
  const from = (module: string): Map<string, Declared> => {
    const found = relativeSpecifier(module) ? declarationFor(join(dirname(scope.file), module)) : (() => {
      const t = findTypings(scope.file, module);
      if ("missing" in t) problems.push(`re-exporting from '${module}' failed: ${t.missing}`);
      return "file" in t ? t.file : undefined;
    })();
    if (found === undefined) {
      if (relativeSpecifier(module)) problems.push(`re-exporting from '${module}' failed: it has no declaration file`);
      return new Map();
    }
    const exports = read(found, relativeSpecifier(module) ? undefined : module, lookup);
    if (typeof exports === "string") {
      problems.push(`re-exporting from '${module}' failed: ${exports}`);
      return new Map();
    }
    for (const p of exports.problems) if (!problems.includes(p)) problems.push(p);
    return exports.names;
  };
  const binding = (name: string): Declared | undefined => {
    const b = local.get(name);
    if (!b) return outer?.(name);
    return b.kind === "import" ? from(b.module).get(b.name) : declared(b.at);
  };
  // A file exporting nothing explicitly exports every declaration, as a declaration file or a
  // `declare module` body does.
  const explicit = scope.statements.some((s) => s.kind === "exportNamed" || s.kind === "exportAll" || s.kind === "exportAssign" || (s.kind === "exportDefault" && s.declaration === undefined));
  for (const s of scope.statements) {
    if (s.kind === "export") {
      if (s.body.kind === "importEquals") set(s.body.name, declared(s));
      else for (const n of declares(s.body)) set(n, declared(s));
    } else if (!explicit) {
      for (const n of declares(s)) set(n, declared(s));
    }
    if (s.kind === "exportNamed") {
      const other = s.module === undefined ? undefined : from(s.module);
      for (const sp of s.specifiers) set(sp.alias ?? sp.name, other ? other.get(sp.name) : binding(sp.name));
    } else if (s.kind === "exportAll") {
      if (s.alias !== undefined) set(s.alias, declared(s));
      else for (const [n, d] of from(s.module)) if (n !== "default") set(n, d);
    } else if (s.kind === "exportDefault") {
      set("default", s.declaration ? declared(s.declaration) : (s.value?.kind === "ident" ? binding(s.value.name) : undefined) ?? declared(s));
    } else if (s.kind === "exportAssign") {
      exportAssigned(s, scope, local, set, from, declared, lookup, binding);
    }
  }
  return { names, problems };
}

// `export = X`: X is the module. Its members are what it exports by name: a namespace's own
// exports, those of a module it was imported as, or the properties of an object type it has.
function exportAssigned(s: Extract<Stmt, { kind: "exportAssign" }>, scope: Scope, local: Map<string, Binding>, set: (name: string, d: Declared | undefined) => void, from: (module: string) => Map<string, Declared>, declared: (at: Stmt) => Declared, lookup: Lookup, around: (name: string) => Declared | undefined) {
  const name = s.value.kind === "ident" ? s.value.name : undefined;
  const b = name === undefined ? undefined : local.get(name);
  if (b?.kind === "namespace") {
    for (const [n, d] of from(b.module)) if (n !== "default") set(n, d);
  }
  for (const t of scope.statements) {
    const d = unwrap(t);
    if (d.kind === "namespace" && !d.quoted && d.name === name) {
      const inner = exportsIn({ file: scope.file, src: scope.src, statements: d.body ?? [] }, lookup, around);
      for (const [n, x] of inner.names) set(n, x);
    }
    if (d.kind === "let") {
      for (const x of d.declarations) {
        if (x.target.kind !== "ident" || x.target.name !== name || x.type?.kind !== "object") continue;
        for (const m of x.type.members) if ((m.kind === "property" || m.kind === "method") && typeof m.name === "string") set(m.name, declared(t));
      }
    }
  }
  set("default", b ? (b.kind === "import" ? from(b.module).get(b.name) : declared(b.at)) : declared(s));
}
