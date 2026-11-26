import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { fileEnd, fileStart, type Compilation } from "./compilation.fsh";
import { dependencyLib, dependencyOf, packageOf, resolvePackages, type Package as FishPackage } from "./dependencies.fsh";
import { CompileError, type Source } from "./diag.fsh";
import { NODE_MODULES } from "./survey.fsh";
import { jsDeclaration, jsOverloads, referenced } from "./js.fsh";
import { DeclarationReader, findTypings, type Declared, type Exports } from "./typings.fsh";
import { parse, type ClassMember, type ClassNode, type Declarator, type EnumMember, type Expr, type Func, type Interface, type MatchArm, type ObjectProp, type Param, type Pattern, type PatternProp, type Span, type Specifier, type Stmt, type SwitchCase, type TupleElement, type TypeAlias, type TypeMember, type TypeNode, type TypeParam } from "./parser.fsh";
import { fishFiles } from "./fmt.fsh";
import { MANIFEST, type RustDependency } from "./manifest.fsh";
import { HANDLE, RUST_NAME, rustSymbol, type RustTables } from "./rust.fsh";
import { ENGINE_HOOK, STD, STD_MODULES, STD_ONLY, STD_VALUES, stdModule, stdModuleNames } from "./std.fsh";
import { refuseCompat } from "./migrate.fsh";
import { unsupported } from "./unsupported.fsh";
import { dup, forEachChild, nextId, nodeIdOf, NodeMap, Rewrites, shiftSpansStmt, shiftSpansStmts, walk, walkWhile, type AnyNode, type Ids } from "./nodes.fsh";
import { cloneClassMember, cloneExpr, cloneStmt, rebuiltStmts, type Replacements } from "./rebuild.fsh";
import { forEachNamedChild, quoteTree, type QuoteValue } from "./walk.fsh";
import { FILE_SPAN } from "./program.fsh";

// A program spread over files: the entry and every file it imports, each parsed once with its own
// offset range, so a position anywhere in the program says which file it is in.

// `targets` is the file each import and re-export names.
// `globals`: the std modules a file names as globals, as `os` in `os.hostname()`, without
// importing them.
// `whole`: a package's module an import names whole, as a namespace, reached through its name.
// `owner`: on a Fish package's lib, the package, whose other files' exports are private to it.
// `pkg`: the directory of the Fish package a file belongs to, when the program has a fish.toml.
// The module each import and re-export names, by the statement; named apart so the type can hold
// the module type it is part of.
export type Targets = NodeMap<Stmt, Module>;
export type Module = { path: string; file: string; base: usize; src: string; statements: Stmt[]; targets: Targets; globals: Map<string, Module>; whole?: boolean; owner?: { name: string; dir: string; lib: string }; pkg?: string };
// `packages`: each package specifier the program imports, by the directory its import resolves
// from, its index naming it in the bundle.
export type Package = { specifier: string; dir: string; at: Span };
// `rust`: each Rust crate the program imports, with the directory of the Fish package listing it.
// `links` is what linking made of each file, kept once the program is linked.
export type Loaded = { modules: Module[]; sources: Source[]; packages: Package[]; rust: RustCrate[]; links?: Linked[] };
export type RustCrate = { dependency: RustDependency; dir: string };

// What reads a file the program imports before the disk does: an editor's unsaved text, or
// undefined for a file it doesn't hold.
type Reader = ((path: string) => string | undefined) | undefined;
type Namespace = Extract<Stmt, { kind: "namespace" }>;
// What an import from a package is gathering: the declarations of the names it imports, each by
// the name it is declared under here, and the names those refer to, still to declare.
type Gathering = { reader: DeclarationReader; specifier: string; index: usize; statements: Stmt[]; declaredHere: Map<string, Declared>; pending: { declared: Declared; name: string }[] };

/** @throws {IoError} */
function readWith(read: Ref<Reader>, path: string): string {
  const given = read !== undefined ? read(path) : undefined;
  return given !== undefined ? given : readFileSync(path, "utf8");
}

// Loads `entry`, given as `src` when it is already read, and every file it imports, each read by
// `read`, before the disk: an editor's unsaved text is newer than the disk's. The program's files are noted in the
// compilation's `files`.
/** @throws {CompileError | Error | IoError} */
export function load(compilation: Mut<Compilation>, entry: string, src: string = readFileSync(entry, "utf8"), read?: (path: string) => string | undefined, fish?: FishPackage[]): Loaded {
  let loader = new Loader(entry, fish !== undefined ? fish : resolvePackages(entry, compilation.session.locking));
  try {
    loader.visit(compilation, read, entry, src, entry);
  } catch (e) {
    if (e instanceof CompileError) e.sources = withStd(loader.sources);
    throw e;
  }
  for (const m of loader.modules) compilation.files.push({ base: m.base, file: m.base === 0 ? basename(entry) : m.file, src: m.src, std: m.path.startsWith("std:") });
  if (compilation.session.timings !== undefined) for (const f of compilation.files) compilation.session.timings!.names.set(f.base, f.file.clone());
  // std's text sits past every file's, so it goes last, where an offset past them finds it.
  const sources = withStd(loader.sources);
  return { modules: loader.modules, sources, packages: loader.packages, rust: loader.rust };
}

function withStd(sources: Ref<Source[]>): Source[] {
  let out: Source[] = [];
  for (const s of sources) out.push({ base: s.base, src: s.src, file: s.file });
  out.push({ base: STD.base, src: STD.src, file: STD.file });
  return out;
}

// A program's files as loading finds them, each by the key it is known by: its real path, or
// `std:`, `dts:`, `pkg:` or `rust:` and a name for one that isn't a file of the program.
class Loader {
  entry: string;
  fish: FishPackage[] | undefined;
  modules: Module[] = [];
  sources: Source[] = [];
  byPath: Map<string, Module> = new Map<string, Module>();
  // `packages`: each package specifier imported, by the directory its import resolves from.
  packages: Package[] = [];
  // Each file's `declare module "rust:<crate>"` blocks, by its real path, and the crates imported.
  rustBlocks: Map<string, Namespace[]> = new Map<string, Namespace[]>();
  rust: RustCrate[] = [];

  constructor(entry: string, fish: FishPackage[] | undefined) {
    this.entry = entry;
    this.fish = fish;
  }

  /** @throws {CompileError | Error | IoError} */
  std(this: Mut<this>, cx: Mut<Compilation>, read: Ref<Reader>, name: string): Module {
    const text = STD_MODULES[name];
    return this.visit(cx, read, `std:${name}`, text !== undefined ? text : "", name === "Bun" ? "bun" : `std:${name}`);
  }

  /** @throws {CompileError | Error | IoError} */
  visit(this: Mut<this>, cx: Mut<Compilation>, read: Ref<Reader>, path: string, text: string, file: string): Module {
    const std = path.startsWith("std:");
    if (!std) cx.looked.push(resolve(path));
    const key = std ? path : realpathSync(path);
    const known = this.byPath.get(key);
    if (known !== undefined) return known;
    const base = this.modules.length * (FILE_SPAN as usize);
    if (base > 0) this.sources.push({ base, src: text, file });
    if (text.length >= (FILE_SPAN as usize)) throw new CompileError("E0909", `'${file}' is larger than the 16 MiB a source file may be`, base, base);
    let parsed: Stmt[] = [];
    try {
      // A TS-compat file isn't compiled, whether or not it parses.
      if (!std) refuseCompat(text, this.fish !== undefined ? packageOf(this.fish, key)?.manifest.edition : undefined);
      const parsing = fileStart(cx.session);
      parsed = parse(text, cx.ids);
      fileEnd(cx.session, base, "parse", parsing);
    } catch (e) {
      // A parse or edition error's position is in its own file's text.
      if (e instanceof CompileError) shiftError(e, base);
      throw e;
    }
    if (base > 0) shiftSpansStmts(parsed, base);
    if (!std) lowerImportMeta(cx.ids, parsed, key, this.modules.length === 0);
    // A Rust crate's declarations are reached by importing `rust:<crate>`, not as this file's own.
    let statements: Stmt[] = [];
    let blocks: Namespace[] = [];
    while (parsed.length > 0) {
      const s = parsed.shift()!;
      if (!isRustBlock(s)) statements.push(s);
      else {
        const block = rustBlockOf(s);
        if (block !== undefined) blocks.push(block);
      }
    }
    if (!std) this.rustBlocks.set(key, blocks);
    const pkg = this.fish !== undefined && !std ? packageOf(this.fish, key)?.dir : undefined;
    // The module is known before its imports are, so a cycle of imports finds it; its imports
    // and globals are filled in once they are loaded.
    const made: Module = { path: key, file, base, src: text, statements: [], targets: noTargets(), globals: new Map<string, Module>(), pkg };
    const index = this.modules.length;
    this.byPath.set(key, handleOf(made));
    this.modules.push(made);
    let targets = noTargets();
    for (const s of statements) {
      const specifier = specifierOf(s);
      if (specifier === undefined) continue;
      const target = this.target(cx, read, path, key, s, specifier, statements);
      // The map holds a copy of the statement it is keyed by, as only its id is read.
      targets.set(cloneStmt(s), target);
    }
    let globals = new Map<string, Module>();
    for (const name of globalsIn(statements)) {
      const global = this.std(cx, read, name);
      globals.set(name, global);
    }
    this.modules[index]!.statements = statements;
    this.modules[index]!.targets = targets;
    this.modules[index]!.globals = globals;
    return handleOf(this.modules[index]!);
  }

  // The module an import or re-export in the file at `path`, known as `key`, names.
  /** @throws {CompileError | Error | IoError} */
  target(this: Mut<this>, cx: Mut<Compilation>, read: Ref<Reader>, path: string, key: string, s: Ref<Stmt>, specifier: string, importing: Ref<Stmt[]>): Module {
    const std = path.startsWith("std:");
    if (specifier === "std:engine") {
      if (!cx.session.engineHook) throw new CompileError("E0903", "'std:engine' is the compiler's own test hook, which a program can't import; JS runs only as a package's code", s.start, s.end);
      return this.visit(cx, read, "std:engine", ENGINE_HOOK, "std:engine");
    }
    if (specifier.startsWith("rust:")) return this.rustModule(cx, read, key, specifier.slice("rust:".length as i64), s);
    // A bare name the importing file's own fish.toml depends on is that Fish package, even one
    // Node also has; `std:` and `node:` always mean the built-in, and any other bare name is npm's.
    const lib = this.fish !== undefined && !std && !/^(\.\.?(\/|$)|node:|std:)/.test(specifier) ? dependencyLib(this.fish, path, specifier, { start: s.start, end: s.end }) : undefined;
    if (lib !== undefined) {
      const text = readWith(read, lib);
      let target = this.visit(cx, read, lib, text, relative(dirname(this.entry), lib));
      const holder = this.fish !== undefined ? packageOf(this.fish, lib) : undefined;
      if (holder !== undefined) {
        target.owner = { name: holder.manifest.name, dir: holder.dir, lib: holder.manifest.lib };
        // The module the program is linked from is the stored one, which in Fish `visit` gave a
        // copy of, so it learns its package too.
        for (let i: usize = 0; i < this.modules.length; i++) {
          if (this.modules[i]!.path === target.path) this.modules[i]!.owner = { name: holder.manifest.name, dir: holder.dir, lib: holder.manifest.lib };
        }
      }
      return target;
    }
    const named = stdModule(specifier);
    if (named !== undefined) return this.std(cx, read, named);
    // Std's own modules had `fish:` names once; saying where one went beats npm not having it.
    if (specifier.startsWith("fish:")) {
      const moved = specifier.slice("fish:".length as i64);
      const now = stdModule(`std:${moved}`) !== undefined ? `; this one is 'std:${moved}'` : "";
      throw new CompileError("E0902", `'${specifier}' names no module: std's modules are named 'std:'${now}`, s.start, s.end);
    }
    if (specifier.startsWith("std:")) throw new CompileError("E0902", `std has no module named '${specifier.slice("std:".length as i64)}'; it has ${stdModuleNames().map((n) => `'${n}'`).join(", ")}`, s.start, s.end);
    if (!/^\.\.?(\/|$)/.test(specifier)) return this.packageModule(cx, path, specifier, s, importing);
    // A dependency builds from its own files, which its checksum covers, and reaches others by name,
    // whether the path climbs out as written or through a link.
    const owner = this.fish !== undefined && !std ? dependencyOf(this.fish, path) : undefined;
    const ownerDir = owner !== undefined ? owner.dir : undefined;
    const ownerName = owner !== undefined ? owner.manifest.name : "";
    if (outside(ownerDir, join(dirname(realpathSync(path)), specifier))) throw escaped(specifier, ownerName, s);
    const target = resolveSpecifier(path, specifier, { start: s.start, end: s.end }, cx.looked);
    if (outside(ownerDir, realpathSync(target))) throw escaped(specifier, ownerName, s);
    // Another package's files are reached through its lib, by name, even from a directory
    // that holds it.
    if (this.fish !== undefined && !std) {
      const holder = packageOf(this.fish, target);
      if (holder !== undefined && !samePackage(holder.dir, this.fish, path)) throw new CompileError("E0903", `'${specifier}' is a file inside the package '${holder.manifest.name}'; import it by name, as '${holder.manifest.name}'`, s.start, s.end);
    }
    const text = readWith(read, target);
    const shown = relative(dirname(this.entry), target);
    return this.visit(cx, read, target, text, shown !== "" ? shown : target);
  }

