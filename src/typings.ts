import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { Ids } from "./nodes.ts";
import { CompileError, locate } from "./diag.ts";
import { parseWithComments, type Expr, type PropertyName, type Stmt, type TypeNode } from "./parser.ts";
import { cloneStmt, cloneStmts } from "./rebuild.ts";

// A package's declarations, found as TypeScript's `bundler` resolution finds them: the file and
// the package directory holding it, or why there is none, said in the words of a message.
export type Typings = { file: string; package: string } | { missing: string };

// What a package.json says of where its declarations are. An `exports` target is a path, a list
// tried in order, conditions in their own key order, or null, which excludes it.
type ExportsTarget = string | null | ExportsTarget[] | { [key: string]: ExportsTarget };
type PackageJson = { exports?: ExportsTarget; types?: string; typings?: string; main?: string };

// The `exports` conditions a declaration is looked up under, in TypeScript's bundler mode.
const CONDITIONS = new Set(["types", "import", "default"]);

function isFile(path: string): boolean {
  if (!existsSync(path)) return false;
  try {
    return statSync(path).isFile();
  } catch (_e) {
    return false;
  }
}

function isDirectory(path: string): boolean {
  if (!existsSync(path)) return false;
  try {
    return statSync(path).isDirectory();
  } catch (_e) {
    return false;
  }
}

const relativeSpecifier = (s: string): boolean => /^\.\.?(\/|$)/.test(s);

// A path's real one, or the path itself where that can't be read; reading it then says why.
function real(path: string): string {
  try {
    return realpathSync(path);
  } catch (_e) {
    return path;
  }
}

// A file's text, if it can be read.
function textOf(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch (_e) {
    return undefined;
  }
}

// A package.json's text read for where its declarations are, or why it can't be: it isn't JSON,
// or it is JSON but not an object.
function packageJson(text: string): PackageJson | "not json" | "not an object" {
  try {
    JSON.parse(text);
  } catch (_e) {
    return "not json";
  }
  if (!text.trimStart().startsWith("{")) return "not an object";
  try {
    return JSON.parse<PackageJson>(text);
  } catch (_e) {
    // Fields of other types than a package.json's, which say nothing of where declarations are.
    return {};
  }
}

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
  let untyped: string | undefined = undefined;
  let typed = false;
  for (let dir = resolve(dirname(from)); ; dir = dirname(dir)) {
    for (const candidate of [name, types]) {
      const root = join(dir, "node_modules", candidate);
      if (!isDirectory(root)) continue;
      if (candidate === types) typed = true;
      const found = fromPackage(root, sub, candidate === types ? `${types}${sub !== "" ? `/${sub}` : ""}` : specifier);
      if ("file" in found) return { file: real(found.file), package: real(found.package) };
      // A package without declarations may still have them in `@types`, here or further up.
      if (untyped === undefined) untyped = found.missing;
    }
    if (dirname(dir) === dir) break;
  }
  if (untyped !== undefined) return { missing: `${untyped}, ${typed ? `and '${types}' doesn't declare it either` : `and there is no '${types}'`}; Fish types a package from its declarations` };
  return { missing: `can't find the package '${name}': no 'node_modules/${name}' in '${resolve(dirname(from))}' or any directory above it; install it with npm` };
}

function at(file: string | undefined, root: string): Typings | undefined {
  return file === undefined ? undefined : { file, package: root };
}

