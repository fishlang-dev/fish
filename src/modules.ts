import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { CompileError, type Source } from "./diag.ts";
import { parse, shiftSpans, type Span, type Specifier, type Stmt } from "./parser.ts";
import { unsupported } from "./unsupported.ts";

// A program spread over files: the entry and every file it imports, each parsed once with its own
// offset range, so a position anywhere in the program says which file it is in.

// Each file after the entry starts at its own multiple of this, room for a 16 MiB file.
export const FILE_SPAN = 2 ** 24;

// `targets` is the file each import and re-export names.
export type Module = { path: string; file: string; base: number; src: string; statements: Stmt[]; targets: Map<Stmt, Module> };
export type Loaded = { modules: Module[]; sources: Source[] };

// The files of the program last loaded, for naming where a declaration is.
let loadedFiles: { base: number; file: string }[] = [];

// The file a source offset is in, as written relative to the entry's directory.
export function fileAt(offset: number): string {
  return loadedFiles.findLast((f) => offset >= f.base)?.file ?? "";
}

// Loads `entry`, given as `src` when it is already read, and every file it imports.
export function load(entry: string, src = readFileSync(entry, "utf8")): Loaded {
  const modules: Module[] = [];
  const sources: Source[] = [];
  const byPath = new Map<string, Module>();
  const visit = (path: string, text: string, file: string): Module => {
    const key = realpathSync(path);
    const known = byPath.get(key);
    if (known) return known;
    const base = modules.length * FILE_SPAN;
    if (base > 0) sources.push({ base, src: text, file });
    if (text.length >= FILE_SPAN) throw new CompileError(`'${file}' is larger than the 16 MiB a source file may be`, base, base);
    let statements: Stmt[];
    try {
      statements = parse(text);
    } catch (e) {
      // A parse error's position is in its own file's text.
      if (e instanceof CompileError) shiftSpans(e, base);
      throw e;
    }
    if (base > 0) shiftSpans(statements, base);
    const module: Module = { path: key, file, base, src: text, statements, targets: new Map() };
    modules.push(module);
    byPath.set(key, module);
    for (const s of statements) {
      const specifier = specifierOf(s);
      if (specifier === undefined) continue;
      const target = resolveSpecifier(path, specifier, s);
      module.targets.set(s, visit(target, readFileSync(target, "utf8"), relative(dirname(entry), target) || target));
    }
    return module;
  };
  try {
    visit(entry, src, entry);
  } catch (e) {
    if (e instanceof CompileError) e.sources = sources;
    throw e;
  }
  loadedFiles = modules.map(({ base, file }) => ({ base, file: base === 0 ? basename(entry) : file }));
  return { modules, sources };
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
  if (!/^\.\.?(\/|$)/.test(specifier)) {
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

// A top-level declaration, under the name it has program-wide. A `fixed` one keeps its name: a C
// function, which two files may both declare, and the entry's `main` and exported functions.
type Decl = { name: string; unique: string; fixed: boolean };
type Linked = {
  module: Module;
  index: number;
  // The file's declarations with exports unwrapped, imports and re-exports left out.
  body: Stmt[];
  own: Map<string, Decl>;
  imports: Map<string, { from: Module; name: string; at: Span }>;
  // What each exported name is: a name in the file, or another file's export.
  exports: Map<string, { local: string } | { from: Module; name: string }>;
  stars: Module[];
  used: Set<string>;
};

// The program the checker reads: every file's declarations, each file seeing only its own names
// and what it imports. A top-level name keeps its spelling unless that would mean something else
// in another file, when it takes a suffix telling the files apart (`helper-fsh2`), which messages leave
// out. Only the entry file keeps `export function`, which a library makes a C function.
// With `lenient`, an import of a name no file exports is left unlinked, as one an expansion of a
// macro has yet to make.
export function flatten({ modules }: Loaded, library = false, lenient = false): Stmt[] {
  const linked = new Map(modules.map((m, i) => [m, linkOf(m, i, library)]));
  const exported = (m: Module, name: string, seen = new Set<string>()): Decl | undefined => {
    const key = `${m.path}\0${name}`;
    if (seen.has(key)) return undefined;
    seen.add(key);
    const l = linked.get(m)!;
    const e = l.exports.get(name);
    if (e) return "local" in e ? local(l, e.local, seen) : exported(e.from, e.name, seen);
    if (name === "default") return undefined;
    for (const star of l.stars) {
      const found = exported(star, name, seen);
      if (found) return found;
    }
    return undefined;
  };
  const local = (l: Linked, name: string, seen = new Set<string>()): Decl | undefined => {
    const imported = l.imports.get(name);
    return l.own.get(name) ?? (imported && exported(imported.from, imported.name, seen));
  };
  for (const l of linked.values()) {
    for (const [alias, { from, name, at }] of l.imports) {
      if (l.own.has(alias)) throw new CompileError(`'${alias}' is both imported and declared in this file; rename the import, as in 'import { ${name} as other${alias[0]!.toUpperCase()}${alias.slice(1)} }'`, at.start, at.end);
      if (exported(from, name) || lenient) continue;
      const hidden = linked.get(from)!.own.has(name) ? `; it declares '${name}' without exporting it, so add 'export' before that declaration` : "";
      throw new CompileError(name === "default" ? `'${from.file}' has no default export; add 'export default' before what it should give${hidden}` : `'${from.file}' has no export named '${name}'${hidden}`, at.start, at.end);
    }
  }
  const all = [...linked.values()];
  const taken = new Set<string>();
  for (const l of all) {
    for (const d of l.own.values()) {
      // Another file using the name for something else, its own local or a std name, would
      // otherwise reach this declaration.
      const elsewhere = all.some((o) => o !== l && o.used.has(d.name) && local(o, d.name) !== d);
      d.unique = d.fixed || (!elsewhere && !taken.has(d.name)) ? d.name : apart(d.name, l);
      taken.add(d.unique);
    }
  }
  const foreign = new Map<string, { signature: string; file: string }>();
  return all.flatMap((l) => {
    const to = new Map<string, string>();
    for (const name of l.used) {
      // `name-fsh<n>`, a name a macro's quote written in file n pins, is what `name` means there.
      const pinned = /^(.*)-fsh(\d+)$/.exec(name);
      if (pinned) {
        const there = all[Number(pinned[2])];
        const d = there && local(there, pinned[1]!);
        if (d) to.set(name, d.unique);
        continue;
      }
      const d = local(l, name);
      // A name another file declares, and this one neither declares nor imports, is this file's
      // own local or nothing at all here.
      const unique = d ? d.unique : taken.has(name) ? apart(name, l) : name;
      if (unique !== name) to.set(name, unique);
    }
    renameIn(l.body, (name) => to.get(name));
    return l.body.filter((s) => {
      if (s.kind !== "declare" || s.body.kind !== "function") return true;
      const f = s.body;
      // The types as written, without where: a declaration a macro gave has its quote's spans.
      const text = (t: Span | undefined) => (t ? shapeOf(t) : "");
      const signature = `${f.params.map((p) => text(p.type)).join(",")}:${text(f.returnType)}`;
      const known = foreign.get(f.name);
      if (!known) foreign.set(f.name, { signature, file: l.module.file || "the entry file" });
      else if (known.signature !== signature) throw new CompileError(`the C function '${f.name}' is declared in '${known.file}' with other types; declare it in one file and import it from there`, f.start, f.end);
      return !known;
    });
  });
}

// A name told apart from another file's: `-` can't be written in a name, and messages leave the
// suffix out.
const apart = (name: string, l: Linked) => `${name}-fsh${l.index}`;

function linkOf(module: Module, index: number, library: boolean): Linked {
  const entry = index === 0;
  const l: Linked = { module, index, body: [], own: new Map(), imports: new Map(), exports: new Map(), stars: [], used: new Set() };
  const bind = (alias: string, from: Module, name: string, at: Span) => {
    if (l.imports.has(alias)) throw new CompileError(`'${alias}' is already imported in this file`, at.start, at.end);
    l.imports.set(alias, { from, name, at });
  };
  const declare = (s: Stmt) => {
    l.body.push(s);
    const inner = s.kind === "export" || s.kind === "declare" ? s.body : s;
    const fixed = s.kind === "declare" || (s.kind === "export" && (s.body.kind === "declare" || (entry && library && s.body.kind === "function"))) || (entry && s.kind === "function" && s.name === "main");
    if (!entry && inner.kind === "function" && inner.name === "main") {
      throw new CompileError(`only the entry file's main() runs, so '${module.file}' can't declare one; rename it, or build '${module.file}' as a program of its own`, inner.start, inner.end);
    }
    for (const name of namesOf(inner.kind === "declare" ? inner.body : inner)) {
      if (!l.own.has(name)) l.own.set(name, { name, unique: name, fixed });
    }
  };
  // A library gives C its entry file's exported functions, under their own names.
  const listed: Specifier[] = [];
  const cOnly = (at: Span) => new CompileError("a library's C functions are its entry file's exported functions, each under its own name; write 'export function' on the function itself", at.start, at.end);
  for (const s of module.statements) {
    const from = module.targets.get(s);
    if (entry && library && (s.kind === "exportAll" || s.kind === "exportDefault" || (s.kind === "exportNamed" && from))) throw cOnly(s);
    if (s.kind === "import") {
      if (s.namespace !== undefined) throw new CompileError(`namespace imports aren't supported yet; import the names you use, as in 'import { a, b } from "${s.module}"'`, s.start, s.end);
      if (s.default !== undefined) bind(s.default, from!, "default", s);
      for (const sp of s.named ?? []) bind(sp.alias ?? sp.name, from!, sp.name, sp);
    } else if (s.kind === "importEquals") {
      throw new CompileError(`'import ${s.name} = ...' isn't supported yet; import what you use with 'import { a, b } from "./file"'`, s.start, s.end);
    } else if (s.kind === "exportAll") {
      if (s.alias !== undefined) throw unsupported("namespace re-exports ('export * as name from')", s);
      l.stars.push(from!);
    } else if (s.kind === "exportNamed") {
      for (const sp of s.specifiers as Specifier[]) l.exports.set(sp.alias ?? sp.name, from ? { from, name: sp.name } : { local: sp.name });
      if (entry && library) listed.push(...s.specifiers);
    } else if (s.kind === "export") {
      declare(entry && s.body.kind === "function" ? s : s.body);
      for (const name of namesOf(s.body.kind === "declare" ? s.body.body : s.body)) l.exports.set(name, { local: name });
    } else if (s.kind === "exportDefault") {
      const value = s.value;
      if (value?.kind === "ident") {
        l.exports.set("default", { local: value.name });
        continue;
      }
      const declaration: Stmt = s.declaration ?? { kind: "let", keyword: "const", declarations: [{ target: { kind: "ident", name: "default", start: s.start, end: s.end }, type: undefined, init: value, start: s.start, end: s.end }], start: s.start, end: s.end };
      if ((declaration.kind === "function" || declaration.kind === "class") && declaration.name === undefined) declaration.name = "default";
      declare(declaration);
      l.exports.set("default", { local: namesOf(declaration)[0] ?? "default" });
    } else declare(s);
  }
  for (const sp of listed) {
    // Only functions cross to C; a listed class, type or const stays a module export.
    if (!l.body.some((s) => s.kind === "function" && s.name === sp.name)) continue;
    const at = l.body.findIndex((s) => s.kind === "function" && s.name === sp.name && s.body !== undefined);
    if (at < 0 || (sp.alias !== undefined && sp.alias !== sp.name)) throw cOnly(sp);
    l.body[at] = { kind: "export", body: l.body[at]!, start: l.body[at]!.start, end: l.body[at]!.end };
    l.own.get(sp.name)!.fixed = true;
  }
  renameIn(l.body, (name) => void l.used.add(name));
  return l;
}

// The top-level names a declaration introduces.
function namesOf(s: Stmt): string[] {
  switch (s.kind) {
    case "function": case "enum": case "typeAlias": case "interface":
      return [s.name];
    case "class":
      return s.name === undefined ? [] : [s.name];
    case "let":
      return s.declarations.flatMap((d) => (d.target.kind === "ident" ? [d.target.name] : []));
    default:
      return [];
  }
}

// Nodes whose `name` is a binding or a use of one, rather than a property's or a label's.
const NAMED = new Set(["ident", "ref", "variant", "function", "class", "enum", "typeAlias", "interface", "infer", "mapped", "predicate"]);

// Renames every binding and use of a name, at any depth, to what `to` gives for it; a name it
// gives nothing for stays. Renaming a name everywhere in a file keeps its scoping, so a local
// shadowing a top-level name still does. A qualified name renames its first part.
function renameIn(v: unknown, to: (name: string) => string | undefined, seen = new Set<unknown>()) {
  if (typeof v !== "object" || v === null || seen.has(v)) return;
  seen.add(v);
  if (Array.isArray(v)) return v.forEach((x) => renameIn(x, to, seen));
  const node = v as Record<string, unknown>;
  const renamed = (name: string) => {
    const [head, ...rest] = name.split(".");
    const as = to(head!);
    return as === undefined ? name : [as, ...rest].join(".");
  };
  if (node.kind === "shorthand") {
    const as = to(node.name as string);
    // `{ x }` keeps its key while its value takes the new name.
    if (as !== undefined) Object.assign(node, { kind: "property", key: node.name, value: { kind: "ident", name: as, start: node.start, end: node.end } });
  } else if (typeof node.name === "string" && NAMED.has(node.kind as string)) node.name = renamed(node.name);
  if (Array.isArray(node.typeParams)) for (const p of node.typeParams as { name: string }[]) p.name = renamed(p.name);
  Object.values(node).forEach((x) => renameIn(x, to, seen));
}

// A syntax tree as text, its keys in order and without its spans.
function shapeOf(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(shapeOf).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).filter((k) => k !== "start" && k !== "end").sort().map((k) => `${k}:${shapeOf((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return typeof v === "bigint" ? `${v}n` : JSON.stringify(v) ?? "";
}