  // A declaration file a package's declarations come from: given its own place in the program's
  // offsets, so a message about a declaration shows its line.
  /** @throws {IoError} */
  declarationFile(this: Mut<this>, file: string, given?: string): usize {
    const key = `dts:${file}`;
    const known = this.byPath.get(key);
    if (known !== undefined) return known.base;
    const text = given !== undefined ? given : readFileSync(file, "utf8");
    const base = this.modules.length * (FILE_SPAN as usize);
    const shown = relative(dirname(this.entry), file);
    this.sources.push({ base, src: text, file: shown });
    const made: Module = { path: key, file: shown, base, src: text, statements: [], targets: noTargets(), globals: new Map<string, Module>() };
    this.byPath.set(key, handleOf(made));
    this.modules.push(made);
    return base;
  }

  // What an import from a package names, as a module of its own: the declarations of the names it
  // imports, each where the package declares it, as JS declarations.
  /** @throws {CompileError | IoError} */
  packageModule(this: Mut<this>, cx: Mut<Compilation>, from: string, specifier: string, s: Ref<Stmt>, importing: Ref<Stmt[]>): Module {
    let reader = new DeclarationReader();
    const exports = packageExports(cx.ids, reader, from, specifier, s, this.entry);
    const dir = dirname(realpathSync(from));
    let found: usize | undefined = undefined;
    for (let i: usize = 0; i < this.packages.length; i++) {
      if (found === undefined && this.packages[i]!.specifier === specifier && this.packages[i]!.dir === dir) found = i;
    }
    let index: usize = 0;
    if (found !== undefined) index = found;
    else {
      index = this.packages.length;
      this.packages.push({ specifier, dir, at: { start: s.start, end: s.end } });
    }
    if (s.kind === "exportAll") throw new CompileError("E0801", "re-exporting all of a package isn't supported yet; re-export the names it has by name", s.start, s.end);
    // A package imported whole, or a default export that is a namespace, is reached through its
    // name: the members the file uses, as `ns.f`, are what it imports.
    const defaulted = s.kind === "import" && s.default !== undefined ? exports.names.get("default") : undefined;
    const spaced = defaulted !== undefined && unwrapped(defaulted.at).kind === "namespace";
    const whole = s.kind === "import" ? (s.namespace !== undefined ? s.namespace : spaced ? s.default : undefined) : undefined;
    // Each name imported is exported by the module; the types its declaration names, and theirs,
    // are declared in it too, as they are where the package declares them.
    // The names imported come first, so one also referred to is exported.
    let g: Gathering = { reader, specifier, index, statements: [], declaredHere: new Map<string, Declared>(), pending: [] };
    if (s.kind === "import" && s.named !== undefined) {
      for (const sp of s.named) {
        const declared = exports.names.get(sp.name);
        if (declared !== undefined) this.add(cx, g, declared, sp.name, true, sp, sp.name);
      }
    } else if (s.kind === "exportNamed") {
      for (const sp of s.specifiers) {
        const declared = exports.names.get(sp.name);
        if (declared !== undefined) this.add(cx, g, declared, sp.name, true, sp, sp.name);
      }
    }
    // A member it lacks may be another name's, under a binding of its own; one reached through
    // the namespace is refused when the program is linked.
    if (whole !== undefined) {
      for (const m of membersUsed(importing, whole)) {
        const declared = exports.names.get(m.name);
        if (declared !== undefined) this.add(cx, g, declared, m.name, true, m, m.name);
      }
    }
    // A default export that isn't a namespace is a declaration of its own, exported as the default.
    if (defaulted !== undefined && !spaced) {
      // A named declaration keeps its name, which it may use of itself.
      const own = declaredName(unwrapped(defaulted.at));
      const local = own !== undefined && !g.declaredHere.has(own) ? own : `${specifier} default`;
      this.add(cx, g, defaulted, local, false, { start: s.start, end: s.end }, "default");
      g.statements.push({ id: nextId(cx.ids), kind: "exportNamed", typeOnly: false, specifiers: [{ id: nextId(cx.ids), name: local, alias: "default", typeOnly: false, start: s.start, end: s.end }], module: undefined, start: s.start, end: s.end });
    }
    while (g.pending.length > 0) {
      const next = g.pending.shift()!;
      const at: Span = { start: next.declared.at.start, end: next.declared.at.end };
      this.add(cx, g, next.declared, next.name, false, at, next.name);
    }
    const path = `pkg:${this.modules.length}`;
    const made: Module = { path, file: specifier, base: this.modules.length * (FILE_SPAN as usize), src: "", statements: g.statements, targets: noTargets(), globals: new Map<string, Module>(), whole: whole !== undefined };
    const handle = handleOf(made);
    this.byPath.set(path, handleOf(made));
    this.modules.push(made);
    return handle;
  }

  // Declares `name` in the package's module, as the declaration `declared` the package has.
  /** @throws {CompileError | IoError} */
  add(this: Mut<this>, cx: Mut<Compilation>, g: Mut<Gathering>, declared: Declared, name: string, exported: boolean, at: Ref<Span>, given: string): void {
    const had = g.declaredHere.get(name);
    if (had !== undefined) {
      if (had.at.id !== declared.at.id) throw new CompileError("E0907", `'${g.specifier}' declares '${name}' in two places Fish would bring together; import from its own file instead`, at.start, at.end);
      return;
    }
    const [kept, here] = dup(declared);
    g.declaredHere.set(name, kept);
    let made: Stmt | undefined = undefined;
    try {
      made = jsDeclaration(cx.ids, here, g.reader.statementsOf(here), name, g.specifier, g.index, at, given);
    } catch (e) {
      // A declaration only referred to that Fish can't take is left out, refused where named.
      if (exported || !(e instanceof CompileError)) throw e;
    }
    if (made === undefined) return;
    let overloads = jsOverloads(cx.ids, here, g.reader.statementsOf(here), made, name, g.specifier, g.index);
    // The first signature lists the others, which are declared beside it too.
    let listed: Func[] = [];
    let group: Stmt[] = [];
    while (overloads.length > 0) {
      const [one, other] = dup(overloads.shift()!);
      listed.push(one);
      group.push(other);
    }
    if (listed.length > 0 && made.kind === "function" && made.js !== undefined) made.js.overloads = listed;
    group.unshift(made);
    const refers = referenced(group);
    const base = this.declarationFile(here.file);
    // Each is shifted on its own, as the first's shift also reaches the others it lists.
    let shifted: Stmt[] = [];
    while (group.length > 0) shifted.push(shiftSpansStmt(group.shift()!, base));
    const first = shifted.shift()!;
    if (exported) {
      const start = first.start;
      const end = first.end;
      g.statements.push({ id: nextId(cx.ids), kind: "export", body: first, start, end });
    } else g.statements.push(first);
    while (shifted.length > 0) g.statements.push(shifted.shift()!);
    for (const n of refers) {
      const found = g.reader.resolve(cx.ids, here, n);
      if (found !== undefined) g.pending.push({ declared: found, name: n });
    }
  }

  // The blocks in a file of a package, read for them when the program doesn't import the file.
  /** @throws {CompileError | IoError} */
  blocksIn(this: Mut<this>, cx: Mut<Compilation>, read: Ref<Reader>, file: string): Namespace[] {
    const key = realpathSync(file);
    const known = this.rustBlocks.get(key);
    if (known !== undefined) return known;
    const text = readWith(read, file);
    this.rustBlocks.set(key, []);
    if (!text.includes("rust:")) return [];
    const base = this.declarationFile(file, text);
    let parsed: Stmt[] = [];
    try {
      parsed = parse(text, cx.ids);
    } catch (e) {
      if (e instanceof CompileError) shiftError(e, base);
      throw e;
    }
    shiftSpansStmts(parsed, base);
    let blocks: Namespace[] = [];
    while (parsed.length > 0) {
      const s = parsed.shift()!;
      if (!isRustBlock(s)) continue;
      const block = rustBlockOf(s);
      if (block !== undefined) blocks.push(block);
    }
    const [kept, given] = dup(blocks);
    this.rustBlocks.set(key, kept);
    return given;
  }

  // What `import { f } from "rust:<crate>"` names: the functions the importing file's package
  // declares for the crate, which its fish.toml must list.
  /** @throws {CompileError | IoError} */
  rustModule(this: Mut<this>, cx: Mut<Compilation>, read: Ref<Reader>, from: string, crate: string, s: Ref<Stmt>): Module {
    const pkg = this.fish !== undefined ? packageOf(this.fish, from) : undefined;
    let dependency: RustDependency | undefined = undefined;
    if (pkg !== undefined && pkg.manifest.rustDependencies !== undefined) {
      for (const d of pkg.manifest.rustDependencies) if (dependency === undefined && d.name === crate) dependency = copiedDependency(d);
    }
    if (pkg === undefined || dependency === undefined) throw new CompileError("E1004", `'${crate}' isn't a Rust dependency of this package; list it under [rust-dependencies] in ${MANIFEST}, as in ${crate} = "1.0"`, s.start, s.end);
    const dir = pkg.dir;
    const key = `rust:${dir}:${crate}`;
    const known = this.byPath.get(key);
    if (known !== undefined) return known;
    let problems: string[] = [];
    let blocks: Namespace[] = [];
    for (const file of fishFiles(dir, problems)) {
      // The blocks a file has are kept for the next crate, so only the matching ones are taken.
      let matching = this.blocksIn(cx, read, file).filter((b) => b.name === `rust:${crate}`);
      while (matching.length > 0) blocks.push(matching.shift()!);
    }
    if (blocks.length === 0) throw new CompileError("E1004", `no file of this package declares the functions of '${crate}'; declare them in one, as in 'declare module "rust:${crate}" { export function f(x: i64): i64; }'`, s.start, s.end);
    if (blocks.length > 1) throw new CompileError("E1004", `'rust:${crate}' is declared twice in this package; declare its functions in one place`, blocks[1]!.start, blocks[1]!.end);
    this.rust.push({ dependency, dir });
    let statements: Stmt[] = [];
    const block = blocks.shift()!;
    if (block.body !== undefined) statements = block.body.map((st) => rustFunction(cx.ids, cx.rust, crate, st));
    const made: Module = { path: key, file: `rust:${crate}`, base: this.modules.length * (FILE_SPAN as usize), src: "", statements, targets: noTargets(), globals: new Map<string, Module>() };
    const handle = handleOf(made);
    this.byPath.set(key, handleOf(made));
    this.modules.push(made);
    return handle;
  }
}

// Whether the package holding `file` is the one whose directory is `dir`.
/** @throws {IoError} */
function samePackage(dir: string, fish: Ref<FishPackage[]>, file: string): boolean {
  const from = packageOf(fish, file);
  return from !== undefined && from.dir === dir;
}

function copiedDependency(d: Ref<RustDependency>): RustDependency {
  const features: Ref<string[] | undefined> = d.features;
  return { name: d.name, start: d.start, end: d.end, version: d.version, features: features !== undefined ? features.slice() : undefined, defaultFeatures: d.defaultFeatures, path: d.path, git: d.git, rev: d.rev, tag: d.tag, branch: d.branch };
}

// What an importer holds of the module it names: where it is, with none of its statements or of
// the modules it imports in turn, which the loader's list holds once. A reader of a target takes
// its path or its base and finds the module itself in that list; a copy of the module in every
// importer held a program's whole tree several times over.
function handleOf(m: Ref<Module>): Module {
  let out: Module = { path: m.path, file: m.file, base: m.base, src: "", statements: [], targets: noTargets(), globals: new Map<string, Module>(), whole: m.whole, pkg: m.pkg };
  if (m.owner !== undefined) out.owner = { name: m.owner.name, dir: m.owner.dir, lib: m.owner.lib };
  return out;
}

function noTargets(): Targets {
  const targets: Targets = new NodeMap<Stmt, Module>();
  return targets;
}

// Whether `file` is outside the dependency package whose directory is `dir`.
function outside(dir: string | undefined, file: string): boolean {
  return dir !== undefined && !file.startsWith(dir + "/");
}