// The declaration a package directory gives for a subpath, '' for the package itself.
function fromPackage(root: string, sub: string, shown: string): Typings {
  const manifest = join(root, "package.json");
  let pkg: PackageJson = {};
  if (isFile(manifest)) {
    const read = packageJson(textOf(manifest) ?? "");
    if (read === "not json") return { missing: `'${shown}' has a package.json that isn't JSON` };
    if (read === "not an object") return { missing: `'${shown}' has a package.json that isn't an object` };
    pkg = read;
  }
  const exports = pkg.exports;
  if (exports !== undefined && exports !== null) {
    const key = sub === "" ? "." : `./${sub}`;
    const target = exportsTarget(exports, key, root);
    if (!target.matched) return { missing: `'${shown}' doesn't export '${key}' in its package.json 'exports'` };
    return at(target.file, root) ?? { missing: `'${shown}' exports '${key}', but none of what it maps it to has a declaration file` };
  }
  if (sub !== "") return at(subpath(join(root, sub)), root) ?? { missing: `'${shown}' has no declaration for '${sub}'` };
  // `typings` is read first, and a file it names that isn't there leaves index.d.ts, as tsc does.
  const typings = pkg.typings;
  const types = pkg.types;
  const field = typeof typings === "string" ? "typings" : typeof types === "string" ? "types" : undefined;
  const named = typeof typings === "string" ? typings : typeof types === "string" ? types : undefined;
  if (field !== undefined && named !== undefined) return at(declarationFor(join(root, named)) ?? declarationFor(join(root, "index")), root) ?? { missing: `'${shown}' names '${named}' as its '${field}', which isn't there` };
  const main = pkg.main;
  const fromMain = typeof main === "string" ? declarationFor(join(root, main)) : undefined;
  return at(fromMain ?? declarationFor(join(root, "index")), root) ?? { missing: `'${shown}' has no TypeScript declarations: its package.json gives no 'types', and it has no index.d.ts` };
}

// A subpath's declaration, as tsc looks: the file first, then a directory's package.json, whose
// `typings`, `types` or `main` say where and whose `exports` counts only at a package's root,
// then its index.
function subpath(path: string): string | undefined {
  const file = /\.[a-z]+$/i.test(path) ? declarationFor(path) : isFile(`${path}.d.ts`) ? `${path}.d.ts` : undefined;
  if (file !== undefined) return file;
  if (isDirectory(path)) {
    // No package.json, or one that isn't a JSON object, says nothing here.
    const read = packageJson(textOf(join(path, "package.json")) ?? "");
    const pkg: PackageJson = typeof read === "string" ? {} : read;
    const typings = pkg.typings;
    const types = pkg.types;
    const main = pkg.main;
    const field = typeof typings === "string" ? typings : typeof types === "string" ? types : typeof main === "string" ? main : undefined;
    const named = field === undefined ? undefined : declarationFor(join(path, field));
    if (named !== undefined) return named;
  }
  return declarationFor(path);
}

function firstFile(paths: string[]): string | undefined {
  for (const p of paths) if (isFile(p)) return p;
  return undefined;
}

// The declaration file for a path as a package or a re-export names it: itself when it is one,
// the one beside a JavaScript or TypeScript file, or for a path without an extension its `.d.ts`
// or its directory's index.
export function declarationFor(path: string): string | undefined {
  if (/\.d\.[mc]?ts$/.test(path)) return isFile(path) ? path : undefined;
  const js = /\.([mc]?)js$/.exec(path);
  if (js !== null) return firstFile([path.slice(0, (path.length - js[0]!.length) as i64) + `.d.${js[1]!}ts`]);
  const ts = /\.([mc]?)ts$/.exec(path);
  if (ts !== null) return firstFile([path, path.slice(0, (path.length - ts[0]!.length) as i64) + `.d.${ts[1]!}ts`]);
  return firstFile([`${path}.d.ts`, join(path, "index.d.ts")]);
}

// What an `exports` target came to: a declaration file, an exclusion by null, or nothing found.
type Conditioned = { kind: "file"; file: string } | { kind: "excluded" } | { kind: "none" };

function outcome(found: Ref<Conditioned>): { matched: boolean; file?: string } {
  if (found.kind === "excluded") return { matched: false };
  return found.kind === "file" ? { matched: true, file: found.file } : { matched: true };
}

