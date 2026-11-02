import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import type { Compilation } from "./compilation.ts";
import { dependencyLib, dependencyOf, packageOf, resolvePackages, type Package as FishPackage } from "./dependencies.ts";
import { CompileError, type Source } from "./diag.ts";
import { NODE_MODULES } from "./survey.ts";
import { jsDeclaration, jsOverloads, referenced } from "./js.ts";
import { exportsOf, findTypings, type Declared, type Exports } from "./typings.ts";
import { parse, shiftSpans, type ClassMember, type Expr, type Func, type Span, type Specifier, type Stmt } from "./parser.ts";
import { fishFiles } from "./fmt.ts";
import { MANIFEST, type RustDependency } from "./manifest.ts";
import { HANDLE, RUST_NAME, rustSymbol, type RustTables } from "./rust.ts";
import { ENGINE_HOOK, STD, STD_MODULES, STD_VALUES, stdModule } from "./std.ts";
import { refuseCompat } from "./migrate.ts";
import { unsupported } from "./unsupported.ts";
import { nextId, NodeMap, type Ids } from "./nodes.ts";

// A program spread over files: the entry and every file it imports, each parsed once with its own
// offset range, so a position anywhere in the program says which file it is in.

// Each file after the entry starts at its own multiple of this, room for a 16 MiB file.
export const FILE_SPAN = 2 ** 24;

// `targets` is the file each import and re-export names.
// `globals`: the std modules a file names as globals, as `os` in `os.hostname()`, without
// importing them.
// `whole`: a package's module an import names whole, as a namespace, reached through its name.
// `owner`: on a Fish package's lib, the package, whose other files' exports are private to it.
// `pkg`: the directory of the Fish package a file belongs to, when the program has a fish.toml.
export type Module = { path: string; file: string; base: number; src: string; statements: Stmt[]; targets: NodeMap<Stmt, Module>; globals: Map<string, Module>; whole?: boolean; owner?: { name: string; dir: string; lib: string }; pkg?: string };
// `packages`: each package specifier the program imports, by the directory its import resolves
// from, its index naming it in the bundle.
export type Package = { specifier: string; dir: string; at: Span };
// `rust`: each Rust crate the program imports, with the directory of the Fish package listing it.
export type Loaded = { modules: Module[]; sources: Source[]; packages: Package[]; rust: RustCrate[] };
export type RustCrate = { dependency: RustDependency; dir: string };

// The file a source offset is in, among a compilation's `files`, as written relative to the
// entry's directory.
export function fileAt(files: Compilation["files"], offset: number): string {
  return files.findLast((f) => offset >= f.base)?.file ?? "";
}

// The source text a span covers in the program last loaded; std's prelude is in none of its files.
export function textAt(files: Compilation["files"], at: Span): string {
  const f = files.findLast((f) => at.start >= f.base);
  return f && at.end - f.base <= f.src.length ? f.src.slice(at.start - f.base, at.end - f.base) : "";
}