function escaped(specifier: string, name: string, s: Ref<Stmt>): CompileError {
  return new CompileError("E0903", `'${specifier}' leads outside the package '${name}'; a package imports its own files by path, and other packages by name`, s.start, s.end);
}

// The name a declaration is written with, if it has one.
function declaredName(s: Ref<Stmt>): string | undefined {
  if (s.kind === "function" || s.kind === "enum" || s.kind === "typeAlias" || s.kind === "interface" || s.kind === "namespace" || s.kind === "importEquals" || s.kind === "exportAsNamespace") return s.name;
  if (s.kind === "class") return s.name;
  return undefined;
}

// `declare module "rust:<crate>" { ... }`.
function isRustBlock(s: Ref<Stmt>): boolean {
  return s.kind === "declare" && s.body.kind === "namespace" && s.body.quoted && s.body.name.startsWith("rust:");
}

// The namespace a `declare` holds.
function rustBlockOf(s: Stmt): Namespace | undefined {
  if (s.kind !== "declare") return undefined;
  const body = s.body;
  return body.kind === "namespace" ? body : undefined;
}

// A function or class a Rust module declares, exported, its bodies the crate's: under the Fish
// name, at the Rust path `@rust` gives from the crate's root, or else at the same name there.
/** @throws {CompileError} */
function rustFunction(ids: Mut<Ids>, rust: Mut<RustTables>, crate: string, s: Ref<Stmt>): Stmt {
  const f: Ref<Stmt> = s.kind === "export" ? s.body : s;
  if (f.kind === "class") return { id: nextId(ids), kind: "export", body: rustClass(ids, rust, crate, f), start: s.start, end: s.end };
  if (f.kind !== "function") throw new CompileError("E1004", `a Rust module declares the crate's functions and types, as in 'export function f(x: i64): i64;' or 'export class Counter { ... }'`, s.start, s.end);
  if (f.body !== undefined) throw new CompileError("E1004", "a Rust function is declared without a body; the crate has its body", f.start, f.end);
  if (!RUST_NAME.test(f.name)) throw new CompileError("E1004", `'${f.name}' can't name a Rust function; use letters, digits and '_'`, f.start, f.end);
  const path = f.decorators !== undefined ? rustPath(f.decorators, f.name, "function") : f.name;
  const [declared, keyed] = dup<Func>({ ...f, id: nextId(ids), decorators: undefined });
  rust.names.set(keyed, { crate, path, symbol: rustSymbol(crate, path) });
  return { id: nextId(ids), kind: "export", body: declared, start: s.start, end: s.end };
}

// A Rust type declared as a class: a handle holding the boxed Rust value, whose constructor,
// statics and methods are the type's.
/** @throws {CompileError} */
function rustClass(ids: Mut<Ids>, rust: Mut<RustTables>, crate: string, c: Ref<Extract<Stmt, { kind: "class" }>>): Stmt {
  if (c.name === undefined || !RUST_NAME.test(c.name)) throw new CompileError("E1004", "a Rust type is a named class, its name letters, digits and '_'", c.start, c.end);
  if (c.typeParams.length > 0) throw new CompileError("E1004", "generic Rust types can't cross to Fish yet", c.typeParams[0]!.start, c.typeParams[0]!.end);
  if (c.extends !== undefined) throw new CompileError("E1004", "a Rust type's class can't extend another", c.extends.start, c.extends.end);
  if (c.implements.length > 0) throw new CompileError("E1004", "a Rust type's class can't implement an interface yet", c.implements[0]!.start, c.implements[0]!.end);
  const path = rustPath(c.decorators, c.name, "type");
  let members: ClassMember[] = [];
  for (const m of c.members) members.push(rustMember(ids, rust, crate, path, m));
  // The one field, the address of the boxed value, which nothing in Fish reads; the IR holds it
  // as a pointer. It is a number to the checker, so the handle crosses threads as its type does.
  const at = { start: c.start, end: c.start };
  const handle: ClassMember = { id: nextId(ids), kind: "field", name: HANDLE, optional: false, definite: false, type: { id: nextId(ids), kind: "ref", name: "usize", args: [], ...at }, init: undefined, modifiers: [], decorators: [], ...at };
  let all: ClassMember[] = [handle];
  while (members.length > 0) all.push(members.shift()!);
  const [declared, keyed] = dup<Extract<Stmt, { kind: "class" }>>({ ...c, id: nextId(ids), decorators: [], members: all });
  rust.classNodes.set(keyed, { crate, path, name: c.name });
  return declared;
}

// A member of a Rust type's class, under the Rust path of the type's own.
/** @throws {CompileError} */
function rustMember(ids: Mut<Ids>, rust: Mut<RustTables>, crate: string, path: string, m: Ref<ClassMember>): ClassMember {
  const named = m.kind === "constructor" ? "new" : m.kind === "method" && typeof m.name === "string" ? m.name : undefined;
  if (named === undefined || (m.kind !== "constructor" && m.kind !== "method") || (m.kind === "method" && (m.optional || m.generator || m.typeParams.length > 0))) {
    throw new CompileError("E1004", "a Rust type's class declares a constructor, static functions and methods, without bodies; Rust fields aren't read from Fish", m.start, m.end);
  }
  if (m.kind === "method" && m.name === "constructor") throw new CompileError("E0407", "'constructor' can't be the name of a method", m.start, m.end);
  if (m.body !== undefined) throw new CompileError("E1004", "a Rust type's members are declared without bodies; the crate has them", m.start, m.end);
  if (m.modifiers.some((x) => x !== "static")) throw new CompileError("E1004", "a Rust type's members take no modifiers but 'static'", m.start, m.end);
  if (m.kind === "method" && !RUST_NAME.test(named)) throw new CompileError("E1004", `'${named}' can't name a Rust function; use letters, digits and '_'`, m.start, m.end);
  const member = rustPath(m.decorators, named, "member");
  let copy = cloneClassMember(m);
  const id = nextId(ids);
  if (copy.kind === "method") {
    copy.id = id;
    copy.decorators = [];
    copy.body = [];
  } else if (copy.kind === "constructor") {
    copy.id = id;
    copy.decorators = [];
    copy.body = [];
  }
  const [declared, keyed] = dup(copy);
  rust.names.set(keyed, { crate, path: `${path}::${member}`, symbol: rustSymbol(crate, `${path}::${member}`) });
  return declared;
}

// The Rust path of a declaration from its decorators: `@rust("path")` from the crate's root, or
// for a member from its type.
/** @throws {CompileError} */
function rustPath(decorators: Ref<Expr[]>, name: string, what: "function" | "type" | "member"): string {
  let path = name;
  for (const d of decorators) {
    // Fish moves values between threads, so a Rust type that isn't Send has no place yet.
    if (what === "type" && d.kind === "member" && d.object.kind === "ident" && d.object.name === "rust" && d.name === "local") {
      throw new CompileError("E1004", "Rust types that aren't Send aren't supported yet: Fish moves values between threads, so a Rust type must be Send", d.start, d.end);
    }
    const only = what === "type" ? "'@rust(\"path::to::Type\")'" : what === "member" ? "'@rust(\"name\")'" : "'@rust(\"path::to::item\")'";
    if (d.kind !== "call" || d.callee.kind !== "ident" || d.callee.name !== "rust") throw new CompileError("E1004", `a Rust ${what} takes only ${only}`, d.start, d.end);
    if (d.args.length !== 1) throw new CompileError("E1004", `@rust takes the item's path in the crate as a string literal, as in @rust("util::mul")`, d.start, d.end);
    const arg: Ref<Expr> = d.args[0]!;
    if (arg.kind !== "string") throw new CompileError("E1004", `@rust takes the item's path in the crate as a string literal, as in @rust("util::mul")`, d.start, d.end);
    const parts = arg.value.split("::");
    if (!parts.every((part) => RUST_NAME.test(part)) || (what === "member" && parts.length > 1)) {
      throw new CompileError("E1004", what === "member" ? "a member's Rust name is one name, as in \"with_value\"" : "this isn't a Rust path; write one from the crate's root, as in \"util::mul\"", arg.start, arg.end);
    }
    path = arg.value;
  }
  return path;
}

// A statement under `declare` or `export`.
function unwrapped(s: Ref<Stmt>): Ref<Stmt> {
  if (s.kind === "declare") return unwrapped(s.body);
  if (s.kind === "export") return unwrapped(s.body);
  return s;
}

// The members of a name a file reaches, as `ns.f`, each where it is first reached.
function membersUsed(statements: Ref<Stmt[]>, name: string): { name: string; start: usize; end: usize }[] {
  let found: { name: string; start: usize; end: usize }[] = [];
  let seen = new Set<string>();
  walk({ of: "stmts", node: statements }, (x) => {
    if (x.of !== "expr") return;
    const n = x.node;
    if (n.kind === "member" && n.object.kind === "ident" && n.object.name === name && !seen.has(n.name)) {
      seen.add(n.name);
      found.push({ name: n.name, start: n.start, end: n.end });
    }
  });
  return found;
}

// The exports of the package an import names, once each name it imports is found among them;
// a name not found is refused saying what the package exports.
/** @throws {CompileError | IoError} */
function packageExports(ids: Mut<Ids>, reader: Mut<DeclarationReader>, from: string, specifier: string, s: Ref<Stmt>, entry: string): Exports {
  // A name a Node module has is that module, unless an npm package of that name is installed, as
  // a bundler takes it.
  const found = specifier.startsWith("node:") || specifier.startsWith("std:") ? undefined : findTypings(from, specifier);
  if (found === undefined || ("missing" in found && NODE_MODULES.has(specifier.split("/")[0]!))) {
    throw new CompileError("E0908", `'${specifier}' is a Node module Fish's std doesn't have yet`, s.start, s.end);
  }
  if ("missing" in found) throw new CompileError("E0902", found.missing, s.start, s.end);
  const exports = reader.exportsOf(ids, found.file, specifier);
  if (typeof exports === "string") throw new CompileError("E0902", exports, s.start, s.end);
  let names: string[] = [];
  if (s.kind === "import") {
    if (s.default !== undefined) names.push("default");
    if (s.named !== undefined) for (const sp of s.named) names.push(sp.name);
  } else if (s.kind === "exportNamed") for (const sp of s.specifiers) names.push(sp.name);
  const missing = names.find((n) => !exports.names.has(n));
  if (missing !== undefined) {
    let known: string[] = [];
    for (const k of exports.names.keys()) known.push(k);
    known.sort();
    const listed = known.length === 0 ? "nothing" : known.slice(0, 12).map((n) => `'${n}'`).join(", ") + (known.length > 12 ? `, and ${known.length - 12} more` : "");
    const what = missing === "default" ? "a default export" : `'${missing}'`;
    // What a re-export couldn't reach may be where the name is.
    const unread = exports.problems.length > 0 ? `; ${exports.problems[0]}` : "";
    const at = specifierAt(s, missing);
    throw new CompileError("E0902", `'${specifier}' has no export ${what}; its declarations in '${relative(dirname(entry), found.file)}' export ${listed}${unread}`, at.start, at.end);
  }
  return exports;
}

// Where an import or re-export names `name`, or the statement when it names it as its default.
function specifierAt(s: Ref<Stmt>, name: string): Span {
  if (s.kind === "import" && s.named !== undefined) {
    for (const sp of s.named) if (sp.name === name) return { start: sp.start, end: sp.end };
  } else if (s.kind === "exportNamed") {
    for (const sp of s.specifiers) if (sp.name === name) return { start: sp.start, end: sp.end };
  }
  return { start: s.start, end: s.end };
}

// The std modules a file uses as globals: a member of a std module's name, as `os.hostname`,
// where the file neither declares nor imports that name.
function globalsIn(statements: Ref<Stmt[]>): string[] {
  let bound = new Set<string>();
  for (const s of statements) {
    if (s.kind === "import") {
      if (s.default !== undefined) bound.add(s.default);
      if (s.namespace !== undefined) bound.add(s.namespace);
      if (s.named !== undefined) for (const sp of s.named) bound.add(sp.alias !== undefined ? sp.alias : sp.name);
    } else if (s.kind === "export") for (const n of namesOf(s.body)) bound.add(n);
    else for (const n of namesOf(s)) bound.add(n);
  }
  let found: string[] = [];
  let seen = new Set<string>();
  walk({ of: "stmts", node: statements }, (x) => {
    if (x.of !== "expr") return;
    const n = x.node;
    if (n.kind === "member" && n.object.kind === "ident" && STD_NAMES.has(n.object.name) && !bound.has(n.object.name) && !seen.has(n.object.name)) {
      seen.add(n.object.name);
      found.push(n.object.name);
    }
  });
  return found;
}

// The names of std's modules a program may also write bare, as its table has them.
function bareNames(): Set<string> {
  let names = new Set<string>();
  for (const name of Object.keys(STD_MODULES)) if (!STD_ONLY.has(name)) names.add(name);
  return names;
}