// What `exports` maps a subpath to, `.` for the package itself: whether any entry matches, and
// the declaration found through it. A string or conditions stand for the package alone; a map's
// exact subpath comes first, then the `*` pattern with the longest prefix, the longer pattern on
// a tie, its match put where the target has a `*`.
function exportsTarget(exports: Ref<ExportsTarget>, key: string, root: string): { matched: boolean; file?: string } {
  if (exports === null || typeof exports === "string" || Array.isArray(exports) || !Object.keys(exports).some((k) => k.startsWith("."))) {
    return key === "." ? outcome(conditioned(exports, root, undefined)) : { matched: false };
  }
  for (const [k, value] of Object.entries(exports)) if (k === key) return outcome(conditioned(value, root, undefined));
  let best: { prefix: string; pattern: string; match: string } | undefined = undefined;
  for (const pattern of Object.keys(exports)) {
    const star = pattern.indexOf("*");
    if (star < 0) continue;
    const prefix = pattern.slice(0, star);
    const suffix = pattern.slice(star + 1);
    if (!key.startsWith(prefix) || !key.endsWith(suffix) || key.length < prefix.length + suffix.length) continue;
    const better = best === undefined || prefix.length > best.prefix.length || (prefix.length === best.prefix.length && pattern.length > best.pattern.length);
    if (better) best = { prefix, pattern, match: key.slice(prefix.length as i64, (key.length - suffix.length) as i64) };
  }
  if (best === undefined) return { matched: false };
  for (const [k, value] of Object.entries(exports)) if (k === best.pattern) return outcome(conditioned(value, root, best.match));
  return { matched: false };
}

// An `exports` target as a file inside the package: written from `./`, never leaving it or
// reaching into node_modules, and naming a file exactly.
function target(root: string, t: string): string | undefined {
  if (!t.startsWith("./") || t.split("/").some((part) => part === ".." || part === "node_modules")) return undefined;
  if (!/\.[a-z]+$/i.test(t)) return undefined;
  return declarationFor(join(root, t));
}

// A target through its conditions, in their own key order, each that matches tried until one
// gives a declaration; an array's entries likewise. Null excludes it, ending the search. A `*`
// in a path is replaced by `match`, when the target came from a pattern.
function conditioned(t: Ref<ExportsTarget>, root: string, match: string | undefined): Conditioned {
  if (t === null) return { kind: "excluded" };
  if (typeof t === "string") {
    const file = target(root, match === undefined ? t : t.replaceAll("*", match));
    return file === undefined ? { kind: "none" } : { kind: "file", file };
  }
  if (Array.isArray(t)) {
    for (const entry of t) {
      const found = conditioned(entry, root, match);
      if (found.kind !== "none") return found;
    }
    return { kind: "none" };
  }
  for (const [condition, value] of Object.entries(t)) {
    if (!CONDITIONS.has(condition)) continue;
    const found = conditioned(value, root, match);
    if (found.kind !== "none") return found;
  }
  return { kind: "none" };
}

// A name a declaration file exports: the statement declaring it, the file and text it is in, and
// the scope it is declared in, by its place in the reader's list of scopes, through which the
// reader resolves what other names mean where it is declared.
export type Declared = { file: string; src: string; at: Stmt; scope: usize };
// A declaration file's exports, with why any of what it re-exports from couldn't be read.
export type Exports = { names: Map<string, Declared>; problems: string[] };

// What a name in a declaration file stands for: a declaration of its own, a name imported from
// another module, or a whole module imported as a namespace, each by its statement's place.
type Binding = { kind: "own"; at: usize } | { kind: "import"; module: string; name: string; at: usize } | { kind: "namespace"; module: string; at: usize };

// A list of statements names are declared in: a file's, or a namespace's body, which sees the
// names of the scope around it.
type Scope = { file: string; src: string; statements: Stmt[]; local: Map<string, Binding>; outer: usize | undefined };

