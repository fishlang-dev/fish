import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

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