const STD_NAMES = bareNames();

// The file a statement imports from, or re-exports from.
export function specifierOf(s: Ref<Stmt>): string | undefined {
  if (s.kind === "import" || s.kind === "exportAll") return s.module;
  if (s.kind === "exportNamed") return s.module;
  return undefined;
}

// The file a relative specifier names, as TypeScript resolves one: the extension may be left out
// or written as TypeScript's or JavaScript's, and a directory means its `index.fsh`. When none is
// found, the files looked for are added to `looked`.
/** @throws {CompileError | IoError} */
export function resolveSpecifier(from: string, specifier: string, at: Ref<Span>, looked: Mut<string[]>): string {
  if (!/^\.\.?(\/|$)/.test(specifier)) {
    throw new CompileError("E0901", `'${specifier}' isn't a path to a file; imports of packages aren't supported yet, so import another file with a relative path like './${specifier}'`, at.start, at.end);
  }
  const path = join(dirname(from), specifier);
  const bare = path.replace(/\.(ts|js|mts|mjs)$/, "");
  const candidates = path.endsWith(".fsh") ? [path] : bare !== path ? [`${bare}.fsh`] : [`${path}.fsh`, join(path, "index.fsh")];
  for (const c of candidates) if (existsSync(c) && statSync(c).isFile()) return c;
  for (const c of candidates) looked.push(resolve(c));
  const tried = candidates.map((c) => `'${relative(dirname(from), c)}'`).join(" and ");
  throw new CompileError("E0901", `can't find the file '${specifier}' imports from; looked for ${tried}`, at.start, at.end);
}

// A top-level declaration, under the name it has program-wide. A `fixed` one keeps its name: a C
// function, which two files may both declare, and the entry's `main` and exported functions.
// `file` is the index of the file declaring it, which with its name tells it from any other.
type Decl = { name: string; unique: string; fixed: boolean; file: usize };
// What an import binds: the module's index among the program's, and the name it exports.
type Import = { from: usize; name: string; at: Span };
export type Linked = {
  path: string;
  file: string;
  base: usize;
  pkg: string | undefined;
  index: usize;
  // The file's declarations with exports unwrapped, imports and re-exports left out.
  body: Stmt[];
  own: Map<string, Decl>;
  imports: Map<string, Import>;
  // What each exported name is: a name in the file, or another file's export.
  exports: Map<string, { local: string } | { from: usize; name: string }>;
  stars: usize[];
  used: Set<string>;
};

// The program the checker reads: every file's declarations, each file seeing only its own names
// and what it imports. A top-level name keeps its spelling unless that would mean something else
// in another file, when it takes a suffix telling the files apart (`helper-fsh2`), which messages leave
// out. Only the entry file keeps `export function`, which a library makes a C function.
// With `lenient`, an import of a name no file exports is left unlinked, as one an expansion of a
// macro has yet to make.
/** @throws {CompileError} */
export function flatten(compilation: Mut<Compilation>, loaded: Mut<Loaded>, library = false, lenient = false): Stmt[] {
  let indexOf = new Map<string, usize>();
  for (let i: usize = 0; i < loaded.modules.length; i++) indexOf.set(loaded.modules[i]!.path, i);
  let all: Linked[] = [];
  for (let i: usize = 0; i < loaded.modules.length; i++) {
    const l = linkOf(compilation.ids, loaded.modules, i, indexOf, library);
    all.push(l);
  }
  const modules: Ref<Module[]> = loaded.modules;
  for (const l of all) {
    for (const [alias, imp] of l.imports) {
      const name = imp.name;
      const at: Ref<Span> = imp.at;
      if (l.own.has(alias)) throw new CompileError("E0907", `'${alias}' is both imported and declared in this file; rename the import, as in 'import { ${name} as other${alias.slice(0, 1).toUpperCase()}${alias.slice(1)} }'`, at.start, at.end);
      if (exported(all, imp.from, name, new Set<string>()) !== undefined || lenient) continue;
      const from: Ref<Module> = modules[imp.from]!;
      // A std module's own declarations aren't for a program to export.
      const hidden = all[imp.from]!.own.has(name) && !from.path.startsWith("std:") ? `; it declares '${name}' without exporting it, so add 'export' before that declaration` : "";
      // Reached by a package's name from outside it, the lib is all there is to see.
      const owner: Ref<{ name: string; dir: string; lib: string } | undefined> = from.owner;
      if (owner !== undefined && l.pkg !== owner.dir) {
        // Only the package's files this build loaded are known; one its lib never imports isn't.
        const inner = name !== "default" && all.some((m) => m.index !== imp.from && m.pkg === owner.dir && m.exports.has(name));
        const missing = name === "default" ? "no default export" : `no export named '${name}'`;
        throw new CompileError(inner ? "E0903" : "E0902", inner ? `'${name}' is private to the package '${owner.name}'; only what its lib ${owner.lib} exports is public` : `the package '${owner.name}' has ${missing} in its lib ${owner.lib}${hidden}`, at.start, at.end);
      }
      throw new CompileError("E0902", name === "default" ? `'${from.file}' has no default export; add 'export default' before what it should give${hidden}` : `'${from.file}' has no export named '${name}'${hidden}`, at.start, at.end);
    }
  }
  const taken = settledUniques(all);
  let names = new Map<usize, Map<string, string>>();
  for (const l of all) {
    let written = new Map<string, string>();
    for (const d of l.own.values()) written.set(d.unique, d.name);
    for (const alias of l.imports.keys()) {
      const d = local(all, l.index, alias, new Set<string>());
      if (d !== undefined) written.set(d.unique, alias);
    }
    names.set(l.base, written);
  }
  let foreign = new Map<string, { signature: string; file: string }>();
  let program: Stmt[] = [];
  for (let li: usize = 0; li < all.length; li++) {
    const to = renamesIn(all, li, taken);
    let body = all[li]!.body.splice(0);
    renameIn(compilation.ids, body, (name) => to.get(name));
    const file = all[li]!.file;
    while (body.length > 0) {
      const s = body.shift()!;
      if (firstForeign(s, foreign, file !== "" ? file : "the entry file")) program.push(s);
    }
  }
  if (!lenient) compilation.fileNames = names;
  // Kept for a file read again into the same program, as `fishc watch` does; their bodies are
  // the program's now.
  if (!lenient) loaded.links = all;
  return program;
}

// The file at `index` parsed again from `text`, as loading parsed it: its spans in its own place
// in the program and its `import.meta` lowered. Each import keeps the id its statement had, so it
// still reaches the file it did; the caller has found the file's imports unchanged. Gives why it
// can't be parsed in place instead, when it holds a Rust block or reaches another global.
/** @throws {CompileError} */
export function reparsedFile(ids: Mut<Ids>, loaded: Ref<Loaded>, index: usize, text: string): { statements: Stmt[]; fallback: string | undefined } {
  const m: Ref<Module> = loaded.modules[index]!;
  let parsed = parse(text, ids);
  if (m.base > 0) shiftSpansStmts(parsed, m.base);
  lowerImportMeta(ids, parsed, m.path, index === 0);
  if (parsed.some((s) => isRustBlock(s))) return { statements: [], fallback: "the file declares Rust" };
  // What a macro made of the file is in the program, which the file as written isn't.
  if (parsed.some((s) => decorated(s))) return { statements: [], fallback: "the file has decorators or macros" };
  const known = m.targets.ids();
  let at: usize = 0;
  for (let i: usize = 0; i < parsed.length; i++) {
    if (specifierOf(parsed[i]!) === undefined) continue;
    if (at >= known.length) return { statements: [], fallback: "the file's imports changed" };
    renumbered(parsed[i]!, known[at]!);
    at++;
  }
  if (at !== known.length) return { statements: [], fallback: "the file's imports changed" };
  const globals = globalsIn(parsed);
  if (globals.length !== m.globals.size || globals.some((g) => !m.globals.has(g))) return { statements: [], fallback: "the file reaches other std modules through their names" };
  return { statements: parsed, fallback: undefined };
}

// Whether a top-level statement is a macro, or has a decorator a macro expands.
function decorated(s: Ref<Stmt>): boolean {
  const d: Ref<Stmt> = s.kind === "export" ? s.body : s.kind === "exportDefault" && s.declaration !== undefined ? s.declaration : s;
  if (d.kind === "function") return d.macro || (d.decorators !== undefined && d.decorators.length > 0);
  if (d.kind === "class") return d.decorators.length > 0 || d.members.some((m) => m.kind !== "index" && m.kind !== "staticBlock" && m.decorators.length > 0);
  if (d.kind === "typeAlias") return d.decorators !== undefined && d.decorators.length > 0;
  if (d.kind === "interface") return d.decorators !== undefined && d.decorators.length > 0;
  if (d.kind === "enum") return d.decorators !== undefined && d.decorators.length > 0;
  return false;
}

// Gives an import or re-export statement the id `id`.
function renumbered(s: Mut<Stmt>, id: usize): void {
  switch (s.kind) {
    case "import":
      s.id = id;
      break;
    case "exportAll":
      s.id = id;
      break;
    case "exportNamed":
      s.id = id;
      break;
  }
}

// The file at `index`, given as `statements` read again from `text`, linked into the program
// `loaded` holds as its first link linked it: its statements renamed as they are in the program,
// or why that can't be, when its declarations, imports or exports, or the unique names any file's
// declarations take, come out otherwise. Its module and link are replaced either way.
/** @throws {CompileError} */
export function relinkedFile(ids: Mut<Ids>, loaded: Mut<Loaded>, index: usize, text: string, statements: Stmt[], library: boolean): { statements: Stmt[]; fallback: string | undefined } {
  if (loaded.links === undefined) return { statements: [], fallback: "the program wasn't linked" };
  if (statements.some((s) => s.kind === "declare")) return { statements: [], fallback: "the file declares C or JS names" };
  let m: Mut<Module> = loaded.modules[index]!;
  m.src = text;
  m.statements = statements;
  let indexOf = new Map<string, usize>();
  for (let i: usize = 0; i < loaded.modules.length; i++) indexOf.set(loaded.modules[i]!.path, i);
  let l = linkOf(ids, loaded.modules, index, indexOf, library);
  let links: Mut<Linked[]> = loaded.links!;
  const before = uniquesOf(links);
  const same = sameLink(links[index]!, l);
  links[index] = l;
  const taken = settledUniques(links);
  if (!same) return { statements: [], fallback: "the file's declarations, imports or exports changed" };
  if (uniquesOf(links) !== before) return { statements: [], fallback: "a file's declaration takes another name in the program" };
  const to = renamesIn(links, index, taken);
  let body = links[index]!.body.splice(0);
  renameIn(ids, body, (name) => to.get(name));
  return { statements: body, fallback: undefined };
}

// Every declaration's unique name, file by file, as one text to compare.
function uniquesOf(links: Ref<Linked[]>): string {
  let out: string[] = [];
  for (const l of links) for (const [name, d] of l.own) out.push(`${l.index}:${name}=${d.unique}`);
  return out.join(",");
}

// Whether two links of a file declare, import and export the same names.
function sameLink(a: Ref<Linked>, b: Ref<Linked>): boolean {
  const own = (l: Ref<Linked>) => [...l.own].map(([n, d]) => `${n}=${d.name}:${d.fixed}`).join(",");
  const imports = (l: Ref<Linked>) => [...l.imports].map(([n, i]) => `${n}=${i.from}.${i.name}`).join(",");
  const exports = (l: Ref<Linked>) => [...l.exports].map(([n, e]) => ("local" in e ? `${n}=${e.local}` : `${n}=${e.from}.${e.name}`)).join(",");
  return own(a) === own(b) && imports(a) === imports(b) && exports(a) === exports(b) && a.stars.join(",") === b.stars.join(",");
}

// Settles each top-level declaration's unique name, giving every unique name taken. A name keeps
// its spelling unless another file uses it for something else, its own local or a std name, which
// would otherwise reach this declaration.
function settledUniques(all: Mut<Linked[]>): Set<string> {
  let taken = new Set<string>();
  for (let li: usize = 0; li < all.length; li++) {
    let names: string[] = [];
    for (const name of all[li]!.own.keys()) names.push(name);
    for (const name of names) {
      const d = all[li]!.own.get(name);
      if (d === undefined) continue;
      const elsewhere = all.some((o) => o.index !== li && o.used.has(d.name) && !sameDecl(local(all, o.index, d.name, new Set<string>()), d));
      const unique = d.fixed || (!elsewhere && !taken.has(d.name)) ? d.name : apart(d.name, li);
      taken.add(unique);
      all[li]!.own.set(name, { name: d.name, unique, fixed: d.fixed, file: d.file });
    }
  }
  return taken;
}