type Parsed = { src: string; statements: Stmt[] } | string;

// One pass of a lookup: the files it has finished, those it is reading, and what the previous
// pass found, given where a file is reached again through its own re-exports.
type Pass = { done: Map<string, Exports>; reading: Set<string>; before: Map<string, Exports>; cyclic: boolean };

// Why a file couldn't be read, in a message's words.
const REASONS = new Map<string, string>([["EACCES", "permission denied"], ["ENOENT", "it isn't there"], ["EISDIR", "it is a directory"]]);

// Whether a declaration file is a module, as one with a top-level import or export is; one
// without declares globals.
function isModule(statements: Ref<Stmt[]>): boolean {
  return statements.some((s) => s.kind === "import" || s.kind === "importEquals" || s.kind === "export" || s.kind === "exportNamed" || s.kind === "exportAll" || s.kind === "exportDefault" || s.kind === "exportAssign");
}

// A statement under `declare` or `export`.
function unwrapped(s: Ref<Stmt>): Ref<Stmt> {
  if (s.kind === "declare") return unwrapped(s.body);
  if (s.kind === "export") return unwrapped(s.body);
  return s;
}

// The names a declaration gives.
function declares(s: Ref<Stmt>): string[] {
  const d = unwrapped(s);
  let names: string[] = [];
  if (d.kind === "let") {
    for (const x of d.declarations) if (x.target.kind === "ident") names.push(x.target.name);
  } else if (d.kind === "function" || d.kind === "interface" || d.kind === "typeAlias" || d.kind === "enum") names.push(d.name);
  else if (d.kind === "class" && d.name !== undefined) names.push(d.name);
  else if (d.kind === "namespace" && !d.quoted && !d.global) names.push(d.name);
  return names;
}

// Reads declaration files for the names they export, and resolves a name where a declaration is
// declared: the file's parsed once, its nodes numbered from the ids each call is given.
export class DeclarationReader {
  parsed: Map<string, Parsed> = new Map();
  scopes: Scope[] = [];
  pass: Pass = { done: new Map<string, Exports>(), reading: new Set<string>(), before: new Map<string, Exports>(), cyclic: false };

  // The names a declaration file exports, each with where it is declared, or why the file can't
  // be read; for a types package written as `declare module "pkg"`, the names that module exports.
  // Where re-exports go round in a cycle, passes repeat, each starting the cycle from what the
  // last found, until no file's exports grow: `export *` only adds names, so this ends.
  /** @throws {CompileError} */
  exportsOf(this: Mut<this>, ids: Mut<Ids>, file: string, specifier?: string): Exports | string {
    let before = new Map<string, Exports>();
    for (;;) {
      this.pass = { done: new Map<string, Exports>(), reading: new Set<string>(), before, cyclic: false };
      const made = this.read(ids, file, specifier);
      if (typeof made === "string" || !this.pass.cyclic || (this.pass.before.size > 0 && namesIn(this.pass.done) === namesIn(this.pass.before))) return made;
      before = new Map<string, Exports>();
      for (const [k, x] of this.pass.done) before.set(k, copyExports(x));
    }
  }

  // What `name` stands for where `declared` is declared.
  /** @throws {CompileError} */
  resolve(this: Mut<this>, ids: Mut<Ids>, declared: Ref<Declared>, name: string): Declared | undefined {
    let problems: string[] = [];
    return this.bound(ids, declared.scope, name, problems);
  }

  // The statements a declaration's scope holds, which TypeScript merges an interface's
  // declarations and a function's signatures from.
  statementsOf(declared: Ref<Declared>): Ref<Stmt[]> {
    return this.scopes[declared.scope]!.statements;
  }

