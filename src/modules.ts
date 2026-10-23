import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { CompileError, type Source } from "./diag.ts";
import { parse, shiftSpans, type Span, type Stmt } from "./parser.ts";

// A program spread over files: the entry and every file it imports, each parsed once with its own
// offset range, so a position anywhere in the program says which file it is in.

// Each file after the entry starts at its own multiple of this, room for a 16 MiB file.
export const FILE_SPAN = 2 ** 24;

export type Module = { path: string; file: string; base: number; src: string; statements: Stmt[] };
export type Loaded = { modules: Module[]; sources: Source[] };

// Loads `entry`, given as `src` when it is already read, and every file it imports.
export function load(entry: string, src = readFileSync(entry, "utf8")): Loaded {
  const modules: Module[] = [];
  const byPath = new Map<string, Module>();
  const visit = (path: string, text: string, file: string): Module => {
    const key = realpathSync(path);
    const known = byPath.get(key);
    if (known) return known;
    const base = modules.length * FILE_SPAN;
    if (text.length >= FILE_SPAN) throw new CompileError(`'${file}' is larger than the 16 MiB a source file may be`, base, base);
    const statements = parse(text);
    if (base > 0) shiftSpans(statements, base);
    const module: Module = { path: key, file, base, src: text, statements };
    modules.push(module);
    byPath.set(key, module);
    for (const s of statements) {
      const specifier = specifierOf(s);
      if (specifier === undefined) continue;
      const target = resolveSpecifier(path, specifier, s);
      visit(target, readFileSync(target, "utf8"), relative(dirname(entry), target) || target);
    }
    return module;
  };
  visit(entry, src, entry);
  return { modules, sources: modules.slice(1).map(({ base, src, file }) => ({ base, src, file })) };
}

// The file a statement imports from, or re-exports from.
export function specifierOf(s: Stmt): string | undefined {
  if (s.kind === "import" || s.kind === "exportAll") return s.module;
  if (s.kind === "exportNamed") return s.module;
  return undefined;
}

// The file a relative specifier names, as TypeScript resolves one: the extension may be left out
// or written as TypeScript's or JavaScript's, and a directory means its `index.fsh`.
export function resolveSpecifier(from: string, specifier: string, at: Span): string {
  if (!/^\.\.?\//.test(specifier)) {
    throw new CompileError(`'${specifier}' isn't a path to a file; imports of packages aren't supported yet, so import another file with a relative path like './${specifier}'`, at.start, at.end);
  }
  const path = join(dirname(from), specifier);
  const bare = path.replace(/\.(ts|js|mts|mjs)$/, "");
  const candidates = path.endsWith(".fsh") ? [path] : bare !== path ? [`${bare}.fsh`] : [`${path}.fsh`, join(path, "index.fsh")];
  const found = candidates.find((c) => existsSync(c) && statSync(c).isFile());
  if (found) return found;
  const looked = candidates.map((c) => `'${relative(dirname(from), c)}'`).join(" and ");
  throw new CompileError(`can't find the file '${specifier}' imports from; looked for ${looked}`, at.start, at.end);
}

// The program the checker reads: every file's statements, imports and re-exports left out once
// loaded, and exports unwrapped to the declarations they export. Only the entry file keeps
// `export function`, which a library makes a C function.
export function flatten({ modules }: Loaded): Stmt[] {
  return modules.flatMap((m, i) => m.statements.flatMap((s): Stmt[] => {
    if (s.kind === "import" || s.kind === "exportAll" || s.kind === "exportNamed") return [];
    if (s.kind === "export" && !(i === 0 && s.body.kind === "function")) return [s.body];
    if (s.kind === "exportDefault" && s.declaration) return [s.declaration];
    return [s];
  }));
}