// What each name file `li` uses is renamed to in the program.
function renamesIn(all: Ref<Linked[]>, li: usize, taken: Ref<Set<string>>): Map<string, string> {
  let to = new Map<string, string>();
  for (const name of all[li]!.used) {
    // `name-fsh<n>`, a name a macro's quote written in file n pins, is what `name` means there.
    const pinned = /^(.*)-fsh(\d+)$/.exec(name);
    if (pinned !== null) {
      const meant = String(pinned[1]);
      const there = Number(String(pinned[2]));
      const d = there !== null && there < (all.length as f64) ? local(all, there as usize, meant, new Set<string>()) : undefined;
      if (d !== undefined) to.set(name, d.unique);
      continue;
    }
    const d = local(all, li, name, new Set<string>());
    // A name another file declares, and this one neither declares nor imports, is this file's
    // own local or nothing at all here.
    const unique = d !== undefined ? d.unique : taken.has(name) ? apart(name, li) : name;
    if (unique !== name) to.set(name, unique);
  }
  return to;
}

// Whether a statement stays in the program: a C function declared again with the same types is
// left out, and with other types refused.
/** @throws {CompileError} */
function firstForeign(s: Ref<Stmt>, foreign: Mut<Map<string, { signature: string; file: string }>>, file: string): boolean {
  if (s.kind !== "declare") return true;
  const f: Ref<Stmt> = s.body;
  if (f.kind !== "function") return true;
  // The types as written, without where: a declaration a macro gave has its quote's spans.
  const signature = `${f.params.map((p) => shapeOf(p.type)).join(",")}:${shapeOf(f.returnType)}`;
  const known = foreign.get(f.name);
  if (known === undefined) {
    foreign.set(f.name, { signature, file });
    return true;
  }
  if (known.signature !== signature) throw new CompileError("E1002", `the C function '${f.name}' is declared in '${known.file}' with other types; declare it in one file and import it from there`, f.start, f.end);
  return false;
}

// The declaration a module exports as `name`, through its re-exports.
function exported(all: Ref<Linked[]>, m: usize, name: string, seen: Mut<Set<string>>): Decl | undefined {
  const l: Ref<Linked> = all[m]!;
  const key = `${l.path}\0${name}`;
  if (seen.has(key)) return undefined;
  seen.add(key);
  const e = l.exports.get(name);
  if (e !== undefined) return "local" in e ? local(all, m, e.local, seen) : exported(all, e.from, e.name, seen);
  if (name === "default") return undefined;
  for (const star of l.stars) {
    const found = exported(all, star, name, seen);
    if (found !== undefined) return found;
  }
  return undefined;
}

// The declaration `name` means in a file: its own, or what it imports under that name.
function local(all: Ref<Linked[]>, l: usize, name: string, seen: Mut<Set<string>>): Decl | undefined {
  const own = all[l]!.own.get(name);
  if (own !== undefined) return own;
  const imported = all[l]!.imports.get(name);
  return imported !== undefined ? exported(all, imported.from, imported.name, seen) : undefined;
}

function sameDecl(a: Ref<Decl | undefined>, b: Ref<Decl>): boolean {
  return a !== undefined && a.file === b.file && a.name === b.name;
}

// A name told apart from another file's: `-` can't be written in a name, and messages leave the
// suffix out.
function apart(name: string, index: usize): string {
  return `${name}-fsh${index}`;
}

// A module's statements, for linking: in place in the module too, so its file still holds them.
function lent(m: Mut<Module>): Stmt[] {
  let taken = m.statements.splice(0);
  let out: Stmt[] = [];
  while (taken.length > 0) {
    const [kept, given] = dup(taken.shift()!);
    m.statements.push(kept);
    out.push(given);
  }
  return out;
}

/** @throws {CompileError} */
function bindIn(imports: Mut<Map<string, Import>>, alias: string, from: usize, name: string, at: Ref<Span>): void {
  if (imports.has(alias)) throw new CompileError("E0907", `'${alias}' is already imported in this file`, at.start, at.end);
  imports.set(alias, { from, name, at: { start: at.start, end: at.end } });
}

/** @throws {CompileError} */
function declareIn(l: Mut<Linked>, s: Stmt, entry: boolean, library: boolean): void {
  const inner = innerOf(s);
  const fixed = s.kind === "declare" || (s.kind === "export" && (s.body.kind === "declare" || (entry && library && s.body.kind === "function"))) || (entry && s.kind === "function" && s.name === "main");
  if (!entry && inner.kind === "function" && inner.name === "main") {
    throw new CompileError("E0405", `only the entry file's main() runs, so '${l.file}' can't declare one; rename it, or build '${l.file}' as a program of its own`, inner.start, inner.end);
  }
  const names = inner.kind === "declare" ? namesOf(inner.body) : namesOf(inner);
  l.body.push(s);
  for (const name of names) {
    if (!l.own.has(name)) l.own.set(name, { name, unique: name, fixed, file: l.index });
  }
}

// A declaration with an `export` or `declare` before it taken off.
function innerOf(s: Ref<Stmt>): Ref<Stmt> {
  if (s.kind === "export") return s.body;
  if (s.kind === "declare") return s.body;
  return s;
}

// The names an `export` before a declaration exports.
function exportedNames(s: Ref<Stmt>): string[] {
  if (s.kind !== "export") return [];
  const body: Ref<Stmt> = s.body;
  return body.kind === "declare" ? namesOf(body.body) : namesOf(body);
}

function cOnly(at: Ref<Span>): CompileError {
  return new CompileError("E1002", "a library's C functions are its entry file's exported functions, each under its own name; write 'export function' on the function itself", at.start, at.end);
}

/** @throws {CompileError} */
function linkOf(ids: Mut<Ids>, modules: Mut<Module[]>, index: usize, indexOf: Ref<Map<string, usize>>, library: boolean): Linked {
  const entry = index === 0;
  let statements = lent(modules[index]!);
  const module: Ref<Module> = modules[index]!;
  let l: Linked = { path: module.path, file: module.file, base: module.base, pkg: module.pkg, index, body: [], own: new Map<string, Decl>(), imports: new Map<string, Import>(), exports: new Map<string, { local: string } | { from: usize; name: string }>(), stars: [], used: new Set<string>() };
  // A library gives C its entry file's exported functions, under their own names.
  let listed: Specifier[] = [];
  let spaces = new Map<string, { from: usize; explicit: boolean }>();
  while (statements.length > 0) {
    let s = statements.shift()!;
    const target = module.targets.get(s);
    const from = target !== undefined ? indexOf.get(target.path) : undefined;
    const to: usize = from !== undefined ? from : 0;
    if (entry && library && (s.kind === "exportAll" || s.kind === "exportDefault" || (s.kind === "exportNamed" && from !== undefined))) throw cOnly({ start: s.start, end: s.end });
    if (s.kind === "import") {
      // A std module imported whole is reached through its name, as `os.hostname()`.
      const whole = s.namespace !== undefined ? s.namespace : s.default;
      const spaced = from !== undefined && modules[to]!.whole === true && (s.namespace !== undefined || s.default !== undefined);
      if (whole !== undefined && (stdModule(s.module) !== undefined || spaced)) spaces.set(whole, { from: to, explicit: true });
      else if (s.namespace !== undefined) throw new CompileError("E0801", `namespace imports aren't supported yet; import the names you use, as in 'import { a, b } from "${s.module}"'`, s.start, s.end);
      else if (s.default !== undefined) bindIn(l.imports, s.default, to, "default", { start: s.start, end: s.end });
      if (s.named !== undefined) {
        for (const sp of s.named) {
          if (modules[to]!.path === "std:buffer" && sp.name === "Buffer") {
            if (sp.alias !== undefined && sp.alias !== "Buffer") throw new CompileError("E0907", "Buffer is a global, so import it under its own name, as in 'import { Buffer } from \"std:buffer\"'", sp.start, sp.end);
            continue;
          }
          bindIn(l.imports, sp.alias !== undefined ? sp.alias : sp.name, to, sp.name, sp);
        }
      }
    } else if (s.kind === "importEquals") {
      throw new CompileError("E0801", `'import ${s.name} = ...' isn't supported yet; import what you use with 'import { a, b } from "./file"'`, s.start, s.end);
    } else if (s.kind === "exportAll") {
      if (s.alias !== undefined) throw unsupported("namespace re-exports ('export * as name from')", s);
      l.stars.push(to);
    } else if (s.kind === "exportNamed") {
      for (const sp of s.specifiers) l.exports.set(sp.alias !== undefined ? sp.alias : sp.name, from !== undefined ? { from, name: sp.name } : { local: sp.name });
      if (entry && library) for (const sp of s.specifiers) listed.push({ id: sp.id, name: sp.name, alias: sp.alias, typeOnly: sp.typeOnly, start: sp.start, end: sp.end });
    } else if (s.kind === "export") {
      const names = exportedNames(s);
      if (entry && s.body.kind === "function") declareIn(l, s, entry, library);
      else declareIn(l, s.body, entry, library);
      for (const name of names) l.exports.set(name, { local: name });
    } else if (s.kind === "exportDefault") {
      const value = s.value;
      if (value !== undefined && value.kind === "ident") {
        l.exports.set("default", { local: value.name });
        continue;
      }
      let declaration: Stmt = s.declaration !== undefined ? s.declaration : { id: nextId(ids), kind: "let", keyword: "const", declarations: [{ id: nextId(ids), target: { id: nextId(ids), kind: "ident", name: "default", start: s.start, end: s.end }, type: undefined, init: value, start: s.start, end: s.end }], start: s.start, end: s.end };
      if (declaration.kind === "class" && declaration.name === undefined) declaration.name = "default";
      if (declaration.kind === "function" && unnamed(declaration)) declaration.name = "default";
      const names = namesOf(declaration);
      const first = names.length > 0 ? names[0]! : "default";
      declareIn(l, declaration, entry, library);
      l.exports.set("default", { local: first });
    } else declareIn(l, s, entry, library);
  }
  for (const sp of listed) {
    // Only functions cross to C; a listed class, type or const stays a module export.
    if (!l.body.some((s) => s.kind === "function" && s.name === sp.name)) continue;
    const at = l.body.findIndex((s) => s.kind === "function" && s.name === sp.name && s.body !== undefined);
    if (at < 0 || (sp.alias !== undefined && sp.alias !== sp.name)) throw cOnly(sp);
    let removed = l.body.splice(at, 1);
    const body = removed.shift()!;
    const start = body.start;
    const end = body.end;
    l.body.splice(at, 0, { id: nextId(ids), kind: "export", body, start, end });
    const d = l.own.get(sp.name);
    if (d !== undefined) l.own.set(sp.name, { name: d.name, unique: d.unique, fixed: true, file: d.file });
  }
  for (const [name, global] of module.globals) {
    const from = indexOf.get(global.path);
    if (from !== undefined && !l.own.has(name) && !l.imports.has(name) && !spaces.has(name)) spaces.set(name, { from, explicit: false });
  }
  // A std module's value members imported by name, as `import { argv } from "std:process"`.
  let valued = new Map<string, "value" | "table">();
  for (const [alias, imp] of l.imports) {
    const kind = valuesOf(modules[imp.from]!).get(imp.name);
    if (kind !== undefined) valued.set(alias, kind);
  }
  if (spaces.size > 0 || valued.size > 0) throughSpaces(ids, modules, l.body, spaces, l.imports, valued);
  // A file module's call naming an encoding, linked to the function giving a string.
  let encoded = false;
  for (const imp of l.imports.values()) if (ENCODED.has(modules[imp.from]!.path)) encoded = true;
  if (encoded) byEncoding(modules, l.body, l.imports);
  if (module.src.includes("fatal")) fatalDecoders(l.body);
  let used = new Set<string>();
  renameIn(ids, l.body, (name) => {
    used.add(name);
    return undefined;
  });
  l.used = used;
  return l;
}

// Whether a function declaration has no name, as `export default function () {}` gives one.
function unnamed(f: Ref<Func>): boolean {
  const name: Ref<string | undefined> = f.name;
  return name === undefined;
}

// A walk keeping the names local declarations take, so a rewrite of a module's name leaves the
// places it means something else alone: a block's declarations, a function's parameters, a loop
// head's bindings and a catch clause's name in its handler. `visit` returns true when it has
// handled a node and its children; only names `matters` cares about are tracked. A walk records
// the first error it finds, and stops there.
interface Scoping {
  matters(name: string): boolean;
  visit(this: Mut<this>, n: Ref<AnyNode>, hidden: Ref<Set<string>>): boolean;
  stopped(): boolean;
}