  // Parses a file once for the whole reader.
  /** @throws {CompileError} */
  private parsedFile(this: Mut<this>, ids: Mut<Ids>, file: string): void {
    if (this.parsed.has(file)) return;
    let made: Parsed = "";
    let src: string | undefined = undefined;
    let failure = "";
    try {
      src = readFileSync(file, "utf8");
    } catch (e) {
      const io = e as IoError;
      failure = io.code !== "" ? REASONS.get(io.code) ?? io.code : io.message;
    }
    if (src === undefined) made = `can't read the declarations in '${file}': ${failure}`;
    else {
      try {
        // A package's JSDoc `@throws` tags describe JS throws, which reach Fish as panics, not errors.
        made = { src, statements: parseWithComments(src, ids).program };
      } catch (e) {
        if (!(e instanceof CompileError)) throw e;
        const { line, col } = locate(src, e.start);
        made = `can't read the declarations in '${file}:${line}:${col}': ${e.message}`;
      }
    }
    this.parsed.set(file, made);
  }

  // A parsed file's statements to read exports from, those of its `declare module` for
  // `specifier` when it has one, or why there are none.
  // ponytail: found by a walk over the parsed files, as a map's value is lent only while iterating;
  // a lookup by key if a reader holds many files.
  private statementsFor(file: string, specifier: string | undefined): { src: string; statements: Stmt[] } | string {
    for (const [f, parsed] of this.parsed) {
      if (f !== file) continue;
      return statementsIn(parsed, file, specifier);
    }
    return `can't read the declarations in '${file}'`;
  }

  /** @throws {CompileError} */
  private read(this: Mut<this>, ids: Mut<Ids>, file: string, specifier: string | undefined): Exports | string {
    const key = `${file}\n${specifier ?? ""}`;
    const done = this.pass.done.get(key);
    if (done !== undefined) return copyExports(done);
    if (this.pass.reading.has(key)) {
      this.pass.cyclic = true;
      const before = this.pass.before.get(key);
      return before !== undefined ? copyExports(before) : { names: new Map<string, Declared>(), problems: [] };
    }
    this.parsedFile(ids, file);
    const read = this.statementsFor(file, specifier);
    if (typeof read === "string") return read;
    this.pass.reading.add(key);
    const made = this.exportsIn(ids, file, read.src, read.statements, undefined);
    this.pass.reading.delete(key);
    this.pass.done.set(key, copyExports(made));
    return made;
  }

  // A scope's statements and the names bound in it, kept under the next place in the list.
  private scopeOf(this: Mut<this>, file: string, src: string, statements: Stmt[], outer: usize | undefined): usize {
    let local = new Map<string, Binding>();
    for (let i: usize = 0; i < statements.length; i++) {
      const s: Ref<Stmt> = statements[i]!;
      for (const n of declares(s)) if (!local.has(n)) local.set(n, { kind: "own", at: i });
      if (s.kind === "import") {
        if (s.default !== undefined) local.set(s.default, { kind: "import", module: s.module, name: "default", at: i });
        if (s.namespace !== undefined) local.set(s.namespace, { kind: "namespace", module: s.module, at: i });
        if (s.named !== undefined) for (const sp of s.named) local.set(sp.alias ?? sp.name, { kind: "import", module: s.module, name: sp.name, at: i });
      }
      const equals: Ref<Stmt> = s.kind === "export" ? s.body : s;
      if (equals.kind === "importEquals" && equals.require !== undefined) local.set(equals.name, { kind: "namespace", module: equals.require, at: i });
    }
    this.scopes.push({ file, src, statements, local, outer });
    return this.scopes.length - 1;
  }

  // The statement at `i` of a scope as what a name declared by it is.
  private declaredAt(scope: usize, i: usize): Declared {
    const s: Ref<Scope> = this.scopes[scope]!;
    return { file: s.file, src: s.src, at: cloneStmt(s.statements[i]!), scope };
  }