// Loads `entry`, given as `src` when it is already read, and every file it imports, each read by
// `read`: an editor's unsaved text is newer than the disk's. The program's files are noted in the
// compilation's `files`.
export function load(compilation: Compilation, entry: string, src: string = readFileSync(entry, "utf8"), read: (path: string) => string = (path: string) => readFileSync(path, "utf8"), fish: FishPackage[] | undefined = resolvePackages(entry, compilation.session.locking)): Loaded {
  const { ids, session, rust: rustTables } = compilation;
  const modules: Module[] = [];
  const sources: Source[] = [];
  const byPath = new Map<string, Module>();
  const std = (name: string) => visit(`std:${name}`, STD_MODULES[name]!, `node:${name}`);
  const visit = (path: string, text: string, file: string): Module => {
    if (!path.startsWith("std:")) compilation.looked.push(resolve(path));
    const key = path.startsWith("std:") ? path : realpathSync(path);
    const known = byPath.get(key);
    if (known) return known;
    const base = modules.length * FILE_SPAN;
    if (base > 0) sources.push({ base, src: text, file });
    if (text.length >= FILE_SPAN) throw new CompileError("E0909", `'${file}' is larger than the 16 MiB a source file may be`, base, base);
    let statements: Stmt[];
    try {
      // A TS-compat file isn't compiled, whether or not it parses.
      if (!path.startsWith("std:")) refuseCompat(text, fish && packageOf(fish, key)?.manifest.edition);
      statements = parse(text, ids);
    } catch (e) {
      // A parse or edition error's position is in its own file's text.
      if (e instanceof CompileError) shiftSpans(e, base);
      throw e;
    }
    if (base > 0) shiftSpans(statements, base);
    // A Rust crate's declarations are reached by importing `rust:<crate>`, not as this file's own.
    if (!path.startsWith("std:")) rustBlocks.set(key, statements.flatMap((s) => rustBlock(s) ?? []));
    statements = statements.filter((s) => !rustBlock(s));
    const module: Module = { path: key, file, base, src: text, statements, targets: new NodeMap(), globals: new Map(), pkg: fish && !path.startsWith("std:") ? packageOf(fish, key)?.dir : undefined };
    modules.push(module);
    byPath.set(key, module);
    for (const s of statements) {
      const specifier = specifierOf(s);
      if (specifier === undefined) continue;
      if (specifier === "fish:engine") {
        if (!session.engineHook) throw new CompileError("E0903", "'fish:engine' is the compiler's own test hook, which a program can't import; JS runs only as a package's code", s.start, s.end);
        module.targets.set(s, visit("std:fish:engine", ENGINE_HOOK, "fish:engine"));
        continue;
      }
      if (specifier.startsWith("rust:")) {
        module.targets.set(s, rustModule(key, specifier.slice("rust:".length), s));
        continue;
      }
      // A bare name the importing file's own fish.toml depends on is that Fish package, even one
      // Node also has; `node:` always means the built-in, and any other bare name is npm's.
      const lib = fish && !path.startsWith("std:") && !/^(\.\.?(\/|$)|node:)/.test(specifier) ? dependencyLib(fish, path, specifier, s) : undefined;
      if (lib) {
        const target = visit(lib, read(lib), relative(dirname(entry), lib));
        const { manifest, dir } = packageOf(fish!, lib)!;
        target.owner = { name: manifest.name, dir, lib: manifest.lib };
        module.targets.set(s, target);
        continue;
      }
      const named = stdModule(specifier);
      if (named) {
        module.targets.set(s, std(named));
        continue;
      }
      if (!/^\.\.?(\/|$)/.test(specifier)) {
        module.targets.set(s, packageModule(path, specifier, s, statements));
        continue;
      }
      // A dependency builds from its own files, which its checksum covers, and reaches others by name,
      // whether the path climbs out as written or through a link.
      const owner = fish && !path.startsWith("std:") ? dependencyOf(fish, path) : undefined;
      const outside = (file: string) => owner !== undefined && !file.startsWith(owner.dir + "/");
      const escape = () => new CompileError("E0903", `'${specifier}' leads outside the package '${owner!.manifest.name}'; a package imports its own files by path, and other packages by name`, s.start, s.end);
      if (outside(join(dirname(realpathSync(path)), specifier))) throw escape();
      const target = resolveSpecifier(path, specifier, s, compilation.looked);
      if (outside(realpathSync(target))) throw escape();
      // Another package's files are reached through its lib, by name, even from a directory
      // that holds it.
      const holder = fish && !path.startsWith("std:") ? packageOf(fish, target) : undefined;
      if (holder && holder !== packageOf(fish!, path)) throw new CompileError("E0903", `'${specifier}' is a file inside the package '${holder.manifest.name}'; import it by name, as '${holder.manifest.name}'`, s.start, s.end);
      module.targets.set(s, visit(target, read(target), relative(dirname(entry), target) || target));
    }
    for (const name of globalsIn(statements)) module.globals.set(name, std(name));
    return module;
  };
  // A declaration file a package's declarations come from: given its own place in the program's
  // offsets, so a message about a declaration shows its line.
  const declarationFile = (file: string, text: string = readFileSync(file, "utf8")): number => {
    const key = `dts:${file}`;
    const known = byPath.get(key);
    if (known) return known.base;
    const base = modules.length * FILE_SPAN;
    sources.push({ base, src: text, file: relative(dirname(entry), file) });
    const holder: Module = { path: key, file: relative(dirname(entry), file), base, src: text, statements: [], targets: new NodeMap(), globals: new Map() };
    modules.push(holder);
    byPath.set(key, holder);
    return base;
  };
  // What an import from a package names, as a module of its own: the declarations of the names it
  // imports, each where the package declares it, as JS declarations.
  const packages: Package[] = [];
  const packageModule = (from: string, specifier: string, s: Stmt, importing: Stmt[]): Module => {
    const exports = packageExports(ids, from, specifier, s, entry);
    const dir = dirname(realpathSync(from));
    let index = packages.findIndex((p) => p.specifier === specifier && p.dir === dir);
    if (index < 0) index = packages.push({ specifier, dir, at: s }) - 1;
    const named = s.kind === "import" ? s.named ?? [] : s.kind === "exportNamed" ? s.specifiers : [];
    if (s.kind === "exportAll") throw new CompileError("E0801", "re-exporting all of a package isn't supported yet; re-export the names it has by name", s.start, s.end);
    // A package imported whole, or a default export that is a namespace, is reached through its
    // name: the members the file uses, as `ns.f`, are what it imports.
    const defaulted = s.kind === "import" && s.default !== undefined ? exports.names.get("default") : undefined;
    const spaced = defaulted && unwrapped(defaulted.at).kind === "namespace";
    const whole = s.kind === "import" ? (s.namespace ?? (spaced ? s.default : undefined)) : undefined;
    // A member it lacks may be another name's, under a binding of its own; one reached through
    // the namespace is refused when the program is linked.
    const reached = whole === undefined ? [] : membersUsed(importing, whole).filter((m) => exports.names.has(m.name))
      .map((m) => ({ name: m.name, alias: undefined, typeOnly: false, start: m.start, end: m.end }));
    // Each name imported is exported by the module; the types its declaration names, and theirs,
    // are declared in it too, as they are where the package declares them.
    const statements: Stmt[] = [];
    const declaredHere = new Map<string, Declared>();
    // The names imported come first, so one also referred to is exported.
    const pending: { declared: Declared; name: string }[] = [];
    const add = (declared: Declared, name: string, exported: boolean, at: Span, as: string = name) => {
      if (declaredHere.has(name)) {
        if (declaredHere.get(name)!.at !== declared.at) throw new CompileError("E0907", `'${specifier}' declares '${name}' in two places Fish would bring together; import from its own file instead`, at.start, at.end);
        return;
      }
      declaredHere.set(name, declared);
      let made: Stmt;
      try {
        made = jsDeclaration(ids, declared, name, specifier, index, at, as);
      } catch (e) {
        // A declaration only referred to that Fish can't take is left out, refused where named.
        if (exported || !(e instanceof CompileError)) throw e;
        return;
      }
      const overloads = jsOverloads(ids, declared, made, name, specifier, index);
      const refers = referenced([made, ...overloads]);
      const base = declarationFile(declared.file);
      for (const s of [made, ...overloads]) shiftSpans(s, base);
      statements.push(exported ? ({ id: nextId(ids), kind: "export", body: made, start: made.start, end: made.end } as Stmt) : made, ...overloads);
      for (const n of refers) {
        const found = declared.resolve(n);
        if (found) pending.push({ declared: found, name: n });
      }
    };
    for (const sp of [...named, ...reached]) add(exports.names.get(sp.name)!, sp.name, true, sp);
    // A default export that isn't a namespace is a declaration of its own, exported as the default.
    if (defaulted && !spaced) {
      // A named declaration keeps its name, which it may use of itself.
      const own = unwrapped(defaulted.at) as { name?: unknown };
      const local = typeof own.name === "string" && !declaredHere.has(own.name) ? own.name : `${specifier} default`;
      add(defaulted, local, false, s, "default");
      statements.push({ id: nextId(ids), kind: "exportNamed", typeOnly: false, specifiers: [{ id: nextId(ids), name: local, alias: "default", typeOnly: false, start: s.start, end: s.end }], module: undefined, start: s.start, end: s.end });
    }
    for (let next = pending.shift(); next; next = pending.shift()) add(next.declared, next.name, false, next.declared.at);
    const module: Module = { path: `pkg:${modules.length}`, file: specifier, base: modules.length * FILE_SPAN, src: "", statements, targets: new NodeMap(), globals: new Map(), whole: whole !== undefined };
    modules.push(module);
    byPath.set(module.path, module);
    return module;
  };
  // Each file's `declare module "rust:<crate>"` blocks, by its real path, and the crates imported.
  const rustBlocks = new Map<string, Extract<Stmt, { kind: "namespace" }>[]>();
  const rust: RustCrate[] = [];
  // The blocks in a file of a package, read for them when the program doesn't import the file.
  const blocksIn = (file: string) => {
    const key = realpathSync(file);
    const known = rustBlocks.get(key);
    if (known) return known;
    const text = read(file);
    rustBlocks.set(key, []);
    if (!text.includes("rust:")) return [];
    const base = declarationFile(file, text);
    let statements: Stmt[];
    try {
      statements = parse(text, ids);
    } catch (e) {
      if (e instanceof CompileError) shiftSpans(e, base);
      throw e;
    }
    shiftSpans(statements, base);
    const blocks = statements.flatMap((s) => rustBlock(s) ?? []);
    rustBlocks.set(key, blocks);
    return blocks;
  };
  // What `import { f } from "rust:<crate>"` names: the functions the importing file's package
  // declares for the crate, which its fish.toml must list.
  const rustModule = (from: string, crate: string, s: Stmt): Module => {
    const pkg = fish && packageOf(fish, from);
    const dependency = pkg?.manifest.rustDependencies?.find((d) => d.name === crate);
    if (!pkg || !dependency) throw new CompileError("E1004", `'${crate}' isn't a Rust dependency of this package; list it under [rust-dependencies] in ${MANIFEST}, as in ${crate} = "1.0"`, s.start, s.end);
    const key = `rust:${pkg.dir}:${crate}`;
    const known = byPath.get(key);
    if (known) return known;
    const blocks = fishFiles(pkg.dir, () => {}).flatMap(blocksIn).filter((b) => b.name === `rust:${crate}`);
    if (blocks.length === 0) throw new CompileError("E1004", `no file of this package declares the functions of '${crate}'; declare them in one, as in 'declare module "rust:${crate}" { export function f(x: i64): i64; }'`, s.start, s.end);
    if (blocks.length > 1) throw new CompileError("E1004", `'rust:${crate}' is declared twice in this package; declare its functions in one place`, blocks[1]!.start, blocks[1]!.end);
    rust.push({ dependency, dir: pkg.dir });
    const module: Module = { path: key, file: `rust:${crate}`, base: modules.length * FILE_SPAN, src: "", statements: (blocks[0]!.body ?? []).map((st) => rustFunction(ids, rustTables, crate, st)), targets: new NodeMap(), globals: new Map() };
    modules.push(module);
    byPath.set(key, module);
    return module;
  };
  try {
    visit(entry, src, entry);
  } catch (e) {
    if (e instanceof CompileError) e.sources = [...sources, STD];
    throw e;
  }
  compilation.files.push(...modules.map(({ base, file, src, path }) => ({ base, file: base === 0 ? basename(entry) : file, src, std: path.startsWith("std:") })));
  // std's text sits past every file's, so it goes last, where an offset past them finds it.
  return { modules, sources: [...sources, STD], packages, rust };
}