function scopedWalk(w: Mut<Scoping>, n: AnyNode, hidden: Ref<Set<string>>): void {
  if (w.stopped()) return;
  if (n.of === "stmts") {
    let declared: string[] = [];
    for (const d of n.node) {
      if (d.kind === "let") {
        for (const x of d.declarations) for (const b of bindings(x.target)) declared.push(b);
      } else if (d.kind === "function" || d.kind === "class") for (const b of namesOf(d)) declared.push(b);
    }
    if (declared.some((d) => w.matters(d))) {
      const inner = joined(hidden, declared);
      for (const s of n.node) scopedWalk(w, { of: "stmt", node: s }, inner);
    } else for (const s of n.node) scopedWalk(w, { of: "stmt", node: s }, hidden);
    return;
  }
  // A catch clause's name reaches only its handler, so the try's own blocks are walked first.
  if (n.of === "stmt") {
    const t = n.node;
    if (t.kind === "try" && t.param !== undefined) {
      const caught = bindings(t.param);
      scopedWalk(w, { of: "stmts", node: t.block }, hidden);
      if (t.handler !== undefined) {
        if (caught.some((c) => w.matters(c))) {
          const inner = joined(hidden, caught);
          scopedWalk(w, { of: "stmts", node: t.handler }, inner);
        } else scopedWalk(w, { of: "stmts", node: t.handler }, hidden);
      }
      if (t.finalizer !== undefined) scopedWalk(w, { of: "stmts", node: t.finalizer }, hidden);
      return;
    }
  }
  let own: string[] = [];
  const params = paramsOf(n);
  if (params !== undefined) for (const p of params) for (const b of bindings(p.pattern)) own.push(b);
  for (const b of headBindings(n)) own.push(b);
  if (own.some((o) => w.matters(o))) {
    const inner = joined(hidden, own);
    if (!w.visit(n, inner)) forEachChild(n, (c) => scopedWalk(w, c, inner));
  } else if (!w.visit(n, hidden)) forEachChild(n, (c) => scopedWalk(w, c, hidden));
}

function joined(hidden: Ref<Set<string>>, names: Ref<string[]>): Set<string> {
  let out = new Set<string>();
  for (const h of hidden) out.add(h);
  for (const n of names) out.add(n);
  return out;
}

// The parameters a node has: functions, arrows, methods and function types.
function paramsOf(n: Ref<AnyNode>): Ref<Param[]> | undefined {
  if (n.of === "typeNode") {
    const t = n.node;
    if (t.kind === "function") return t.params;
    return undefined;
  }
  if (n.of === "expr") {
    const e = n.node;
    if (e.kind === "function") return e.params;
    if (e.kind === "arrow") return e.params;
    return undefined;
  }
  if (n.of === "stmt") {
    const s = n.node;
    if (s.kind === "function") return s.params;
    return undefined;
  }
  if (n.of === "func") return n.node.params;
  if (n.of === "typeMember") {
    const m = n.node;
    if (m.kind === "method") return m.params;
    if (m.kind === "call" || m.kind === "construct") return m.params;
    if (m.kind === "index") return m.params;
    if (m.kind === "get" || m.kind === "set") return m.params;
    return undefined;
  }
  if (n.of === "objectProp") {
    const p = n.node;
    if (p.kind === "method") return p.params;
    if (p.kind === "get" || p.kind === "set") return p.params;
    return undefined;
  }
  if (n.of === "classMember") {
    const m = n.node;
    if (m.kind === "method") return m.params;
    if (m.kind === "constructor") return m.params;
    if (m.kind === "get" || m.kind === "set") return m.params;
    if (m.kind === "index") return m.params;
    return undefined;
  }
  return undefined;
}

// The bindings a loop head declares.
function headBindings(n: Ref<AnyNode>): string[] {
  if (n.of !== "stmt") return [];
  const s = n.node;
  if (s.kind === "forOf" || s.kind === "forIn") {
    const left: Ref<Stmt | Pattern> = s.left;
    return left.kind === "let" ? letBindings(left) : [];
  }
  if (s.kind === "for" && s.init !== undefined) return letBindings(s.init);
  return [];
}

function letBindings(s: Ref<Stmt>): string[] {
  let found: string[] = [];
  if (s.kind === "let") for (const d of s.declarations) for (const b of bindings(d.target)) found.push(b);
  return found;
}

type Bind = { alias: string; from: usize; name: string; at: Span };
// What turning a std module's members into imports needs of the module bound whole: its file,
// whether it is a package's, its exports, and how its members are read.
type Space = { from: usize; explicit: boolean; path: string; file: string; whole: boolean; exports: string[]; values: Map<string, "value" | "table">; members: string[] };

// Turns each `os.hostname` on a std module bound whole into a name imported from it, written
// so no program can write it. A global's member the module doesn't have is left alone, since a
// local of that name may be meant; an import's is refused. Where a function's parameter, a
// block's declaration or a catch clause takes the name, it means that instead.
class Spaces implements Scoping {
  spaces: Map<string, Space> = new Map<string, Space>();
  valued: Map<string, "value" | "table"> = new Map<string, "value" | "table">();
  bound: Set<string> = new Set<string>();
  binds: Bind[] = [];
  rewrites: Rewrites = new Rewrites();
  ids: Ids = { last: 0 };
  failure: CompileError | undefined = undefined;

  matters(name: string): boolean {
    return this.spaces.has(name) || this.valued.has(name);
  }

  stopped(): boolean {
    return this.failure !== undefined;
  }

  fail(this: Mut<this>, e: CompileError): boolean {
    if (this.failure === undefined) this.failure = e;
    return true;
  }

  bind(this: Mut<this>, alias: string, from: usize, name: string, at: Ref<Span>): void {
    if (!this.bound.has(alias)) this.binds.push({ alias, from, name, at: { start: at.start, end: at.end } });
    this.bound.add(alias);
  }

  // `process.env.HOME` and `process.env[name]`: a table member's key, read through its function.
  table(x: Ref<Expr>, hidden: Ref<Set<string>>): { from: usize; owner: string; name: string } | undefined {
    if (x.kind !== "member") return undefined;
    const object: Ref<Expr> = x.object;
    if (object.kind !== "ident" || hidden.has(object.name)) return undefined;
    const on = this.spaces.get(object.name);
    return on !== undefined && on.values.get(x.name) === "table" ? { from: on.from, owner: object.name, name: x.name } : undefined;
  }

  visit(this: Mut<this>, x: Ref<AnyNode>, hidden: Ref<Set<string>>): boolean {
    if (x.of === "pattern") {
      const p = x.node;
      if (p.kind === "ident") return this.valuedName(p.id, p.name, p, hidden);
      return false;
    }
    if (x.of !== "expr") return false;
    const n = x.node;
    if (n.kind === "assign") {
      const target: Ref<Expr> = n.target;
      if (target.kind === "member" || target.kind === "index") {
        const t = this.table(target.object, hidden);
        if (t !== undefined) return this.fail(new CompileError("E0908", `setting '${t.owner}.${t.name}' isn't supported yet; it is read-only here`, n.start, n.end));
      }
    }
    // `env.HOME` and `env[k]` on a table imported by name call it with the key.
    if ((n.kind === "member" || n.kind === "index") && !n.optional) {
      const imported: Ref<Expr> = n.object;
      if (imported.kind === "ident" && this.valued.get(imported.name) === "table" && !hidden.has(imported.name)) {
        const key = this.keyOf(n, hidden);
        const callee: Expr = { id: nextId(this.ids), kind: "ident", name: imported.name, start: imported.start, end: imported.end };
        this.rewrites.replaceAt(n.id, { id: 0, kind: "call", callee, typeArgs: [], args: [key], optional: false, start: n.start, end: n.end });
        return true;
      }
    }
    // `argv` imported by name reads as a value, calling it, except where it is called.
    if (n.kind === "ident") return this.valuedName(n.id, n.name, n, hidden);
    if ((n.kind === "member" || n.kind === "index") && !n.optional) {
      const keyed = this.table(n.object, hidden);
      if (keyed !== undefined) {
        const alias = `${keyed.owner}:${keyed.name}`;
        this.bind(alias, keyed.from, keyed.name, { start: n.start, end: n.end });
        const key = this.keyOf(n, hidden);
        const callee: Expr = { id: nextId(this.ids), kind: "ident", name: alias, start: n.start, end: n.end };
        this.rewrites.replaceAt(n.id, { id: 0, kind: "call", callee, typeArgs: [], args: [key], optional: false, start: n.start, end: n.end });
        return true;
      }
    }
    if (n.kind === "call") {
      // `Object.entries(process.env)` and `Object.keys(process.env)`: the whole table, through the
      // module's own function for it, where it has one.
      const callee: Ref<Expr> = n.callee;
      const whole = n.args.length === 1 ? this.table(n.args[0]!, hidden) : undefined;
      const reader = callee.kind === "member" || callee.kind === "ident" ? (callee.name === "entries" ? "__envEntries" : callee.name === "keys" ? "__envKeys" : undefined) : undefined;
      if (whole !== undefined && reader !== undefined && callee.kind === "member" && callee.object.kind === "ident" && callee.object.name === "Object" && !hidden.has("Object") && this.exportsHave(whole.owner, reader)) {
        const alias = `${whole.owner}:${reader}`;
        this.bind(alias, whole.from, reader, { start: n.start, end: n.end });
        const ident: Expr = { id: nextId(this.ids), kind: "ident", name: alias, start: n.start, end: n.end };
        this.rewrites.replaceAt(n.id, { id: 0, kind: "call", callee: ident, typeArgs: [], args: [], optional: false, start: n.start, end: n.end });
        return true;
      }
      // A call's callee is the function itself; a value member elsewhere reads through its function.
      if (callee.kind === "ident" && this.valued.has(callee.name)) {
        for (const a of n.args) scopedWalk(this, { of: "expr", node: a }, hidden);
        return true;
      }
      if (callee.kind === "member") {
        const owner: Ref<Expr> = callee.object;
        if (owner.kind === "ident" && this.spaces.has(owner.name) && !hidden.has(owner.name)) {
          this.rewrite(callee, owner.name, false);
          for (const a of n.args) scopedWalk(this, { of: "expr", node: a }, hidden);
          return true;
        }
      }
    }
    if (n.kind === "member") {
      const object: Ref<Expr> = n.object;
      if (object.kind === "ident" && !hidden.has(object.name) && this.spaces.has(object.name)) return this.rewrite(n, object.name, true);
      if (object.kind === "member" && (object.name === "stdout" || object.name === "stderr") && n.name !== "write" && n.name !== "isTTY") {
        const owner: Ref<Expr> = object.object;
        const name = owner.kind === "ident" && !hidden.has(owner.name) ? owner.name : "";
        const space = this.spaces.get(name);
        if (space !== undefined && space.path === "std:process") return this.fail(new CompileError("E0801", `'${name}.${object.name}.${n.name}' isn't supported yet; Fish's streams have 'write(chunk)' and 'isTTY'`, n.start, n.end));
      }
    }
    return false;
  }

  // A name imported by name as a value member, read by calling it.
  valuedName(this: Mut<this>, id: usize, name: string, at: Ref<Span>, hidden: Ref<Set<string>>): boolean {
    if (!this.valued.has(name) || hidden.has(name)) return false;
    if (this.valued.get(name) === "table") return this.fail(new CompileError("E0908", `'${name}' is read by key, as in '${name}.HOME' or '${name}[name]'`, at.start, at.end));
    const callee: Expr = { id: nextId(this.ids), kind: "ident", name, start: at.start, end: at.end };
    this.rewrites.replaceAt(id, { id: 0, kind: "call", callee, typeArgs: [], args: [], optional: false, start: at.start, end: at.end });
    return true;
  }

  // The key a member or index reads, as an expression, its own names rewritten too.
  keyOf(this: Mut<this>, n: Ref<Expr>, hidden: Ref<Set<string>>): Expr {
    if (n.kind === "index") {
      scopedWalk(this, { of: "expr", node: n.index }, hidden);
      return cloneExpr(n.index);
    }
    const name = n.kind === "member" ? n.name : "";
    return { id: nextId(this.ids), kind: "string", value: name, start: n.start, end: n.end };
  }

  exportsHave(owner: string, name: string): boolean {
    const space = this.spaces.get(owner);
    return space !== undefined && space.exports.includes(name);
  }