  // What `name` stands for in a scope, or in the scopes around it.
  /** @throws {CompileError} */
  private bound(this: Mut<this>, ids: Mut<Ids>, scope: usize, name: string, problems: Mut<string[]>): Declared | undefined {
    const b = this.scopes[scope]!.local.get(name);
    if (b === undefined) {
      const outer = this.scopes[scope]!.outer;
      return outer === undefined ? undefined : this.bound(ids, outer, name, problems);
    }
    if (b.kind !== "import") return this.declaredAt(scope, b.at);
    const module = b.module;
    const imported = b.name;
    return this.from(ids, scope, module, problems).get(imported);
  }

  // The names a module a scope's file imports or re-exports from exports, noting in `problems`
  // why it couldn't be read.
  /** @throws {CompileError} */
  private from(this: Mut<this>, ids: Mut<Ids>, scope: usize, module: string, problems: Mut<string[]>): Map<string, Declared> {
    const file = this.scopes[scope]!.file;
    let found: string | undefined = undefined;
    if (relativeSpecifier(module)) found = declarationFor(join(dirname(file), module));
    else {
      const t = findTypings(file, module);
      if ("missing" in t) problems.push(`re-exporting from '${module}' failed: ${t.missing}`);
      else found = t.file;
    }
    if (found === undefined) {
      if (relativeSpecifier(module)) problems.push(`re-exporting from '${module}' failed: it has no declaration file`);
      return new Map();
    }
    const exports = this.read(ids, found, relativeSpecifier(module) ? undefined : module);
    if (typeof exports === "string") {
      problems.push(`re-exporting from '${module}' failed: ${exports}`);
      return new Map();
    }
    for (const p of exports.problems) if (!problems.includes(p)) problems.push(p);
    return exports.names;
  }

  // The names a scope exports. A file exporting nothing explicitly exports every declaration, as
  // a declaration file or a `declare module` body does.
  /** @throws {CompileError} */
  private exportsIn(this: Mut<this>, ids: Mut<Ids>, file: string, src: string, statements: Stmt[], outer: usize | undefined): Exports {
    const explicit = statements.some((s) => s.kind === "exportNamed" || s.kind === "exportAll" || s.kind === "exportAssign" || (s.kind === "exportDefault" && s.declaration === undefined));
    const count = statements.length;
    const scope = this.scopeOf(file, src, statements, outer);
    let names = new Map<string, Declared>();
    let problems: string[] = [];
    for (let i: usize = 0; i < count; i++) {
      const s = cloneStmt(this.scopes[scope]!.statements[i]!);
      if (s.kind === "export") {
        if (s.body.kind === "importEquals") setOnce(names, s.body.name, this.declaredAt(scope, i));
        else for (const n of declares(s.body)) setOnce(names, n, this.declaredAt(scope, i));
      } else if (!explicit) {
        for (const n of declares(s)) setOnce(names, n, this.declaredAt(scope, i));
      }
      if (s.kind === "exportNamed") {
        const module = s.module;
        if (module !== undefined) {
          const other = this.from(ids, scope, module, problems);
          for (const sp of s.specifiers) setOnce(names, sp.alias ?? sp.name, other.get(sp.name));
        } else for (const sp of s.specifiers) setOnce(names, sp.alias ?? sp.name, this.bound(ids, scope, sp.name, problems));
      } else if (s.kind === "exportAll") {
        if (s.alias !== undefined) setOnce(names, s.alias, this.declaredAt(scope, i));
        else for (const [n, d] of this.from(ids, scope, s.module, problems)) if (n !== "default") setOnce(names, n, d);
      } else if (s.kind === "exportDefault") {
        const declaration = s.declaration;
        const value = s.value;
        if (declaration !== undefined) setOnce(names, "default", { file, src, at: declaration, scope });
        else {
          const named = value !== undefined && value.kind === "ident" ? this.bound(ids, scope, value.name, problems) : undefined;
          setOnce(names, "default", named ?? this.declaredAt(scope, i));
        }
      } else if (s.kind === "exportAssign") {
        this.exportAssigned(ids, s.value, scope, i, names, problems);
      }
    }
    return { names, problems };
  }