// `declare module "rust:<crate>" { ... }`.
function rustBlock(s: Stmt) {
  return s.kind === "declare" && s.body.kind === "namespace" && s.body.quoted && s.body.name.startsWith("rust:") ? s.body : undefined;
}

// A function or class a Rust module declares, exported, its bodies the crate's: under the Fish
// name, at the Rust path `@rust` gives from the crate's root, or else at the same name there.
function rustFunction(ids: Ids, rust: RustTables, crate: string, s: Stmt): Stmt {
  const f = s.kind === "export" ? s.body : s;
  if (f.kind === "class") return { id: nextId(ids), kind: "export", body: rustClass(ids, rust, crate, f), start: s.start, end: s.end };
  if (f.kind !== "function") throw new CompileError("E1004", `a Rust module declares the crate's functions and types, as in 'export function f(x: i64): i64;' or 'export class Counter { ... }'`, s.start, s.end);
  if (f.body !== undefined) throw new CompileError("E1004", "a Rust function is declared without a body; the crate has its body", f.start, f.end);
  if (!RUST_NAME.test(f.name)) throw new CompileError("E1004", `'${f.name}' can't name a Rust function; use letters, digits and '_'`, f.start, f.end);
  const path = rustPath(f.decorators ?? [], f.name, "function");
  const declared: Func = { ...f, id: nextId(ids), decorators: undefined };
  rust.names.set(declared, { crate, path, symbol: rustSymbol(crate, path) });
  return { id: nextId(ids), kind: "export", body: declared, start: s.start, end: s.end };
}