  // `os.hostname` into the name imported from the module, called when it is a value member.
  rewrite(this: Mut<this>, n: Ref<Expr>, owner: string, read: boolean): boolean {
    const space = this.spaces.get(owner);
    if (n.kind !== "member" || space === undefined) return false;
    const name = n.name;
    if (!space.exports.includes(name)) {
      // A package's module holds only the members the file uses, so what else it has isn't listed.
      if (space.explicit && space.whole) return this.fail(new CompileError("E0902", `'${space.file}' has no export '${name}'`, n.start, n.end));
      if (space.explicit) return this.fail(new CompileError("E0902", `'${space.file}' has no export named '${name}'; it has ${space.exports.map((e) => `'${e}'`).join(", ")}`, n.start, n.end));
      // Nothing else in a program is named Bun, so a member it lacks is one outside Fish's subset.
      if (space.path === "std:Bun") return this.fail(new CompileError("E0902", `'Bun.${name}' isn't in Fish's subset of Bun yet; it has ${space.members.map((e) => `'${e}'`).join(", ")}`, n.start, n.end));
      return false;
    }
    const kind = space.values.get(name);
    if (read && kind === "table") return this.fail(new CompileError("E0908", `'${owner}.${name}' is read by key, as in '${owner}.${name}.HOME' or '${owner}.${name}[name]'`, n.start, n.end));
    const alias = `${owner}:${name}`;
    this.bind(alias, space.from, name, { start: n.start, end: n.end });
    const ident: Expr = { id: nextId(this.ids), kind: "ident", name: alias, start: n.start, end: n.end };
    if (read && kind === "value") this.rewrites.replaceAt(n.id, { id: 0, kind: "call", callee: ident, typeArgs: [], args: [], optional: false, start: n.start, end: n.end });
    else this.rewrites.replaceAt(n.id, ident);
    return true;
  }
}

/** @throws {CompileError} */
function throughSpaces(ids: Mut<Ids>, modules: Ref<Module[]>, body: Mut<Stmt[]>, spaces: Ref<Map<string, { from: usize; explicit: boolean }>>, imports: Mut<Map<string, Import>>, valued: Map<string, "value" | "table">): void {
  let w = new Spaces();
  for (const [name, space] of spaces) {
    const m: Ref<Module> = modules[space.from]!;
    const members: string[] = m.path === "std:Bun" ? bunMembers(m) : [];
    const made: Space = { from: space.from, explicit: space.explicit, path: m.path, file: m.file, whole: m.whole === true, exports: exportNames(m), values: valuesOf(m), members };
    w.spaces.set(name, made);
  }
  w.valued = valued;
  w.ids = { last: ids.last };
  scopedWalk(w, { of: "stmts", node: body }, new Set<string>());
  ids.last = w.ids.last;
  if (w.failure !== undefined) throw w.failure;
  for (const b of w.binds) bindIn(imports, b.alias, b.from, b.name, b.at);
  rebuiltStmts(body, w.rewrites);
}

// The functions and names Bun's module has, as an error lists them.
function bunMembers(m: Ref<Module>): string[] {
  let out: string[] = [];
  for (const s of m.statements) {
    if (s.kind === "export" && s.body.kind === "function") out.push(s.body.name);
    else if (s.kind === "exportNamed") for (const sp of s.specifiers) out.push(sp.alias !== undefined ? sp.alias : sp.name);
  }
  return out;
}

// What a file module's call of one of its imports reads its encoding from, by alias.
type Encoded = { from: usize; name: string; role: "read" | "write" | usize };

// `readFile(path, "utf8")` and `readFile(path, { encoding: "utf8" })` give a string, which
// `readFileText` gives; without an encoding, bytes. A write's "utf8" is what it writes anyway. A
// call taking other options, as `spawnSync`, keeps them and drops only the encoding.
// The encoding is read while compiling, so it must be a literal, and UTF-8 is the one known.
class Encodings implements Scoping {
  files: Map<string, Encoded> = new Map<string, Encoded>();
  taken: Set<string> = new Set<string>();
  binds: Bind[] = [];
  edits: Edits = new Edits();
  failure: CompileError | undefined = undefined;

  matters(name: string): boolean {
    return this.files.has(name);
  }

  stopped(): boolean {
    return this.failure !== undefined;
  }

  visit(this: Mut<this>, x: Ref<AnyNode>, hidden: Ref<Set<string>>): boolean {
    if (x.of !== "expr") return false;
    const n = x.node;
    if (n.kind !== "call") return false;
    const callee: Ref<Expr> = n.callee;
    if (callee.kind !== "ident" || hidden.has(callee.name)) return false;
    const target = this.files.get(callee.name);
    if (target === undefined) return false;
    const role = target.role;
    const at: usize = role === "read" ? 1 : role === "write" ? 2 : role;
    if (at >= n.args.length) return false;
    const given: Ref<Expr> = n.args[at]!;
    const options = typeof role === "number";
    if (options && (given.kind !== "object" || !given.props.some((p) => isEncoding(p)))) return false;
    let found: { name: string | null } | undefined = undefined;
    if (given.kind === "string" && !options) found = { name: given.value };
    else if (given.kind === "object") found = encodingOf(given, options);
    if (found === undefined) {
      if (this.failure === undefined) this.failure = new CompileError("E0908", `'${target.name}' takes its encoding as a literal, like ${options ? "" : `"utf8" or `}{ encoding: "utf8" }, so its type is known while compiling`, given.start, given.end);
      return false;
    }
    let encoding = found.name;
    // Node's "buffer" asks for bytes, what no encoding gives.
    if (options && encoding === "buffer") encoding = null;
    if (encoding !== null && !/^utf-?8$/i.test(encoding)) {
      if (this.failure === undefined) this.failure = new CompileError("E0908", `'${target.name}' knows the "utf8" encoding so far, not "${encoding}"`, given.start, given.end);
      return false;
    }
    if (options) this.edits.unencoded.add(given.id);
    else this.edits.dropped.set(n.id, at);
    if (role === "write" || encoding === null) return false;
    const alias = `${callee.name}:text`;
    if (!this.taken.has(alias)) {
      this.taken.add(alias);
      this.binds.push({ alias, from: target.from, name: `${target.name}Text`, at: { start: given.start, end: given.end } });
    }
    this.edits.names.set(callee.id, alias);
    return false;
  }
}

/** @throws {CompileError} */
function byEncoding(modules: Ref<Module[]>, body: Mut<Stmt[]>, imports: Mut<Map<string, Import>>): void {
  let w = new Encodings();
  for (const [alias, imp] of imports) {
    w.taken.add(alias);
    const roles = ENCODED.get(modules[imp.from]!.path);
    const role = roles !== undefined ? roles.get(imp.name) : undefined;
    if (role !== undefined) w.files.set(alias, { from: imp.from, name: imp.name, role });
  }
  scopedWalk(w, { of: "stmts", node: body }, new Set<string>());
  if (w.failure !== undefined) throw w.failure;
  for (const b of w.binds) bindIn(imports, b.alias, b.from, b.name, b.at);
  rebuiltStmts(body, w.edits);
}

// `new TextDecoder(label, { fatal: true })` throws where a plain decoder doesn't, so it is std's
// class whose decode says so. The option is read while compiling, so it must be a literal.
class FatalDecoders implements Scoping {
  edits: Edits = new Edits();
  failure: CompileError | undefined = undefined;

  matters(name: string): boolean {
    return name === "TextDecoder";
  }

  stopped(): boolean {
    return this.failure !== undefined;
  }

  visit(this: Mut<this>, x: Ref<AnyNode>, hidden: Ref<Set<string>>): boolean {
    if (x.of !== "expr") return false;
    const n = x.node;
    if (n.kind !== "new") return false;
    const callee: Ref<Expr> = n.callee;
    if (callee.kind !== "ident" || callee.name !== "TextDecoder" || hidden.has("TextDecoder")) return false;
    const args: Ref<Expr[] | undefined> = n.args;
    if (args === undefined || args.length < 2) return false;
    const options: Ref<Expr> = args[1]!;
    if (options.kind !== "object") return false;
    for (const p of options.props) {
      if (p.kind === "property" && p.key === "fatal") {
        const value: Ref<Expr> = p.value;
        if (value.kind !== "bool") {
          if (this.failure === undefined) this.failure = fatalLiteral(value.start, value.end);
          return false;
        }
        if (value.value) this.edits.names.set(callee.id, "__FatalTextDecoder");
        return false;
      }
      if (p.kind === "shorthand" && p.name === "fatal") {
        if (this.failure === undefined) this.failure = fatalLiteral(p.start, p.end);
        return false;
      }
    }
    return false;
  }
}

function fatalLiteral(start: usize, end: usize): CompileError {
  return new CompileError("E0908", "'TextDecoder' takes fatal as a literal, true or false, so whether decode throws is known while compiling", start, end);
}

/** @throws {CompileError} */
function fatalDecoders(body: Mut<Stmt[]>): void {
  let w = new FatalDecoders();
  scopedWalk(w, { of: "stmts", node: body }, new Set<string>());
  if (w.failure !== undefined) throw w.failure;
  rebuiltStmts(body, w.edits);
}

// The std calls typed by their encoding, by module: which read, which write, and which take it
// among other options, at the argument given.
const ENCODED = new Map<string, Map<string, "read" | "write" | usize>>([
  ["std:fs/promises", new Map<string, "read" | "write" | usize>([["readFile", "read"], ["writeFile", "write"]])],
  ["std:fs", new Map<string, "read" | "write" | usize>([["readFileSync", "read"], ["writeFileSync", "write"]])],
  ["std:child_process", new Map<string, "read" | "write" | usize>([["spawnSync", 2], ["execFileSync", 2], ["execSync", 1]])],
]);

function isEncoding(p: Ref<ObjectProp>): boolean {
  return (p.kind === "property" && p.key === "encoding") || (p.kind === "shorthand" && p.name === "encoding");
}

// The encoding an options object names: its text, null for `encoding: null`, or undefined when
// it isn't a literal, or the object holds anything else and `others` doesn't allow it. The name is
// held in an object, since Fish has one absent value where JS has two.
function encodingOf(o: Ref<Extract<Expr, { kind: "object" }>>, others: boolean): { name: string | null } | undefined {
  let named: usize = 0;
  for (const p of o.props) if (isEncoding(p)) named++;
  if (named !== 1 || (!others && o.props.length > 1)) return undefined;
  for (const p of o.props) {
    if (!isEncoding(p)) continue;
    if (p.kind !== "property") return undefined;
    const value: Ref<Expr> = p.value;
    if (value.kind === "null") return { name: null };
    return value.kind === "string" ? { name: value.value } : undefined;
  }
  return undefined;
}

// What a std module's members are read as, by name.
function valuesOf(m: Ref<Module>): Map<string, "value" | "table"> {
  let out = new Map<string, "value" | "table">();
  const table = STD_VALUES_BY_MODULE.get(m.path.replace(/^std:/, ""));
  if (table !== undefined) for (const [k, v] of table) out.set(k, v);
  return out;
}

const STD_VALUES_BY_MODULE = stdValues();

function stdValues(): Map<string, Map<string, "value" | "table">> {
  let out = new Map<string, Map<string, "value" | "table">>();
  for (const [module, members] of Object.entries(STD_VALUES)) {
    let table = new Map<string, "value" | "table">();
    for (const [k, v] of Object.entries(members)) table.set(k, v);
    out.set(module, table);
  }
  return out;
}

// `import.meta`'s members as constants: the file's real path where it was built, which the binary
// keeps as Bun's compiled executables do, its name and directory, its file URL, and whether it is
// the entry file. They are read as members, by a literal key, or by destructuring `import.meta`
// in a declaration; any other use is left for the checker to refuse.
function lowerImportMeta(ids: Mut<Ids>, statements: Mut<Stmt[]>, path: string, entry: boolean): void {
  // A script's `if (import.meta.main) main();`, as Bun runs one, says only what a native program
  // does anyway, so it goes.
  let i = statements.length;
  while (i > 0) {
    i--;
    if (startsMain(statements[i]!)) statements.splice(i as i64, 1);
  }
  let values = new Map<string, string | boolean>([["path", path], ["file", basename(path)], ["dir", dirname(path)], ["url", pathToFileURL(path).href], ["main", entry], ["dirname", dirname(path)], ["filename", path]]);
  let rewrites = new Rewrites();
  walk({ of: "stmts", node: statements }, (x) => {
    if (x.of === "declarator") {
      const d = x.node;
      const init: Ref<Expr | undefined> = d.init;
      if (d.target.kind !== "object" || init === undefined || !isMeta(init)) return;
      const at: Span = { start: init.start, end: init.end };
      let props: ObjectProp[] = [];
      for (const [key, value] of values) {
        const id = nextId(ids);
        props.push({ id, kind: "property", key, value: metaLiteral(ids, value, at), start: at.start, end: at.end });
      }
      rewrites.replaceAt(init.id, { id: nextId(ids), kind: "object", props, start: at.start, end: at.end });
      return;
    }
    if (x.of !== "expr") return;
    const n = x.node;
    let key: string | undefined = undefined;
    if (n.kind === "member" && isMeta(n.object)) key = n.name;
    else if (n.kind === "index" && isMeta(n.object)) {
      const index: Ref<Expr> = n.index;
      if (index.kind === "string") key = index.value;
    }
    if (key === undefined) return;
    const value = values.get(key);
    if (value === undefined) return;
    rewrites.replaceAt(n.id, metaLiteral(ids, value, { start: n.start, end: n.end }));
  });
  rebuiltStmts(statements, rewrites);
}