  // `export = X`: X is the module. Its members are what it exports by name: a namespace's own
  // exports, those of a module it was imported as, or the properties of an object type it has.
  /** @throws {CompileError} */
  private exportAssigned(this: Mut<this>, ids: Mut<Ids>, value: Ref<Expr>, scope: usize, at: usize, names: Mut<Map<string, Declared>>, problems: Mut<string[]>): void {
    const name = value.kind === "ident" ? value.name : undefined;
    const b = name === undefined ? undefined : this.scopes[scope]!.local.get(name);
    if (b !== undefined && b.kind === "namespace") {
      const module = b.module;
      for (const [n, d] of this.from(ids, scope, module, problems)) if (n !== "default") setOnce(names, n, d);
    }
    const count = this.scopes[scope]!.statements.length;
    for (let i: usize = 0; i < count; i++) {
      const t = cloneStmt(this.scopes[scope]!.statements[i]!);
      const d = unwrapped(t);
      if (d.kind === "namespace" && !d.quoted && d.name === name) {
        const inner = this.exportsIn(ids, this.scopes[scope]!.file, this.scopes[scope]!.src, d.body !== undefined ? cloneStmts(d.body) : [], scope);
        for (const [n, x] of inner.names) setOnce(names, n, x);
      }
      if (d.kind === "let") {
        for (const x of d.declarations) {
          const type: Ref<TypeNode | undefined> = x.type;
          if (x.target.kind !== "ident" || x.target.name !== name || type === undefined || type.kind !== "object") continue;
          for (const m of type.members) {
            if (m.kind !== "property" && m.kind !== "method") continue;
            const member: Ref<PropertyName> = m.name;
            if (typeof member === "string") setOnce(names, member, this.declaredAt(scope, i));
          }
        }
      }
    }
    let assigned: Declared | undefined = undefined;
    if (b === undefined) assigned = this.declaredAt(scope, at);
    else if (b.kind === "import") {
      const module = b.module;
      const imported = b.name;
      assigned = this.from(ids, scope, module, problems).get(imported);
    } else assigned = this.declaredAt(scope, b.at);
    setOnce(names, "default", assigned);
  }
}

function statementsIn(parsed: Ref<Parsed>, file: string, specifier: string | undefined): { src: string; statements: Stmt[] } | string {
  if (typeof parsed === "string") return parsed;
  if (specifier !== undefined) {
    for (const s of parsed.statements) {
      const u = unwrapped(s);
      if (u.kind === "namespace" && u.quoted && u.name === specifier) {
        const body: Stmt[] = u.body !== undefined ? cloneStmts(u.body) : [];
        return { src: parsed.src, statements: body };
      }
    }
  }
  if (!isModule(parsed.statements)) return `'${file}' declares globals, not a module`;
  return { src: parsed.src, statements: cloneStmts(parsed.statements) };
}

// A name's first export wins.
function setOnce(names: Mut<Map<string, Declared>>, name: string, d: Ref<Declared | undefined>): void {
  if (d !== undefined && !names.has(name)) names.set(name, { file: d.file, src: d.src, at: cloneStmt(d.at), scope: d.scope });
}

function copyExports(x: Ref<Exports>): Exports {
  let names = new Map<string, Declared>();
  for (const [n, d] of x.names) setOnce(names, n, d);
  return { names, problems: [...x.problems] };
}

function namesIn(m: Ref<Map<string, Exports>>): usize {
  let n: usize = 0;
  for (const x of m.values()) n += x.names.size;
  return n;
}

// A file's exports, for a caller that resolves nothing further through them.
/** @throws {CompileError} */
export function exportsOf(ids: Mut<Ids>, file: string, specifier?: string): Exports | string {
  let reader = new DeclarationReader();
  return reader.exportsOf(ids, file, specifier);
}
