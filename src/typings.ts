import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { CompileError } from "./diag.ts";
import { parse, type Stmt } from "./parser.ts";

// A package's declarations, found as TypeScript's `bundler` resolution finds them: the file and
// the package directory holding it, or why there is none, said in the words of a message.
export type Typings = { file: string; package: string } | { missing: string };

// The `exports` conditions a declaration is looked up under, in TypeScript's bundler mode.
const CONDITIONS = new Set(["types", "import", "default"]);

const isFile = (path: string) => existsSync(path) && statSync(path).isFile();
const isDirectory = (path: string) => existsSync(path) && statSync(path).isDirectory();

// The declaration file for a bare specifier imported from the file `from`: the nearest
// node_modules holding the package, or `@types` for it, from the importing file's directory up.
export function findTypings(from: string, specifier: string): Typings {
  const parts = specifier.split("/");
  const scoped = specifier.startsWith("@");
  const name = parts.slice(0, scoped ? 2 : 1).join("/");
  const sub = parts.slice(scoped ? 2 : 1).join("/");
  if (name === "" || (scoped && parts.length < 2)) return { missing: `'${specifier}' isn't a package name` };
  const types = `@types/${scoped ? name.slice(1).replace("/", "__") : name}`;
  let untyped: string | undefined;
  for (let dir = dirname(from); ; dir = dirname(dir)) {
    for (const candidate of [name, types]) {
      const root = join(dir, "node_modules", candidate);
      if (!isDirectory(root)) continue;
      const found = fromPackage(root, sub, candidate === types ? specifier : candidate);
      if ("file" in found) return found;
      // A package without declarations may still have them in `@types`, here or further up.
      untyped ??= found.missing;
    }
    if (dirname(dir) === dir) break;
  }
  if (untyped) return { missing: `${untyped}, and there is no '${types}'; Fish types a package from its declarations` };
  return { missing: `can't find the package '${name}': no 'node_modules/${name}' in '${dirname(from)}' or any directory above it; install it with npm` };
}

// The declaration a package directory gives for a subpath, '' for the package itself.
function fromPackage(root: string, sub: string, shown: string): Typings {
  const manifest = join(root, "package.json");
  let pkg: Record<string, unknown> = {};
  if (isFile(manifest)) {
    try {
      pkg = JSON.parse(readFileSync(manifest, "utf8")) as Record<string, unknown>;
    } catch {
      return { missing: `'${shown}' has a package.json that isn't JSON` };
    }
  }
  const at = (file: string | undefined): Typings | undefined => (file === undefined ? undefined : { file, package: root });
  if (pkg.exports !== undefined && pkg.exports !== null) {
    const key = sub === "" ? "." : `./${sub}`;
    const target = exportsTarget(pkg.exports, key);
    if (target === undefined) return { missing: `'${shown}' doesn't export '${key}' in its package.json 'exports'` };
    return at(declarationFor(join(root, target))) ?? { missing: `'${shown}' exports '${key}' as '${target}', which has no declaration file beside it` };
  }
  if (sub !== "") return at(declarationFor(join(root, sub))) ?? { missing: `'${shown}' has no declaration for '${sub}'` };
  for (const field of ["types", "typings"]) {
    if (typeof pkg[field] === "string") return at(declarationFor(join(root, pkg[field] as string))) ?? { missing: `'${shown}' names '${pkg[field]}' as its '${field}', which isn't there` };
  }
  const main = typeof pkg.main === "string" ? declarationFor(join(root, pkg.main)) : undefined;
  return at(main ?? declarationFor(join(root, "index"))) ?? { missing: `'${shown}' has no TypeScript declarations: its package.json gives no 'types', and it has no index.d.ts` };
}

// The declaration file for a path as a package names it: itself when it is one, the one beside
// a JavaScript file, or for a path without an extension its `.d.ts` or its directory's index.
export function declarationFor(path: string): string | undefined {
  if (/\.d\.[mc]?ts$/.test(path)) return isFile(path) ? path : undefined;
  const beside = path.replace(/\.(m|c)?js$/, (_, kind: string | undefined) => `.d.${kind ?? ""}ts`);
  if (beside !== path) return isFile(beside) ? beside : undefined;
  if (/\.(m|c)?ts$/.test(path)) return isFile(path) ? path : undefined;
  return [`${path}.d.ts`, join(path, "index.d.ts")].find(isFile);
}