// A Rust type declared as a class: a handle holding the boxed Rust value, whose constructor,
// statics and methods are the type's.
function rustClass(ids: Ids, rust: RustTables, crate: string, c: Extract<Stmt, { kind: "class" }>): Stmt {
  if (c.name === undefined || !RUST_NAME.test(c.name)) throw new CompileError("E1004", "a Rust type is a named class, its name letters, digits and '_'", c.start, c.end);
  if (c.typeParams.length > 0) throw new CompileError("E1004", "generic Rust types can't cross to Fish yet", c.typeParams[0]!.start, c.typeParams[0]!.end);
  if (c.extends) throw new CompileError("E1004", "a Rust type's class can't extend another", c.extends.start, c.extends.end);
  if (c.implements.length > 0) throw new CompileError("E1004", "a Rust type's class can't implement an interface yet", c.implements[0]!.start, c.implements[0]!.end);
  const path = rustPath(c.decorators, c.name, "type");
  const members = c.members.map((m): ClassMember => {
    const named = m.kind === "constructor" ? "new" : m.kind === "method" && typeof m.name === "string" ? m.name : undefined;
    if (named === undefined || (m.kind !== "constructor" && m.kind !== "method") || (m.kind === "method" && (m.optional || m.generator || m.typeParams.length > 0))) {
      throw new CompileError("E1004", "a Rust type's class declares a constructor, static functions and methods, without bodies; Rust fields aren't read from Fish", m.start, m.end);
    }
    if (m.kind === "method" && m.name === "constructor") throw new CompileError("E0407", "'constructor' can't be the name of a method", m.start, m.end);
    if (m.body !== undefined) throw new CompileError("E1004", "a Rust type's members are declared without bodies; the crate has them", m.start, m.end);
    if (m.modifiers.some((x) => x !== "static")) throw new CompileError("E1004", "a Rust type's members take no modifiers but 'static'", m.start, m.end);
    if (m.kind === "method" && !RUST_NAME.test(named)) throw new CompileError("E1004", `'${named}' can't name a Rust function; use letters, digits and '_'`, m.start, m.end);
    const member = rustPath(m.decorators, named, "member");
    const declared = { ...m, id: nextId(ids), decorators: [], body: [] } as ClassMember;
    rust.names.set(declared, { crate, path: `${path}::${member}`, symbol: rustSymbol(crate, `${path}::${member}`) });
    return declared;
  });
  // The one field, the address of the boxed value, which nothing in Fish reads; the IR holds it
  // as a pointer. It is a number to the checker, so the handle crosses threads as its type does.
  const at = { start: c.start, end: c.start };
  const handle: ClassMember = { id: nextId(ids), kind: "field", name: HANDLE, optional: false, definite: false, type: { id: nextId(ids), kind: "ref", name: "usize", args: [], ...at }, init: undefined, modifiers: [], decorators: [], ...at };
  const declared = { ...c, id: nextId(ids), decorators: [], members: [handle, ...members] };
  rust.classNodes.set(declared, { crate, path, name: c.name });
  return declared;
}

// The Rust path of a declaration from its decorators: `@rust("path")` from the crate's root, or
// for a member from its type.
function rustPath(decorators: Expr[], name: string, what: "function" | "type" | "member"): string {
  let path = name;
  for (const d of decorators) {
    // Fish moves values between threads, so a Rust type that isn't Send has no place yet.
    if (what === "type" && d.kind === "member" && d.object.kind === "ident" && d.object.name === "rust" && d.name === "local") {
      throw new CompileError("E1004", "Rust types that aren't Send aren't supported yet: Fish moves values between threads, so a Rust type must be Send", d.start, d.end);
    }
    const only = what === "type" ? "'@rust(\"path::to::Type\")'" : what === "member" ? "'@rust(\"name\")'" : "'@rust(\"path::to::item\")'";
    if (d.kind !== "call" || d.callee.kind !== "ident" || d.callee.name !== "rust") throw new CompileError("E1004", `a Rust ${what} takes only ${only}`, d.start, d.end);
    const [arg, ...rest] = d.args;
    if (arg?.kind !== "string" || rest.length > 0) throw new CompileError("E1004", `@rust takes the item's path in the crate as a string literal, as in @rust("util::mul")`, d.start, d.end);
    const parts = arg.value.split("::");
    if (!parts.every((part) => RUST_NAME.test(part)) || (what === "member" && parts.length > 1)) {
      throw new CompileError("E1004", what === "member" ? "a member's Rust name is one name, as in \"with_value\"" : "this isn't a Rust path; write one from the crate's root, as in \"util::mul\"", arg.start, arg.end);
    }
    path = arg.value;
  }
  return path;
}

// A statement under `declare` or `export`.
function unwrapped(s: Stmt): Stmt {
  return s.kind === "declare" || s.kind === "export" ? unwrapped(s.body) : s;
}

// The members of a name a file reaches, as `ns.f`, each where it is first reached.
function membersUsed(statements: Stmt[], name: string): { name: string; start: number; end: number }[] {
  const found = new Map<string, { name: string; start: number; end: number }>();
  const walk = (v: unknown) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (typeof v !== "object" || v === null) return;
    const n = v as { kind?: string; object?: { kind?: string; name?: string }; name?: string; start?: number; end?: number };
    if (n.kind === "member" && n.object?.kind === "ident" && n.object.name === name && !found.has(n.name!)) found.set(n.name!, { name: n.name!, start: n.start!, end: n.end! });
    Object.values(v).forEach(walk);
  };
  walk(statements);
  return [...found.values()];
}

// The exports of the package an import names, once each name it imports is found among them;
// a name not found is refused saying what the package exports.
function packageExports(ids: Ids, from: string, specifier: string, s: Stmt, entry: string): Exports {
  const shown = (file: string) => relative(dirname(entry), file);
  // A name a Node module has is that module, unless an npm package of that name is installed, as
  // a bundler takes it.
  const found = specifier.startsWith("node:") ? undefined : findTypings(from, specifier);
  if (found === undefined || ("missing" in found && NODE_MODULES.has(specifier.split("/")[0]!))) {
    throw new CompileError("E0908", `'${specifier}' is a Node module Fish's std doesn't have yet`, s.start, s.end);
  }
  if ("missing" in found) throw new CompileError("E0902", found.missing, s.start, s.end);
  const exports = exportsOf(ids, found.file, specifier);
  if (typeof exports === "string") throw new CompileError("E0902", exports, s.start, s.end);
  const names = s.kind === "import" ? [...(s.default ? ["default"] : []), ...(s.named ?? []).map((sp) => sp.name)]
    : s.kind === "exportNamed" ? s.specifiers.map((sp) => sp.name) : [];
  const missing = names.find((n) => !exports.names.has(n));
  if (missing !== undefined) {
    const known = [...exports.names.keys()].sort();
    const listed = known.length === 0 ? "nothing" : known.slice(0, 12).map((n) => `'${n}'`).join(", ") + (known.length > 12 ? `, and ${known.length - 12} more` : "");
    const what = missing === "default" ? "a default export" : `'${missing}'`;
    // What a re-export couldn't reach may be where the name is.
    const unread = exports.problems.length > 0 ? `; ${exports.problems[0]}` : "";
    const at = (s.kind === "import" ? s.named : s.kind === "exportNamed" ? s.specifiers : undefined)?.find((sp) => sp.name === missing) ?? s;
    throw new CompileError("E0902", `'${specifier}' has no export ${what}; its declarations in '${shown(found.file)}' export ${listed}${unread}`, at.start, at.end);
  }
  return exports;
}