function isMeta(e: Ref<Expr>): boolean {
  return e.kind === "meta" && e.name === "import.meta";
}

function metaLiteral(ids: Mut<Ids>, value: string | boolean, at: Ref<Span>): Expr {
  if (typeof value === "string") return { id: nextId(ids), kind: "string", value, start: at.start, end: at.end };
  return { id: nextId(ids), kind: "bool", value, start: at.start, end: at.end };
}

function startsMain(s: Ref<Stmt>): boolean {
  if (s.kind !== "if" || s.else !== undefined || s.then.length !== 1) return false;
  const cond: Ref<Expr> = s.cond;
  const body: Ref<Stmt> = s.then[0]!;
  if (body.kind !== "expr") return false;
  const call: Ref<Expr> = body.expr;
  return cond.kind === "member" && cond.object.kind === "meta" && cond.object.name === "import.meta" && cond.name === "main" && call.kind === "call" && call.callee.kind === "ident" && call.callee.name === "main" && call.args.length === 0 && call.typeArgs.length === 0;
}

// The names a module exports.
function exportNames(from: Ref<Module>): string[] {
  let out: string[] = [];
  for (const s of from.statements) {
    if (s.kind === "export") for (const n of namesOf(s.body)) out.push(n);
    else if (s.kind === "exportNamed") for (const sp of s.specifiers) out.push(sp.alias !== undefined ? sp.alias : sp.name);
  }
  return out;
}

// The names a binding pattern binds.
// An identifier inside a default value counts, but not inside a key or a shorthand's default.
function bindings(pattern: Ref<Pattern>): string[] {
  let found: string[] = [];
  bindingsIn({ of: "pattern", node: pattern }, found);
  return found;
}

function bindingsIn(n: AnyNode, found: Mut<string[]>): void {
  if (n.of === "pattern" && n.node.kind === "ident") {
    found.push(n.node.name);
    return;
  }
  if (n.of === "expr" && n.node.kind === "ident") {
    found.push(n.node.name);
    return;
  }
  forEachNamedChild(n, (field, c) => {
    if (field !== "key" && field !== "default") bindingsIn(c, found);
  });
}

// The top-level names a declaration introduces.
function namesOf(s: Ref<Stmt>): string[] {
  switch (s.kind) {
    case "function": case "enum": case "typeAlias": case "interface":
      return [s.name];
    case "class":
      return s.name === undefined ? [] : [s.name];
    case "let": {
      let out: string[] = [];
      for (const d of s.declarations) {
        const target: Ref<Pattern> = d.target;
        if (target.kind === "ident") out.push(target.name);
      }
      return out;
    }
    default:
      return [];
  }
}

// Renames every binding and use of a name, at any depth, to what `to` gives for it; a name it
// gives nothing for stays. Renaming a name everywhere in a file keeps its scoping, so a local
// shadowing a top-level name still does. A qualified name renames its first part. The names are
// found first, `to` asked once for each place, and the tree is then renamed in place.
export function renameIn(ids: Mut<Ids>, statements: Mut<Stmt[]>, to: (name: string) => string | undefined): void {
  let edits = new Edits();
  let seen = new Set<i64>();
  walkWhile({ of: "stmts", node: statements }, (n) => {
    const id = nodeIdOf(n);
    if (id >= 0) {
      if (seen.has(id)) return false;
      seen.add(id);
    }
    if (n.of === "objectProp" && n.node.kind === "shorthand") {
      const given = to(n.node.name);
      // `{ x }` keeps its key while its value takes the new name.
      // A shorthand's name has no dots, so it is the name given.
      if (given !== undefined) edits.shorthands.set(n.node.id, { name: withHead(n.node.name, given), id: nextId(ids) });
    } else {
      const name = namedOf(n);
      if (name !== undefined) {
        const given = withHead(name, to(headOf(name)));
        if (given !== name) edits.names.set(id as usize, given);
      }
    }
    const params = typeParamsOf(n);
    if (params !== undefined) {
      for (const p of params) {
        const given = withHead(p.name, to(headOf(p.name)));
        if (given !== p.name) edits.names.set(p.id, given);
      }
    }
    return true;
  });
  rebuiltStmts(statements, edits);
}

// A qualified name's first part, which a rename renames.
function headOf(name: string): string {
  const dot = name.indexOf(".");
  return dot < 0 ? name : name.slice(0, dot);
}

// `name` with its first part renamed to `given`, when there is one.
function withHead(name: string, given: string | undefined): string {
  if (given === undefined) return name;
  const dot = name.indexOf(".");
  return dot < 0 ? given : given + name.slice(dot);
}

// The name of a node whose `name` is a binding or a use of one, rather than a property's or a
// label's.
function namedOf(n: Ref<AnyNode>): string | undefined {
  if (n.of === "typeNode") {
    const t = n.node;
    if (t.kind === "ref" || t.kind === "infer" || t.kind === "mapped" || t.kind === "predicate") return t.name;
    return undefined;
  }
  if (n.of === "expr") {
    const e = n.node;
    if (e.kind === "ident") return e.name;
    if (e.kind === "function" || e.kind === "class") return e.name;
    return undefined;
  }
  if (n.of === "stmt") {
    const s = n.node;
    if (s.kind === "function" || s.kind === "enum" || s.kind === "typeAlias" || s.kind === "interface") return s.name;
    if (s.kind === "class") return s.name;
    return undefined;
  }
  if (n.of === "pattern") {
    const p = n.node;
    if (p.kind === "ident" || p.kind === "variant") return p.name;
    return undefined;
  }
  if (n.of === "typeAlias") return n.node.name;
  if (n.of === "interface") return n.node.name;
  if (n.of === "func") return n.node.name;
  return undefined;
}

// The type parameters a node declares.
function typeParamsOf(n: Ref<AnyNode>): Ref<TypeParam[]> | undefined {
  if (n.of === "typeNode") {
    const t = n.node;
    if (t.kind === "function") return t.typeParams;
    return undefined;
  }
  if (n.of === "expr") {
    const e = n.node;
    if (e.kind === "function") return e.typeParams;
    if (e.kind === "arrow") return e.typeParams;
    if (e.kind === "class") return e.typeParams;
    return undefined;
  }
  if (n.of === "stmt") {
    const s = n.node;
    if (s.kind === "function") return s.typeParams;
    if (s.kind === "enum") return s.typeParams;
    if (s.kind === "typeAlias") return s.typeParams;
    if (s.kind === "interface") return s.typeParams;
    if (s.kind === "class") return s.typeParams;
    return undefined;
  }
  if (n.of === "typeMember") {
    const m = n.node;
    if (m.kind === "method") return m.typeParams;
    if (m.kind === "call" || m.kind === "construct") return m.typeParams;
    return undefined;
  }
  if (n.of === "objectProp") {
    const p = n.node;
    if (p.kind === "method") return p.typeParams;
    return undefined;
  }
  if (n.of === "classMember") {
    const m = n.node;
    if (m.kind === "method") return m.typeParams;
    return undefined;
  }
  if (n.of === "classNode") return n.node.typeParams;
  if (n.of === "typeAlias") return n.node.typeParams;
  if (n.of === "interface") return n.node.typeParams;
  if (n.of === "func") return n.node.typeParams;
  return undefined;
}

// Changes made to a tree in place as it is rebuilt, by node id: names given, shorthand properties
// written out, an argument dropped from a call and the encoding dropped from an options object.
class Edits implements Replacements {
  names: Map<usize, string> = new Map<usize, string>();
  shorthands: Map<usize, { name: string; id: usize }> = new Map<usize, { name: string; id: usize }>();
  dropped: Map<usize, usize> = new Map<usize, usize>();
  unencoded: Set<usize> = new Set<usize>();

  isEmpty(): boolean {
    return this.names.size === 0 && this.shorthands.size === 0 && this.dropped.size === 0 && this.unencoded.size === 0;
  }

  current(node: Expr): Expr {
    let n = node;
    const name = this.names.get(n.id);
    if (name !== undefined) {
      if (n.kind === "ident") n.name = name;
      else if (n.kind === "function") n.name = name;
      else if (n.kind === "class") n.name = name;
    }
    const at = this.dropped.get(n.id);
    if (at !== undefined && n.kind === "call") n.args.splice(at as i64, 1);
    if (this.unencoded.has(n.id) && n.kind === "object") {
      let props = n.props.splice(0);
      while (props.length > 0) {
        const p = props.shift()!;
        if (!isEncoding(p)) n.props.push(p);
      }
    }
    return n;
  }

  currentStmt(node: Stmt): Stmt {
    let n = node;
    const name = this.names.get(n.id);
    if (name !== undefined) {
      if (n.kind === "function") n.name = name;
      else if (n.kind === "enum") n.name = name;
      else if (n.kind === "typeAlias") n.name = name;
      else if (n.kind === "interface") n.name = name;
      else if (n.kind === "class") n.name = name;
    }
    return n;
  }

  currentTypeNode(node: TypeNode): TypeNode {
    let n = node;
    const name = this.names.get(n.id);
    if (name !== undefined) {
      if (n.kind === "ref") n.name = name;
      else if (n.kind === "infer") n.name = name;
      else if (n.kind === "mapped") n.name = name;
      else if (n.kind === "predicate") n.name = name;
    }
    return n;
  }

  currentPattern(node: Pattern): Pattern {
    let n = node;
    const name = this.names.get(n.id);
    if (name !== undefined) {
      if (n.kind === "ident") n.name = name;
      else if (n.kind === "variant") n.name = name;
    }
    return n;
  }

  currentObjectProp(node: ObjectProp): ObjectProp {
    if (node.kind !== "shorthand") return node;
    const made = this.shorthands.get(node.id);
    if (made === undefined) return node;
    return { id: node.id, kind: "property", key: node.name, value: { id: made.id, kind: "ident", name: made.name, start: node.start, end: node.end }, start: node.start, end: node.end };
  }

  currentTypeParam(node: TypeParam): TypeParam {
    let n = node;
    const name = this.names.get(n.id);
    if (name !== undefined) n.name = name;
    return n;
  }

  currentClassNode(node: ClassNode): ClassNode {
    let n = node;
    const name = this.names.get(n.id);
    if (name !== undefined) n.name = name;
    return n;
  }

  currentTypeAlias(node: TypeAlias): TypeAlias {
    let n = node;
    const name = this.names.get(n.id);
    if (name !== undefined) n.name = name;
    return n;
  }

  currentInterface(node: Interface): Interface {
    let n = node;
    const name = this.names.get(n.id);
    if (name !== undefined) n.name = name;
    return n;
  }

  currentFunc(node: Func): Func {
    let n = node;
    const name = this.names.get(n.id);
    if (name !== undefined) n.name = name;
    return n;
  }

  currentTupleElement(node: TupleElement): TupleElement {
    return node;
  }

  currentTypeMember(node: TypeMember): TypeMember {
    return node;
  }

  currentClassMember(node: ClassMember): ClassMember {
    return node;
  }

  currentParam(node: Param): Param {
    return node;
  }

  currentMatchArm(node: MatchArm): MatchArm {
    return node;
  }

  currentPatternProp(node: PatternProp): PatternProp {
    return node;
  }

  currentSpecifier(node: Specifier): Specifier {
    return node;
  }

  currentEnumMember(node: EnumMember): EnumMember {
    return node;
  }

  currentSwitchCase(node: SwitchCase): SwitchCase {
    return node;
  }

  currentDeclarator(node: Declarator): Declarator {
    return node;
  }

  currentList(_owner: usize, _field: string): Stmt[] | undefined {
    return undefined;
  }
}

// A type as written, without where or its ids, to compare two declarations' types by.
function shapeOf(t: Ref<TypeNode | undefined>): string {
  return t === undefined ? "" : quotedShape(quoteTree({ of: "typeNode", node: t }));
}

function quotedShape(v: Ref<QuoteValue>): string {
  switch (v.kind) {
    case "none":
      return "";
    case "text":
      return JSON.stringify(v.value);
    case "boolean":
      return v.value ? "true" : "false";
    case "int":
      return `${v.value}`;
    case "bigint":
      return `${v.value}n`;
    case "float":
      return `${v.value}`;
    case "list":
      return `[${v.items.map((x) => quotedShape(x)).join(",")}]`;
    case "node": {
      let parts: string[] = [];
      for (const f of v.fields) if (f.name !== "start" && f.name !== "end" && f.name !== "id") parts.push(`${f.name}:${quotedShape(f.value)}`);
      return `${v.of}{${parts.join(",")}}`;
    }
  }
  return "";
}

// Moves an error raised while parsing a file to where the file sits in the program.
function shiftError(e: Mut<CompileError>, by: usize): void {
  e.start += by;
  e.end += by;
  if (e.note !== undefined) {
    e.note.start += by;
    e.note.end += by;
  }
}