// What `exports` maps a subpath to, `.` for the package itself: a string or conditions for the
// package alone, or a map of subpaths, exact first and then the `*` pattern with the longest
// prefix, its match put where the target has a `*`.
function exportsTarget(exports: unknown, key: string): string | undefined {
  const map = typeof exports === "object" && !Array.isArray(exports) && Object.keys(exports as object).some((k) => k.startsWith("."));
  if (!map) return key === "." ? conditioned(exports) : undefined;
  const entries = exports as Record<string, unknown>;
  if (Object.hasOwn(entries, key)) return conditioned(entries[key]);
  let best: { prefix: string; target: unknown; match: string } | undefined;
  for (const [pattern, target] of Object.entries(entries)) {
    const star = pattern.indexOf("*");
    if (star < 0) continue;
    const [prefix, suffix] = [pattern.slice(0, star), pattern.slice(star + 1)];
    if (!key.startsWith(prefix) || !key.endsWith(suffix) || key.length < prefix.length + suffix.length) continue;
    if (!best || prefix.length > best.prefix.length) best = { prefix, target, match: key.slice(prefix.length, key.length - suffix.length) };
  }
  if (!best) return undefined;
  return conditioned(best.target)?.replaceAll("*", best.match);
}

// A target through its conditions, in their own key order; null excludes it.
function conditioned(target: unknown): string | undefined {
  if (typeof target === "string") return target;
  if (Array.isArray(target)) return target.map(conditioned).find((t) => t !== undefined);
  if (typeof target !== "object" || target === null) return undefined;
  for (const [condition, value] of Object.entries(target)) {
    if (!CONDITIONS.has(condition)) continue;
    return conditioned(value);
  }
  return undefined;
}

// A name a declaration file exports: the statement declaring it, and the file and text it is in.
export type Declared = { file: string; src: string; at: Stmt };

type Scope = { file: string; src: string; statements: Stmt[] };
const exportsCache = new Map<string, Map<string, Declared> | string>();

// The names a declaration file exports, each with where it is declared, or why the file can't
// be read; for a types package written as `declare module "pkg"`, the names that module exports.
export function exportsOf(file: string, specifier?: string): Map<string, Declared> | string {
  const key = `${file}\n${specifier ?? ""}`;
  const cached = exportsCache.get(key);
  if (cached !== undefined) return cached;
  // A file reached again through its own re-exports adds nothing more.
  exportsCache.set(key, new Map());
  let made: Map<string, Declared> | string;
  try {
    const src = readFileSync(file, "utf8");
    const statements = parse(src);
    const ambient = specifier === undefined ? undefined : statements.map(unwrap).find((s): s is Extract<Stmt, { kind: "namespace" }> => s.kind === "namespace" && s.quoted && s.name === specifier);
    made = exportsIn({ file, src, statements: ambient ? ambient.body ?? [] : statements });
  } catch (e) {
    if (!(e instanceof CompileError)) throw e;
    made = `can't read the declarations in '${file}': ${e.message}`;
  }
  exportsCache.set(key, made);
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
  if (d.kind === "namespace" && !d.quoted) return [d.name];
  return [];
}

function exportsIn(scope: Scope): Map<string, Declared> {
  const declared = (at: Stmt): Declared => ({ file: scope.file, src: scope.src, at });
  const local = new Map<string, Stmt>();
  for (const s of scope.statements) for (const n of declares(s)) if (!local.has(n)) local.set(n, s);
  const out = new Map<string, Declared>();
  const set = (name: string, d: Declared | undefined) => d && !out.has(name) && out.set(name, d);
  const from = (module: string): Map<string, Declared> => {
    const target = /^\.\.?(\/|$)/.test(module) ? declarationFor(join(dirname(scope.file), module)) : (() => {
      const t = findTypings(scope.file, module);
      return "file" in t ? t.file : undefined;
    })();
    const found = target === undefined ? undefined : exportsOf(target, /^\.\.?(\/|$)/.test(module) ? undefined : module);
    return found instanceof Map ? found : new Map();
  };
  for (const s of scope.statements) {
    if (s.kind === "export") for (const n of declares(s.body)) set(n, declared(s));
    else if (s.kind === "exportNamed") {
      const other = s.module === undefined ? undefined : from(s.module);
      for (const sp of s.specifiers) set(sp.alias ?? sp.name, other ? other.get(sp.name) : local.has(sp.name) ? declared(local.get(sp.name)!) : undefined);
    } else if (s.kind === "exportAll") {
      if (s.alias !== undefined) set(s.alias, declared(s));
      else for (const [n, d] of from(s.module)) if (n !== "default") set(n, d);
    } else if (s.kind === "exportDefault") {
      const named = s.value?.kind === "ident" ? local.get(s.value.name) : undefined;
      set("default", declared(s.declaration ?? named ?? s));
    } else if (s.kind === "exportAssign") {
      // `export = X`: X is the module, its namespace's members what it exports by name.
      const name = s.value.kind === "ident" ? s.value.name : undefined;
      for (const t of scope.statements) {
        const d = unwrap(t);
        if (d.kind === "namespace" && !d.quoted && d.name === name) for (const m of d.body ?? []) for (const n of declares(m)) set(n, declared(m));
      }
      set("default", declared(name !== undefined && local.has(name) ? local.get(name)! : s));
    }
  }
  return out;
}