// The std modules a file uses as globals: a member of a std module's name, as `os.hostname`,
// where the file neither declares nor imports that name.
function globalsIn(statements: Stmt[]): string[] {
  const bound = new Set(statements.flatMap((s) => {
    if (s.kind === "import") return [s.default, s.namespace, ...(s.named ?? []).map((sp) => sp.alias ?? sp.name)].filter((n): n is string => n !== undefined);
    return namesOf(s.kind === "export" ? s.body : s);
  }));
  const found = new Set<string>();
  const walk = (v: unknown) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (typeof v !== "object" || v === null) return;
    const n = v as Record<string, unknown>;
    const object = n.object as { kind?: string; name?: string } | undefined;
    if (n.kind === "member" && object?.kind === "ident" && Object.hasOwn(STD_MODULES, object.name!) && !bound.has(object.name!)) found.add(object.name!);
    Object.values(n).forEach(walk);
  };
  walk(statements);
  return [...found];
}

// The file a statement imports from, or re-exports from.
export function specifierOf(s: Stmt): string | undefined {
  if (s.kind === "import" || s.kind === "exportAll") return s.module;
  if (s.kind === "exportNamed") return s.module;
  return undefined;
}

// The file a relative specifier names, as TypeScript resolves one: the extension may be left out
// or written as TypeScript's or JavaScript's, and a directory means its `index.fsh`. When none is
// found, the files looked for are added to `looked`.
export function resolveSpecifier(from: string, specifier: string, at: Span, looked: string[] = []): string {
  if (!/^\.\.?(\/|$)/.test(specifier)) {
    throw new CompileError("E0901", `'${specifier}' isn't a path to a file; imports of packages aren't supported yet, so import another file with a relative path like './${specifier}'`, at.start, at.end);
  }
  const path = join(dirname(from), specifier);
  const bare = path.replace(/\.(ts|js|mts|mjs)$/, "");
  const candidates = path.endsWith(".fsh") ? [path] : bare !== path ? [`${bare}.fsh`] : [`${path}.fsh`, join(path, "index.fsh")];
  const found = candidates.find((c) => existsSync(c) && statSync(c).isFile());
  if (found) return found;
  looked.push(...candidates.map((c) => resolve(c)));
  const tried = candidates.map((c) => `'${relative(dirname(from), c)}'`).join(" and ");
  throw new CompileError("E0901", `can't find the file '${specifier}' imports from; looked for ${tried}`, at.start, at.end);
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
export function flatten(compilation: Compilation, { modules }: Loaded, library = false, lenient = false): Stmt[] {
  const { ids, fileNames } = compilation;
  const linked = new Map(modules.map((m, i) => [m, linkOf(ids, m, i, library)]));
  const exported = (m: Module, name: string, seen: Set<string> = new Set<string>()): Decl | undefined => {
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
  const local = (l: Linked, name: string, seen: Set<string> = new Set<string>()): Decl | undefined => {
    const imported = l.imports.get(name);
    return l.own.get(name) ?? (imported && exported(imported.from, imported.name, seen));
  };
  const all = [...linked.values()];
  for (const l of linked.values()) {
    for (const [alias, { from, name, at }] of l.imports) {
      if (l.own.has(alias)) throw new CompileError("E0907", `'${alias}' is both imported and declared in this file; rename the import, as in 'import { ${name} as other${alias[0]!.toUpperCase()}${alias.slice(1)} }'`, at.start, at.end);
      if (exported(from, name) || lenient) continue;
      // A std module's own declarations aren't for a program to export.
      const hidden = linked.get(from)!.own.has(name) && !from.path.startsWith("std:") ? `; it declares '${name}' without exporting it, so add 'export' before that declaration` : "";
      // Reached by a package's name from outside it, the lib is all there is to see.
      const owner = from.owner && l.module.pkg !== from.owner.dir ? from.owner : undefined;
      if (owner) {
        // Only the package's files this build loaded are known; one its lib never imports isn't.
        const inner = name !== "default" && all.some((m) => m.module !== from && m.module.pkg === owner.dir && m.exports.has(name));
        const missing = name === "default" ? "no default export" : `no export named '${name}'`;
        throw new CompileError(inner ? "E0903" : "E0902", inner ? `'${name}' is private to the package '${owner.name}'; only what its lib ${owner.lib} exports is public` : `the package '${owner.name}' has ${missing} in its lib ${owner.lib}${hidden}`, at.start, at.end);
      }
      throw new CompileError("E0902", name === "default" ? `'${from.file}' has no default export; add 'export default' before what it should give${hidden}` : `'${from.file}' has no export named '${name}'${hidden}`, at.start, at.end);
    }
  }
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
  const names = new Map(all.map((l) => {
    const written = new Map([...l.own.values()].map((d) => [d.unique, d.name]));
    for (const alias of l.imports.keys()) {
      const d = local(l, alias);
      if (d) written.set(d.unique, alias);
    }
    return [l.module.base, written];
  }));
  const program = all.flatMap((l) => {
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
    renameIn(ids, l.body, (name) => to.get(name));
    return l.body.filter((s) => {
      if (s.kind !== "declare" || s.body.kind !== "function") return true;
      const f = s.body;
      // The types as written, without where: a declaration a macro gave has its quote's spans.
      const text = (t: Span | undefined) => (t ? shapeOf(t) : "");
      const signature = `${f.params.map((p) => text(p.type)).join(",")}:${text(f.returnType)}`;
      const known = foreign.get(f.name);
      if (!known) foreign.set(f.name, { signature, file: l.module.file || "the entry file" });
      else if (known.signature !== signature) throw new CompileError("E1002", `the C function '${f.name}' is declared in '${known.file}' with other types; declare it in one file and import it from there`, f.start, f.end);
      return !known;
    });
  });
  fileNames.set(program, names);
  return program;
}

// A name told apart from another file's: `-` can't be written in a name, and messages leave the
// suffix out.
const apart = (name: string, l: Linked) => `${name}-fsh${l.index}`;

function linkOf(ids: Ids, module: Module, index: number, library: boolean): Linked {
  const entry = index === 0;
  const l: Linked = { module, index, body: [], own: new Map(), imports: new Map(), exports: new Map(), stars: [], used: new Set() };
  const bind = (alias: string, from: Module, name: string, at: Span) => {
    if (l.imports.has(alias)) throw new CompileError("E0907", `'${alias}' is already imported in this file`, at.start, at.end);
    l.imports.set(alias, { from, name, at });
  };
  const declare = (s: Stmt) => {
    l.body.push(s);
    const inner = s.kind === "export" || s.kind === "declare" ? s.body : s;
    const fixed = s.kind === "declare" || (s.kind === "export" && (s.body.kind === "declare" || (entry && library && s.body.kind === "function"))) || (entry && s.kind === "function" && s.name === "main");
    if (!entry && inner.kind === "function" && inner.name === "main") {
      throw new CompileError("E0405", `only the entry file's main() runs, so '${module.file}' can't declare one; rename it, or build '${module.file}' as a program of its own`, inner.start, inner.end);
    }
    for (const name of namesOf(inner.kind === "declare" ? inner.body : inner)) {
      if (!l.own.has(name)) l.own.set(name, { name, unique: name, fixed });
    }
  };
  // A library gives C its entry file's exported functions, under their own names.
  const listed: Specifier[] = [];
  const spaces = new Map<string, { from: Module; explicit: boolean }>();
  const cOnly = (at: Span) => new CompileError("E1002", "a library's C functions are its entry file's exported functions, each under its own name; write 'export function' on the function itself", at.start, at.end);
  for (const s of module.statements) {
    const from = module.targets.get(s);
    if (entry && library && (s.kind === "exportAll" || s.kind === "exportDefault" || (s.kind === "exportNamed" && from))) throw cOnly(s);
    if (s.kind === "import") {
      // A std module imported whole is reached through its name, as `os.hostname()`.
      const whole = s.namespace ?? s.default;
      if (whole !== undefined && (stdModule(s.module) || (from?.whole && (s.namespace !== undefined || s.default !== undefined)))) spaces.set(whole, { from: from!, explicit: true });
      else if (s.namespace !== undefined) throw new CompileError("E0801", `namespace imports aren't supported yet; import the names you use, as in 'import { a, b } from "${s.module}"'`, s.start, s.end);
      else if (s.default !== undefined) bind(s.default, from!, "default", s);
      for (const sp of s.named ?? []) bind(sp.alias ?? sp.name, from!, sp.name, sp);
    } else if (s.kind === "importEquals") {
      throw new CompileError("E0801", `'import ${s.name} = ...' isn't supported yet; import what you use with 'import { a, b } from "./file"'`, s.start, s.end);
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
      const declaration: Stmt = s.declaration ?? { id: nextId(ids), kind: "let", keyword: "const", declarations: [{ id: nextId(ids), target: { id: nextId(ids), kind: "ident", name: "default", start: s.start, end: s.end }, type: undefined, init: value, start: s.start, end: s.end }], start: s.start, end: s.end };
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
    l.body[at] = { id: nextId(ids), kind: "export", body: l.body[at]!, start: l.body[at]!.start, end: l.body[at]!.end };
    l.own.get(sp.name)!.fixed = true;
  }
  for (const [name, from] of module.globals) if (!l.own.has(name) && !l.imports.has(name) && !spaces.has(name)) spaces.set(name, { from, explicit: false });
  // A std module's value members imported by name, as `import { argv } from "node:process"`.
  const valued = new Map([...l.imports].flatMap(([alias, { from, name }]): [string, "value" | "table"][] => {
    const kind = valuesOf(from)[name];
    return kind ? [[alias, kind]] : [];
  }));
  if (spaces.size > 0 || valued.size > 0) throughSpaces(ids, l.body, spaces, bind, valued);
  // A file module's call naming an encoding, linked to the function giving a string.
  if ([...l.imports.values()].some(({ from }) => Object.hasOwn(ENCODED, from.path))) byEncoding(l.body, l.imports, bind);
  renameIn(ids, l.body, (name) => void l.used.add(name));
  return l;
}

// Walks a tree keeping the names local declarations take, so a rewrite of a module's name leaves
// the places it means something else alone: a block's declarations, a function's parameters, a
// loop head's bindings and a catch clause's name in its handler. `visit` returns true when it
// has handled a node and its children; only names `matters` cares about are tracked.
function scoped(matters: (name: string) => boolean, visit: (n: Record<string, unknown>, hidden: Set<string>, walk: (v: unknown, hidden: Set<string>) => void) => boolean) {
  const walk = (v: unknown, hidden: Set<string>): void => {
    if (Array.isArray(v)) {
      const declared = v.flatMap((s) => {
        const d = s as Stmt | null;
        if (!d || typeof d !== "object") return [];
        if (d.kind === "let") return d.declarations.flatMap((x) => bindings(x.target));
        return d.kind === "function" || d.kind === "class" ? namesOf(d) : [];
      });
      const inner = declared.some(matters) ? new Set([...hidden, ...declared]) : hidden;
      return v.forEach((x) => walk(x, inner));
    }
    if (typeof v !== "object" || v === null) return;
    const n = v as Record<string, unknown>;
    // A catch clause's name reaches only its handler, so the try's own blocks are walked first.
    if (n.kind === "try" && n.param) {
      const caught = bindings(n.param);
      walk(n.block, hidden);
      walk(n.handler, caught.some(matters) ? new Set([...hidden, ...caught]) : hidden);
      if (n.finalizer) walk(n.finalizer, hidden);
      return;
    }
    const head = n.kind === "forOf" || n.kind === "forIn" ? n.left : n.kind === "for" ? n.init : undefined;
    const declared = head && (head as { kind?: string }).kind === "let" ? (head as Extract<Stmt, { kind: "let" }>).declarations.flatMap((d) => bindings(d.target)) : [];
    const own = [...(Array.isArray(n.params) ? (n.params as { pattern?: unknown }[]).flatMap((p) => bindings(p.pattern)) : []), ...declared];
    if (own.some(matters)) hidden = new Set([...hidden, ...own]);
    if (!visit(n, hidden, walk)) Object.values(n).forEach((x) => walk(x, hidden));
  };
  return walk;
}

// Turns each `os.hostname` on a std module bound whole into a name imported from it, written
// so no program can write it. A global's member the module doesn't have is left alone, since a
// local of that name may be meant; an import's is refused. Where a function's parameter, a
// block's declaration or a catch clause takes the name, it means that instead.
function throughSpaces(ids: Ids, body: Stmt[], spaces: Map<string, { from: Module; explicit: boolean }>, bind: (alias: string, from: Module, name: string, at: Span) => void, valued: Map<string, "value" | "table"> = new Map()) {
  const bound = new Set<string>();
  const named = (d: string) => spaces.has(d) || valued.has(d);
  const walk = scoped(named, (n, hidden, walk) => {
    const object = n.object as { kind?: string; name?: string } | undefined;
    // `process.env.HOME` and `process.env[name]`: a table member's key, read through its function.
    const table = (x: unknown) => {
      const m = x as { kind?: string; object?: { kind?: string; name?: string }; name?: string } | undefined;
      const on = m?.kind === "member" && m.object?.kind === "ident" && !hidden.has(m.object.name!) ? spaces.get(m.object.name!) : undefined;
      return on && valuesOf(on.from)[m!.name!] === "table" ? { space: on, owner: m!.object!.name!, name: m!.name! } : undefined;
    };
    if (n.kind === "assign" && (n.target as { kind?: string }).kind !== undefined && table((n.target as { object?: unknown }).object)) {
      const t = table((n.target as { object?: unknown }).object)!;
      throw new CompileError("E0908", `setting '${t.owner}.${t.name}' isn't supported yet; it is read-only here`, n.start as number, n.end as number);
    }
    // `env.HOME` and `env[k]` on a table imported by name call it with the key.
    const imported = n.object as { kind?: string; name?: string; start?: number; end?: number } | undefined;
    if ((n.kind === "member" || n.kind === "index") && !n.optional && imported?.kind === "ident" && valued.get(imported.name!) === "table" && !hidden.has(imported.name!)) {
      const key = n.kind === "member" ? { id: nextId(ids), kind: "string", value: n.name, start: n.start, end: n.end } : n.index;
      walk(key, hidden);
      const callee = { id: nextId(ids), kind: "ident", name: imported.name, start: imported.start, end: imported.end };
      for (const k of Object.keys(n)) if (k !== "start" && k !== "end" && k !== "id") delete n[k];
      Object.assign(n, { kind: "call", callee, typeArgs: [], args: [key], optional: false });
      return true;
    }
    // `argv` imported by name reads as a value, calling it, except where it is called.
    if (n.kind === "ident" && valued.has(n.name as string) && !hidden.has(n.name as string)) {
      if (valued.get(n.name as string) === "table") throw new CompileError("E0908", `'${n.name}' is read by key, as in '${n.name}.HOME' or '${n.name}[name]'`, n.start as number, n.end as number);
      const callee = { id: nextId(ids), kind: "ident", name: n.name, start: n.start, end: n.end };
      for (const k of Object.keys(n)) if (k !== "start" && k !== "end" && k !== "id") delete n[k];
      Object.assign(n, { kind: "call", callee, typeArgs: [], args: [], optional: false });
      return true;
    }
    const keyed = (n.kind === "member" || n.kind === "index") && !n.optional ? table(n.object) : undefined;
    if (keyed) {
      const alias = `${keyed.owner}:${keyed.name}`;
      if (!bound.has(alias)) bind(alias, keyed.space.from, keyed.name, n as unknown as Span);
      bound.add(alias);
      const key = n.kind === "member" ? { id: nextId(ids), kind: "string", value: n.name, start: n.start, end: n.end } : n.index;
      walk(key, hidden);
      for (const k of Object.keys(n)) if (k !== "start" && k !== "end" && k !== "id") delete n[k];
      Object.assign(n, { kind: "call", callee: { id: nextId(ids), kind: "ident", name: alias, start: n.start, end: n.end }, typeArgs: [], args: [key], optional: false });
      return true;
    }
    // A call's callee is the function itself; a value member elsewhere reads through its function.
    if (n.kind === "call") {
      const callee = n.callee as Record<string, unknown>;
      if (callee.kind === "ident" && valued.has(callee.name as string)) {
        (n.args as unknown[]).forEach((x) => walk(x, hidden));
        return true;
      }
      const owner = callee.object as { kind?: string; name?: string } | undefined;
      if (callee.kind === "member" && owner?.kind === "ident" && spaces.has(owner.name!) && !hidden.has(owner.name!)) {
        rewrite(callee, spaces.get(owner.name!)!, owner.name!, false);
        (n.args as unknown[]).forEach((x) => walk(x, hidden));
        return true;
      }
    }
    const space = n.kind === "member" && object?.kind === "ident" && !hidden.has(object.name!) ? spaces.get(object.name!) : undefined;
    return space !== undefined && rewrite(n, space, object!.name!, true);
  });
  // `os.hostname` into the name imported from the module, called when it is a value member.
  const rewrite = (n: Record<string, unknown>, space: { from: Module; explicit: boolean }, owner: string, read: boolean): boolean => {
    const name = n.name as string;
    const exports = space.from.statements.flatMap((s) => (s.kind === "export" ? namesOf(s.body) : []));
    if (!exports.includes(name)) {
      // A package's module holds only the members the file uses, so what else it has isn't listed.
      if (space.explicit && space.from.whole) throw new CompileError("E0902", `'${space.from.file}' has no export '${name}'`, n.start as number, n.end as number);
      if (space.explicit) throw new CompileError("E0902", `'${space.from.file}' has no export named '${name}'; it has ${exports.map((e) => `'${e}'`).join(", ")}`, n.start as number, n.end as number);
      return false;
    }
    const kind = valuesOf(space.from)[name];
    if (read && kind === "table") throw new CompileError("E0908", `'${owner}.${name}' is read by key, as in '${owner}.${name}.HOME' or '${owner}.${name}[name]'`, n.start as number, n.end as number);
    const alias = `${owner}:${name}`;
    if (!bound.has(alias)) bind(alias, space.from, name, n as unknown as Span);
    bound.add(alias);
    for (const key of Object.keys(n)) if (key !== "start" && key !== "end" && key !== "id") delete n[key];
    const ident = { id: nextId(ids), kind: "ident", name: alias, start: n.start, end: n.end };
    Object.assign(n, read && kind === "value" ? { kind: "call", callee: ident, typeArgs: [], args: [], optional: false } : { ...ident, id: n.id });
    return true;
  };
  walk(body, new Set());
}

// `readFile(path, "utf8")` and `readFile(path, { encoding: "utf8" })` give a string, which
// `readFileText` gives; without an encoding, bytes. A write's "utf8" is what it writes anyway. A
// call taking other options, as `spawnSync`, keeps them and drops only the encoding.
// The encoding is read while compiling, so it must be a literal, and UTF-8 is the one known.
function byEncoding(body: Stmt[], imports: Linked["imports"], bind: (alias: string, from: Module, name: string, at: Span) => void) {
  const file = (name: string) => {
    const t = imports.get(name);
    return t && Object.hasOwn(ENCODED, t.from.path) && ENCODED[t.from.path]![t.name] !== undefined ? t : undefined;
  };
  const walk = scoped((name) => file(name) !== undefined, (n, hidden) => {
    const callee = n.callee as { kind?: string; name?: string } | undefined;
    const target = n.kind === "call" && callee?.kind === "ident" && !hidden.has(callee.name!) ? file(callee.name!) : undefined;
    if (!target) return false;
    const args = n.args as Expr[];
    const role = ENCODED[target.from.path]![target.name]!;
    const at = role === "read" ? 1 : role === "write" ? 2 : role;
    const given = args[at];
    if (!given) return false;
    const options = typeof role === "number";
    if (options && (given.kind !== "object" || !given.props.some(isEncoding))) return false;
    let encoding = given.kind === "string" && !options ? given.value : given.kind === "object" ? encodingOf(given, options) : undefined;
    if (encoding === undefined) throw new CompileError("E0908", `'${target.name}' takes its encoding as a literal, like ${options ? "" : `"utf8" or `}{ encoding: "utf8" }, so its type is known while compiling`, given.start, given.end);
    // Node's "buffer" asks for bytes, what no encoding gives.
    if (options && encoding === "buffer") encoding = null;
    if (encoding !== null && !/^utf-?8$/i.test(encoding)) throw new CompileError("E0908", `'${target.name}' knows the "utf8" encoding so far, not "${encoding}"`, given.start, given.end);
    if (options) (given as Extract<Expr, { kind: "object" }>).props = (given as Extract<Expr, { kind: "object" }>).props.filter((p) => !isEncoding(p));
    else args.splice(at, 1);
    if (role === "write" || encoding === null) return false;
    const alias = `${callee!.name}:text`;
    if (!imports.has(alias)) bind(alias, target.from, `${target.name}Text`, given);
    callee!.name = alias;
    return false;
  });
  walk(body, new Set());
}

// The std calls typed by their encoding, by module: which read, which write, and which take it
// among other options, at the argument given.
const ENCODED: Record<string, Record<string, "read" | "write" | number>> = {
  "std:fs/promises": { readFile: "read", writeFile: "write" },
  "std:fs": { readFileSync: "read", writeFileSync: "write" },
  "std:child_process": { spawnSync: 2, execFileSync: 2, execSync: 1 },
};

const isEncoding = (p: Extract<Expr, { kind: "object" }>["props"][number]) => (p.kind === "property" && p.key === "encoding") || (p.kind === "shorthand" && p.name === "encoding");

// The encoding an options object names: its text, null for `encoding: null`, or undefined when
// it isn't a literal, or the object holds anything else and `others` doesn't allow it.
function encodingOf(o: Extract<Expr, { kind: "object" }>, others = false): string | null | undefined {
  const named = o.props.filter(isEncoding);
  if (named.length !== 1 || (!others && o.props.length > 1)) return undefined;
  const prop = named[0]!;
  if (prop.kind !== "property") return undefined;
  if (prop.value.kind === "null") return null;
  return prop.value.kind === "string" ? prop.value.value : undefined;
}

// What a std module's members are read as, by name.
const valuesOf = (m: Module) => STD_VALUES[m.path.replace(/^std:/, "")] ?? {};

// The names a binding pattern binds.
function bindings(pattern: unknown): string[] {
  if (Array.isArray(pattern)) return pattern.flatMap(bindings);
  if (typeof pattern !== "object" || pattern === null) return [];
  const p = pattern as Record<string, unknown>;
  if (p.kind === "ident") return [p.name as string];
  return Object.entries(p).flatMap(([k, x]) => (k === "default" || k === "key" ? [] : bindings(x)));
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
export function renameIn(ids: Ids, v: unknown, to: (name: string) => string | undefined, seen: Set<unknown> = new Set<unknown>()) {
  if (typeof v !== "object" || v === null || seen.has(v)) return;
  seen.add(v);
  if (Array.isArray(v)) return v.forEach((x) => renameIn(ids, x, to, seen));
  const node = v as Record<string, unknown>;
  const renamed = (name: string) => {
    const [head, ...rest] = name.split(".");
    const as = to(head!);
    return as === undefined ? name : [as, ...rest].join(".");
  };
  if (node.kind === "shorthand") {
    const as = to(node.name as string);
    // `{ x }` keeps its key while its value takes the new name.
    if (as !== undefined) Object.assign(node, { kind: "property", key: node.name, value: { id: nextId(ids), kind: "ident", name: as, start: node.start, end: node.end } });
  } else if (typeof node.name === "string" && NAMED.has(node.kind as string)) node.name = renamed(node.name);
  if (Array.isArray(node.typeParams)) for (const p of node.typeParams as { name: string }[]) p.name = renamed(p.name);
  Object.values(node).forEach((x) => renameIn(ids, x, to, seen));
}

// A syntax tree as text, its keys in order and without its spans.
function shapeOf(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(shapeOf).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).filter((k) => k !== "start" && k !== "end" && k !== "id").sort().map((k) => `${k}:${shapeOf((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return typeof v === "bigint" ? `${v}n` : JSON.stringify(v) ?? "";
}
