#!/usr/bin/env bun
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { constants, tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import { bodyOf, type Arenas } from "./arenas.fsh";
import { C_KEYWORDS } from "./check.fsh";
import { codegenChecked, compiledOf, pointerSymbol, shortened, symbolIn, symbolNames, type Emitted, type Options } from "./codegen.fsh";
import { demangled, helperName, namesFrom, namesText, plainName } from "./demangle.fsh";
import { fileCosts, formatFiles, formatMemory, formatTimings, formatUsage, FRONT_END, NATIVE_STAGES, newCompilation, newSession, newTimings, objectsNote, partEnd, partStart, stageEnd, stageStart, STOP_STAGES, stopAfter, type Compilation, type Peaks, type Reading, type Session, type Tables, type Timings } from "./compilation.fsh";
import { expanded, sourced } from "./analysis.fsh";
import { cachedSession } from "./mathlib.fsh";
import { CompileError, copyNames, formatError, movedOffset, type BorrowEvent, type Names, type Source } from "./diag.fsh";
import { load, type Loaded, type RustCrate } from "./modules.fsh";
import { resolvePackages } from "./dependencies.fsh";
import { pack, prepare, submit, unsafeDependencies } from "./publish.fsh";
import { openIndex, registryUrl } from "./registry_index.fsh";
import { formatVersion, parseRange, maxSatisfying, type Version } from "./semver.fsh";
import { createPackage, type Edition, fieldError, findManifest, loadManifest, MANIFEST, NAME_RULE, readManifest, vacant, validName, withDependency } from "./manifest.fsh";
import { parse, parseWithComments, type Stmt } from "./parser.fsh";
import type { Ids } from "./nodes.fsh";
import { bundle } from "./bundle.fsh";
import { JS_NATIVE } from "./js_native.fsh";
import { NATIVE, SQLITE_NATIVE, TLS_NATIVE, tlsStub, ZLIB_NATIVE } from "./native.fsh";
import { objectOf } from "./macho.fsh";
import { cachedObjects, files, MATH_RUNTIME, NATIVE_UNIT, mathObjects, mathObjectsAsync, mathUnits, objectAsync, objectPath, sourceRoot, type BuildSession, type Unit } from "./mathlib.fsh";
import { RUNTIME } from "./runtime.fsh";
import { copyTarget, dockerfile, dockerfilePath, findOpenSsl, hostTarget, hostTriple, instrumented, linkerFlags, resolveTarget, sanitizedTarget, staticTarget, type Target } from "./target.fsh";
import { fishFiles, formatPaths, formatStdin, rewrite } from "./fmt.fsh";
import { serveLsp } from "./lsp.fsh";
import { directive, fix, migrations, REJECTS, type Imported } from "./migrate.fsh";
import { hideMains, harnessImports, harnessMain, liftTests, runDefaults, runTests, stopTests, type RunOptions, type Test } from "./tests.fsh";
import { formatRanking, rank, readPlan, type Plan } from "./rank.fsh";
import { compare, formatComparison, formatReport, readReport, sources, survey, type Report as SurveyReport } from "./survey.fsh";
import { explain } from "./codes.fsh";
import { explainBorrows, functionsIn } from "./explain.fsh";
import { openapiOf } from "./openapi.fsh";
import { complete, entries, program, REPL_VALUE, shown, thrownBy, type Entry, type ReplState } from "./repl.fsh";
import { comptimeBody } from "./comptime.fsh";
import type { InstanceId } from "./arenas.fsh";
import type { Checked, Instance } from "./check.fsh";
import type { Type, Typing } from "./typing.fsh";
import { rustShim, type Shim } from "./rustshim.fsh";
import { split } from "./split.fsh";
import { allocators, allocs, allocsJson, formatAllocs } from "./allocs.fsh";
import { formatLayouts, layoutsJson, layoutsOf, probing } from "./typelayout.fsh";
import { binaryFunctions, bloat, bloatJson, formatBloat, irFunctions, type Sized } from "./bloat.fsh";
import { withDebugInfo } from "./debuginfo.fsh";
import { watchProgram, type Rebuilt } from "./watch.fsh";
import { type Kept } from "./incremental.fsh";
import { checkedProgram, checkedSource, Queries } from "./queries.fsh";
import { fileAt } from "./program.fsh";
import { STD_BASE } from "./std.fsh";

export type Panic = "unwind" | "abort";

// `formatError` for stderr, painted on a terminal unless NO_COLOR is set, or whenever FORCE_COLOR is.
function painted(e: Ref<CompileError>, path: string, program: string, kind = "error"): string {
  const forced = process.env.FORCE_COLOR;
  const colour = forced !== undefined && forced !== "0" ? true : process.stderr.isTTY === true && (process.env.NO_COLOR ?? "") === "";
  return formatError(e, path, program, kind, colour);
}
// A library C can call: an archive to link, or a shared library to load.
export type Library = "static" | "shared";

export { analyze } from "./analysis.fsh";

// What compiling a program gives: its IR, the checked program, and the Rust crates its calls go to.
// The program as loaded comes back too, which `fishc watch` keeps. The IR is in pieces, whose text
// joined by newlines is the module's, so a large program's is never held as one string as well.
type Compiled = { ir: string[]; checked: Checked; loaded: Loaded; emitted: Emitted | undefined; helpers: Map<string, string> };

// A build session apart: what a compilation takes, and the caches only building objects reads.
type Caches = { clang?: string; digests: Map<string, string>; mathUnits?: Unit[]; backend?: string };

function apart(session: BuildSession): { core: Session; caches: Caches } {
  return { core: { locking: session.locking, engineHook: session.engineHook, std: session.std, timings: session.timings, failed: session.failed, checkCache: session.checkCache }, caches: { clang: session.clang, digests: session.digests, mathUnits: session.mathUnits, backend: session.backend } };
}

function together(core: Session, caches: Caches): BuildSession {
  return { locking: core.locking, engineHook: core.engineHook, std: core.std, timings: core.timings, failed: core.failed, checkCache: core.checkCache, clang: caches.clang, digests: caches.digests, mathUnits: caches.mathUnits, backend: caches.backend };
}

// `session` for a build that keeps nothing of its check once its program is emitted.
function plain(session: Session): Session {
  let made = session;
  made.plain = true;
  return made;
}

// Compiles the program whose entry is `file`, with text `src`, and every file it imports.
/** @throws {CompileError | Error | IoError | JsonError} */
export function compile(session: Session, src: string, file: string, release = false, panic: Panic = "unwind", library = false, leaks = false, debug = false): string {
  let looked: string[] = [];
  return compiledIn(newCompilation(session), src, file, release, panic, library, leaks, debug, looked).ir.join("\n");
}

// Checks the program whose entry is `file` as `compile` would, generating nothing; throws its
// first CompileError. Gives the warnings.
/** @throws {CompileError | Error | IoError} */
export function checkProgram(session: Session, file: string): CompileError[] {
  return checkedFile(session, file).warnings;
}

// `checkProgram`, giving the session back with the check's timings.
/** @throws {CompileError | Error | IoError} */
function checkedFile(session: Session, file: string): { warnings: CompileError[]; session: Session } {
  let looked: string[] = [];
  let queries = new Queries(file, undefined, new Map<string, string>());
  const kept = queries.checked(session, looked, undefined);
  let { checked } = kept;
  return { warnings: checked.warnings, session: checked.tables.session };
}

// The program checked and turned into IR, timed as the codegen stage, its packages bundled in and,
// in a debug build, its debug info added.
/** @throws {CompileError | Error | IoError | JsonError} */
function compiledIn(compilation: Compilation, src: string, file: string, release: boolean, panic: Panic, library: boolean, leaks: boolean, debug: boolean, looked: Mut<string[]>): Compiled {
  let program = compilation;
  // What a build's codegen fails on is collected in the session's list, when it has one.
  const failed = program.session.failed;
  program.session.failed = undefined;
  let made = checkedSource(program, file, src, library ? runtimeNames() : false, looked);
  const sources = [...made.loaded.sources];
  return generated(made.checked, made.loaded, { src, file, release, panic, library, sources, leaks, debug, failed });
}

// `codegenChecked`, its errors given the program's files. A function of its own so that what
// codegen made is returned straight from the call: unwrapped from a local after the `try`, the
// checked program and its IR would be copied whole while the originals stayed alive.
/** @throws {CompileError | Error | IoError | JsonError} */
function codegenSourced(checked: Checked, options: Options, names: Names, sources: Ref<Source[]>): { ir: string[]; checked: Checked; emitted: Emitted | undefined; helpers: Map<string, string> } {
  try {
    return codegenChecked(checked, options);
  } catch (e) {
    if (e instanceof CompileError) throw sourced(e, names, sources);
    throw e;
  }
}

// The IR of a checked program, timed as the codegen stage, with its packages bundled in and, in a
// debug build, its debug info added.
/** @throws {CompileError | Error | IoError | JsonError} */
function generated(checked: Checked, loaded: Loaded, options: Options): Compiled {
  const names = copyNames(checked.tables.names);
  const { src, file, release } = options;
  const debug = options.debug === true;
  const started = stageStart(checked.tables.session);
  let done = codegenSourced(checked, options, names, loaded.sources);
  const bundling = partStart(done.checked.tables.session);
  let ir = bundled(done.ir, loaded);
  if (debug) ir = [withDebugInfo(ir.join("\n"), src, file, [...loaded.sources], release)];
  partEnd(done.checked.tables.session, "codegen bundle", bundling);
  stageEnd(done.checked.tables.session, "codegen", started);
  stopAfter(done.checked.tables.session, "codegen");
  return { ir, checked: done.checked, loaded, emitted: done.emitted, helpers: done.helpers };
}

// The IR with the program's packages bundled into it, those its code reaches, when it reaches any.
/** @throws {CompileError | Error | IoError | JsonError} */
function bundled(ir: string[], loaded: Ref<Loaded>): string[] {
  let seen = new Set<usize>();
  for (const line of linesWith(ir, "@fsh_rt_js_export(ptr @fsh.js.bundle")) {
    const m = /^\s+(?:%\S+ = )?(?:call|invoke) ptr @fsh_rt_js_export\(ptr @fsh\.js\.bundle, i64 (\d+)/.exec(line);
    if (m !== null) seen.add((Number(m[1]!) ?? 0) as usize);
  }
  let used = [...seen];
  used.sort((a, b) => (a as i64) - (b as i64));
  if (used.length === 0) return ir;
  const bytes = new TextEncoder().encode(bundle(loaded.packages, used));
  let text = "";
  const hex = "0123456789ABCDEF";
  for (const c of bytes) text += c >= 0x20 && c < 0x7f && c !== 0x22 && c !== 0x5c ? String.fromCharCode(c as u16) : `\\${hex.charAt((c >> 4) as i64)}${hex.charAt((c & 15) as i64)}`;
  let out = ir;
  out.push(`@fsh.js.bundle = private unnamed_addr constant [${bytes.length + 1} x i8] c"${text}\\00"`);
  out.push("");
  return out;
}

// The C names a library's exports can't take besides C's keywords, since an export would replace
// them: the runtime's own calls, read from its code without its comments and strings, then the
// math and unwinding functions the IR, or LLVM lowering it, calls, which no text names, then the
// runtime's `Math` functions and the C ones they call.
const LOWERED = ["fma", "feclearexcept", "feraiseexcept", "pow", "powf", "fmod", "fmodf", "sqrt", "sqrtf", "floor", "floorf", "ceil", "ceilf", "trunc", "truncf", "round", "roundf", "fabs", "fabsf", "exp", "expf", "log", "logf", "sin", "sinf", "cos", "cosf", "memset", "memmove", "memcpy", "memcmp", "bzero", "abort", "exit", "fflush", "dprintf", "printf", "malloc", "calloc", "realloc", "free", "write", "qsort"];
export function runtimeNames(): Set<string> {
  let names = new Set<string>();
  const code = NATIVE.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g, " ");
  for (const m of code.matchAll(/\b([a-z_][a-z0-9_]*)\s*\(/g)) if (!C_KEYWORDS.has(m[1]!)) names.add(m[1]!);
  for (const line of RUNTIME) {
    const m = /^declare [^@]*@([\w.]+)\(/.exec(line);
    if (m !== null) names.add(m[1]!);
  }
  for (const f of LOWERED) names.add(f);
  for (const f of MATH_RUNTIME) names.add(`fsh_math_${f}`);
  return names;
}

// Builds `file` into a library at `out`'s directory, `lib<name>.a` or a shared one, with
// `<name>.h` declaring its exports beside it. Gives the warnings.
/** @throws {CompileError | Error | IoError | JsonError} */
export function buildLibrary(session: BuildSession, file: string, out: string, kind: Library, release = false, panic: Panic = "unwind", links: string[] = [], target: Target = hostTarget(), debug = false): CompileError[] {
  const src = readFileSync(file, "utf8");
  let { core, caches } = apart(session);
  let looked: string[] = [];
  const made = compiledIn(newCompilation(core), src, file, release, panic, true, false, debug, looked);
  const pieces: Ref<string[]> = made.ir;
  const ir = pieces.join("\n");
  const checked: Ref<Checked> = made.checked;
  const shim = rustShim(made.loaded.rust, checked);
  if (shim !== undefined) refuseForeignRust(target);
  if (!existsSync(dirname(out))) throw new Error(`can't write the library: the directory '${dirname(out)}' doesn't exist`);
  const name = basename(out).replace(/^lib/, "").replace(/\.(a|so|dylib)$/, "");
  const dir = mkdtempSync(join(tmpdir(), "fishc-"));
  const fish = join(dir, "fish.o");
  const optimize = release ? "-O2" : "-O0";
  const none: string[] = [];
  const g = debug ? ["-g"] : [...none];
  // A library is never timed, so its objects are built within a session holding only the caches.
  let building = together(newSession(), caches);
  try {
    let objects: string[] = [];
    for (const o of cachedObjects(building, runtimeUnits(pieces, release, true, copyTarget(target)))) objects.push(o);
    for (const o of mathObjects(building, [...target.compile])) objects.push(o);
    if (kind === "shared") {
      const darwin = target.triple === "" ? process.platform === "darwin" : target.triple.includes("-apple-");
      const extension = darwin ? "dylib" : "so";
      run(["clang", ...target.compile, ...target.link, ...linkerFlags(target), "-shared", "-fPIC", "-pthread", "-x", "ir", "-", "-x", "none", ...objects, "-funwind-tables", "-o", join(dirname(out), `lib${name}.${extension}`), optimize, ...g, "-lm", ...links.map((l) => `-l${l}`), ...runtimeLinks(pieces, target), ...(shim !== undefined ? [shim.lib, ...shim.links] : none)], ir);
    } else {
      run(["clang", ...target.compile, "-c", "-fPIC", "-x", "ir", "-", "-o", fish, optimize, ...g], ir);
      const archive = shim !== undefined ? join(dir, "fish.a") : join(dirname(out), `lib${name}.a`);
      if (target.ar !== "ar" && Bun.which(target.ar) === null) throw new Error(`fishc build: a static library for ${target.triple} is archived with llvm-ar, which isn't on PATH; install LLVM and put its bin directory on PATH, or build with --lib=shared`);
      run([target.ar, "rcs", archive, fish, ...objects]);
      // The shim's archive is merged in, so the library is still one file to link.
      if (shim !== undefined && process.platform === "darwin") run(["libtool", "-static", "-o", join(dirname(out), `lib${name}.a`), archive, shim.lib]);
      else if (shim !== undefined) run(["ar", "-M"], `CREATE ${join(dirname(out), `lib${name}.a`)}\nADDLIB ${archive}\nADDLIB ${shim.lib}\nSAVE\nEND\n`);
    }
    let exported: Ref<Instance>[] = [];
    for (const i of compiledOf(checked)) if (bodyOf(checked.tables.arenas, i).exported === true) exported.push(i);
    writeFileSync(join(dirname(out), `${name}.h`), header(name, checked.tables, exported));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return made.checked.warnings;
}

// Runs a command to its end with `stdin` as its input when given, throwing its stderr if it fails.
/** @throws {Error | IoError} */
function run(args: string[], stdin?: string): void {
  const command = args[0]!;
  const done = stdin === undefined ? Bun.spawnSync(args) : Bun.spawnSync(args, { stdin: new TextEncoder().encode(stdin) });
  if (done.exitCode !== 0) throw new Error(`${command} failed:\n${new TextDecoder().decode(done.stderr)}`);
}

// A C header declaring a library's exports, usable from C and C++. A parameter named like a C
// keyword is left unnamed, as C allows.
function header(name: string, tables: Ref<Tables>, exports: Ref<Ref<Instance>[]>): string {
  const guard = `${/^[A-Za-z]/.test(name) ? "" : "FISH_"}${name.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_H`;
  let lines: string[] = [];
  for (const i of exports) {
    let params: string[] = [];
    for (const p of bodyOf(tables.arenas, i).params) {
      const local = tables.arenas.localOf(i.locals.get(p)!);
      const c = cType(tables.typing, local.type);
      const named = /^[A-Za-z_][A-Za-z0-9_]*$/.test(local.name) && !C_KEYWORDS.has(local.name);
      params.push(named ? `${c}${c.endsWith("*") ? "" : " "}${local.name}` : c);
    }
    lines.push(`${cType(tables.typing, i.returns)} ${bodyOf(tables.arenas, i).name}(${params.length > 0 ? params.join(", ") : "void"});`);
  }
  return [`#ifndef ${guard}`, `#define ${guard}`, "", "#include <stdbool.h>", "#include <stddef.h>", "#include <stdint.h>", "", "#ifdef __cplusplus", 'extern "C" {', "#endif", "", ...lines, "", "#ifdef __cplusplus", "}", "#endif", "", `#endif`, ""].join("\n");
}

// How C names a type that crosses to it. A raw pointer's target is `const` unless it is a
// `MutPtr`, after the `*` when the target is itself a pointer; a target C has no name for is
// `void`.
function cType(typing: Ref<Typing>, t: Type): string {
  if (typeof t !== "string") {
    const r = typing.rec(t);
    if (r.kind !== "pointer") return "void";
    const to = cType(typing, r.to);
    const pointer = typeof r.to !== "string" && typing.kindOf(r.to) === "pointer";
    const target = r.mutable ? to : pointer ? `${to}const` : `const ${to}`;
    return `${target}${target.endsWith("*") ? "" : " "}*`;
  }
  const names = new Map<string, string>([["boolean", "bool"], ["f32", "float"], ["f64", "double"], ["usize", "size_t"], ["isize", "ptrdiff_t"]]);
  const known = names.get(t);
  if (known !== undefined) return known;
  if (/^[iu](8|16|32|64|128)$/.test(t)) return t.startsWith("u") ? `uint${t.slice(1)}_t` : `int${t.slice(1)}_t`;
  return "void";
}

// Compiles `file` to a native executable at `out`, piping the IR through clang and linking the
// cached runtime objects.
// `links` names the C libraries the program's declared functions come from. With `leaks`, the
// program reports at exit what it never freed, by where it was allocated. Gives the warnings.
/** @throws {CompileError | Error | IoError | JsonError} */
export function build(session: BuildSession, file: string, out: string, release = false, panic: Panic = "unwind", links: string[] = [], target: Target = hostTarget(), leaks = false, debug = false): CompileError[] {
  let looked: string[] = [];
  return built(session, file, out, release, panic, [...links], target, leaks, debug, looked).warnings;
}

// `build`, giving the session back, with its caches and the build's timings. `looked` is given the
// files the program was read from, or looked for, even when it doesn't build.
/** @throws {CompileError | Error | IoError | JsonError} */
function built(session: BuildSession, file: string, out: string, release: boolean, panic: Panic, links: string[], target: Target, leaks: boolean, debug: boolean, looked: Mut<string[]>): { warnings: CompileError[]; session: BuildSession } {
  let { core, caches } = apart(session);
  let ready = readied(core, caches, file, release, panic, leaks, debug, looked, target);
  let known = new Map<string, string[]>();
  linked(ready.building, ready.natives, ready.split, out, release, links, ready.shim, target, leaks, debug, known);
  writeFileSync(`${out}.fshnames`, ready.names);
  return { warnings: ready.warnings, session: ready.building };
}

// A build up to its IR and how clang takes it, which is all linking reads. A function of its own
// so the checked program, the loaded files and the IR, which only `fishc watch` keeps for its next
// build, are dropped as it returns: clang then compiles with nothing of them held beside it.
/** @throws {CompileError | Error | IoError | JsonError} */
function readied(core: Session, caches: Caches, file: string, release: boolean, panic: Panic, leaks: boolean, debug: boolean, looked: Mut<string[]>, target: Ref<Target>): { natives: Natives; split: { cached: Unit[]; program: string; times: [string, f64][] }; shim: Shim | undefined; warnings: CompileError[]; building: BuildSession; names: string } {
  let made = compiledKept(core, file, release, panic, leaks, debug, looked, undefined, undefined, false);
  const instrumenting = stageStart(made.kept.checked.tables.session);
  const ir = instrumentedPieces(made.ir, target);
  const shim = rustShim(made.kept.loaded.rust, made.kept.checked);
  if (shim !== undefined) refuseForeignRust(target);
  stageEnd(made.kept.checked.tables.session, "instrument", instrumenting);
  const splitting = stageStart(made.kept.checked.tables.session);
  const symbols = partSymbols(ir, made.kept.checked, release, debug);
  const names = namesTable(made.kept.checked, made.helpers);
  // The checked program and the loaded files are dropped here, so the split's copies of the IR
  // take the memory they held.
  let session = sessionOf(made.kept);
  const split = parts(ir, symbols, release, target, debug);
  stageEnd(session, "split", splitting);
  if (session.timings !== undefined) for (const [name, ms] of split.times) session.timings!.ms.set(name, ms);
  const building = together(session, caches);
  return { natives: nativesOf(ir, release, target, leaks), split, shim, warnings: made.warnings, building, names };
}

// The session a check's tables hold, the rest of what was kept dropped as this returns.
function sessionOf(kept: Kept): Session {
  let { checked } = kept;
  let { tables } = checked;
  return tables.session;
}

// `built` for `fishc watch`, from what its last build kept: a program whose files all read as they
// did is not loaded or checked again. Gives what to keep for the next build. `manifest` is the
// package's, which a build may read.
/** @throws {CompileError | Error | IoError | JsonError} */
export function builtKept(session: BuildSession, file: string, out: string, release: boolean, panic: Panic, links: string[], target: Target, leaks: boolean, debug: boolean, looked: Mut<string[]>, kept: Kept | undefined, manifest: string | undefined, keep = true): { ir: string[]; warnings: CompileError[]; session: BuildSession; kept: Kept } {
  let { core, caches } = apart(session);
  let made = compiledKept(core, file, release, panic, leaks, debug, looked, kept, manifest, keep);
  const instrumenting = stageStart(made.kept.checked.tables.session);
  const ir = instrumentedPieces(made.ir, target);
  const shim = rustShim(made.kept.loaded.rust, made.kept.checked);
  if (shim !== undefined) refuseForeignRust(target);
  stageEnd(made.kept.checked.tables.session, "instrument", instrumenting);
  const splitting = stageStart(made.kept.checked.tables.session);
  const split = parts(ir, partSymbols(ir, made.kept.checked, release, debug), release, target, debug);
  const names = namesTable(made.kept.checked, made.helpers);
  stageEnd(made.kept.checked.tables.session, "split", splitting);
  if (made.kept.checked.tables.session.timings !== undefined) for (const [name, ms] of split.times) made.kept.checked.tables.session.timings!.ms.set(name, ms);
  let { checked, parts: checkerParts, loaded, contents, carried, emitted, units } = made.kept;
  let { instances, tables, warnings } = checked;
  let building = together(tables.session, caches);
  // The next build gives the kept tables its own session.
  tables.session = newSession();
  let known: Map<string, string[]> = units !== undefined ? units! : new Map<string, string[]>();
  linked(building, nativesOf(ir, release, target, leaks), split, out, release, links, shim, target, leaks, debug, known);
  writeFileSync(`${out}.fshnames`, names);
  return { ir, warnings: made.warnings, session: building, kept: { checked: { instances, tables, warnings }, parts: checkerParts, loaded, contents, carried, emitted, units: known } };
}

// `compile` for `fishc watch`, from what its last build kept, giving the IR, the warnings and what
// to keep.
/** @throws {CompileError | Error | IoError | JsonError} */
export function compiledKept(session: Session, file: string, release: boolean, panic: Panic, leaks: boolean, debug: boolean, looked: Mut<string[]>, kept: Kept | undefined, manifest: string | undefined, keep = true): { ir: string[]; warnings: CompileError[]; kept: Kept; helpers: Map<string, string> } {
  const reusing = kept !== undefined;
  // Reading the files again and putting the changed ones back, apart from the check it times itself.
  // Counted by hand from the front end's stages, since the session it starts on moves into the
  // check's tables and takes its own copy of the timings with it.
  const began = performance.now();
  let before: f64 = 0;
  if (session.timings !== undefined) for (const name of FRONT_END) before += session.timings!.ms.get(name) ?? 0;
  let queries = new Queries(file, manifest, new Map<string, string>());
  let given = session;
  if (!keep) given.plain = true;
  let start = queries.checked(given, looked, kept);
  if (start.checked.tables.session.timings !== undefined) {
    let after: f64 = 0;
    for (const name of FRONT_END) after += start.checked.tables.session.timings!.ms.get(name) ?? 0;
    start.checked.tables.session.timings!.ms.set("reload", performance.now() - began - (after - before));
  }
  const failed = start.checked.tables.session.failed;
  start.checked.tables.session.failed = undefined;
  const sources = [...start.loaded.sources];
  // Debug info marks every function's lines, so a `-g` build emits every function again.
  let made = generated(start.checked, start.loaded, { src: readFileSync(file, "utf8"), file, release, panic, library: false, sources, leaks, debug, failed, prior: debug ? undefined : start.emitted, rechecked: start.rechecked, keep });
  let warnings = [...made.checked.warnings];
  // A clean check gives its warnings in the order they are written in, which a kept one's
  // positions only give through their files' maps.
  if (reusing) {
    const placed: Ref<Source[]> = made.loaded.sources;
    warnings.sort((a, b) => (realOffset(a.start, placed) as i64) - (realOffset(b.start, placed) as i64));
  }
  return { ir: made.ir, warnings, kept: { checked: made.checked, parts: start.parts, loaded: made.loaded, contents: start.contents, carried: start.carried, emitted: made.emitted, units: start.units }, helpers: made.helpers };
}

// How a build from what `fishc watch` kept differs from a clean build of `file`: its IR, its
// warnings, or the error it stopped at, or undefined when they match.
/** @throws {IoError} */
export function cleanDifference(session: Session, file: string, release: boolean, panic: Panic, leaks: boolean, debug: boolean, got: Ref<{ ir: string; warnings: CompileError[] } | CompileError>): string | undefined {
  let clean: { ir: string; warnings: CompileError[] } | CompileError | undefined = undefined;
  try {
    let looked: string[] = [];
    const made = compiledIn(newCompilation(session), readFileSync(file, "utf8"), file, release, panic, false, leaks, debug, looked);
    clean = { ir: made.ir.join("\n"), warnings: [...made.checked.warnings] };
  } catch (e) {
    if (!(e instanceof CompileError)) return `the clean build failed: ${(e as { message: string }).message}`;
    clean = e;
  }
  const want = clean!;
  if (want instanceof CompileError || got instanceof CompileError) {
    const wanted = want instanceof CompileError ? `error ${shownError(want)}` : "a build";
    const gave = got instanceof CompileError ? `error ${shownError(got)}` : "a build";
    return wanted === gave ? undefined : `a clean build gives ${wanted}, the kept one ${gave}`;
  }
  const wantWarnings = want.warnings.map((w) => shownError(w)).join("\n");
  const gotWarnings = got.warnings.map((w) => shownError(w)).join("\n");
  if (wantWarnings !== gotWarnings) return `the warnings differ:\n--- clean\n${wantWarnings}\n--- kept\n${gotWarnings}`;
  if (want.ir === got.ir) return undefined;
  // Told where the texts part, by the first piece one has that the other lacks.
  const wantSet = irPieces(want.ir);
  const gotSet = irPieces(got.ir);
  if (wantSet.join("\n") === gotSet.join("\n")) return `the IR has the same functions and globals as a clean build's, in another order, first apart at line ${firstDifference(want.ir, got.ir)}`;
  const missing = wantSet.find((p) => !gotSet.includes(p)) ?? gotSet.find((p) => !wantSet.includes(p)) ?? "";
  const lines = missing.split("\n");
  return `the IR differs from a clean build's, first at piece ${firstDifference(wantSet.join("\n"), gotSet.join("\n"))}: ${lines.length > 0 ? lines[0]! : ""}`;
}

// The IR's top-level pieces, each function whole and each other line on its own, sorted.
function irPieces(ir: string): string[] {
  let out: string[] = [];
  let open: string[] = [];
  for (const line of ir.split("\n")) {
    if (open.length > 0) {
      open.push(line);
      if (line.startsWith("}")) {
        out.push(open.join("\n"));
        open = [];
      }
    } else if (line.startsWith("define ")) open.push(line);
    else if (line !== "") out.push(line);
  }
  out.sort();
  return out;
}

// An error's code, place in the text now and message, as compared between builds.
function shownError(e: Ref<CompileError>): string {
  const start = realOffset(e.start, e.sources);
  return `${e.code} ${start}-${start + (e.end - e.start)} ${e.message}`;
}

// Where an offset a check holds is in the program's text now, through the map of the file it is
// in, when a kept check made one.
function realOffset(offset: usize, sources: Ref<Source[]>): usize {
  for (let i = sources.length; i > 0; i--) {
    const s: Ref<Source> = sources[i - 1]!;
    if (offset >= s.base) return s.base + movedOffset(s, offset - s.base);
  }
  return offset;
}

// The first line, from 1, where two texts differ.
function firstDifference(a: string, b: string): usize {
  const x = a.split("\n");
  const y = b.split("\n");
  let i: usize = 0;
  while (i < x.length && i < y.length && x[i] === y[i]) i++;
  return i + 1;
}

// Cargo isn't told the target yet, so a crate would be built for the host.
/** @throws {Error} */
function refuseForeignRust(target: Ref<Target>) {
  if (target.compile.includes("-target")) throw new Error(`fishc build: Rust crates can't be built for ${target.triple} yet; build on a ${target.triple} machine, or without --target`);
}

// Writes IR in pieces to stdout as its text, joined by newlines a megabyte or so at a time, so the
// whole text is never made at once.
function writePieces(pieces: Ref<string[]>): void {
  let batch: string[] = [];
  let length: usize = 0;
  for (let i: usize = 0; i < pieces.length; i++) {
    if (i > 0) batch.push("\n");
    batch.push(pieces[i]!);
    length += pieces[i]!.length;
    if (length < 1048576) continue;
    process.stdout.write(batch.join(""));
    batch = [];
    length = 0;
  }
  if (batch.length > 0) process.stdout.write(batch.join(""));
}

// The length of IR up to which a release build is one module. Clang optimizing a module holds
// about 40 bytes for each byte of it, 24 GB for the compiler's own 570 MB, so a larger program
// is compiled a file at a time, as a dev build is, and clang holds one file's code at once.
const RELEASE_MODULE_LENGTH: usize = 64 * 1024 * 1024;
// The most of one file's functions, or of std's or the program's own, that go to clang as one
// unit. Clang holds a unit of this much IR in well under a gigabyte, so several go to it side by
// side, and a large file is cut into enough units that the longest is a few heavy functions'
// rather than the file's.
const UNIT_LENGTH: usize = 2 * 1024 * 1024;

// A build's `.fshnames` table: each compiled instance whose symbol doesn't read as its Fish name
// alone, and each helper made for a type.
function namesTable(checked: Mut<Checked>, helpers: Ref<Map<string, string>>): string {
  const names = symbolNames(checked.tables.arenas, checked.tables.typing);
  // Each instance's IR symbol, its own symbol, and the arguments it was made for past those of a
  // generic class it is a member of, which its class's name already shows.
  let made: { symbol: string; own: string; args: Type[] }[] = [];
  for (const i of compiledOf(checked)) {
    const body = bodyOf(checked.tables.arenas, i);
    if (body.foreign === true || body.rust !== undefined) continue;
    let args: Type[] = [];
    for (const [k, t] of i.bindings) if (body.scope === undefined || !body.scope!.has(k)) args.push(t);
    // With no arguments of its own and no private name renamed, it reads alone as it is named.
    if (args.length === 0 && !i.symbol.includes("@")) continue;
    made.push({ symbol: `fsh.${names.get(i.id) ?? shortened(i.symbol)}`, own: i.symbol, args });
  }
  let out: [string, string][] = [];
  for (const m of made) {
    const shown = m.args.map((t) => checked.tables.typing.described(t));
    const own = shown.length === 0 ? "" : `<${shown.join(", ")}>`;
    // Shortened as the symbol is: an argument list as long as a structural type spells out reads as
    // its digest, which keeps the table small.
    const fish = shortened(m.own.replace(/([^.\s])#[0-9a-z]{6}(\.[0-9]+)?(?=$|\.)/, `$1${own}`).replace(/(#\w+)@[^.#\s]+/g, "$1"));
    if (fish !== plainName(m.symbol)) out.push([m.symbol, fish]);
  }
  // A helper's type is cut short past a line's worth, as a panic message cuts one.
  for (const [symbol, helper] of helpers) out.push([symbol, helperName(helper.length <= 320 ? helper : `${helper.slice(0, 320)}...`)]);
  return namesText(out);
}

// A build's IR as clang is given it: a release build's as one module, so `-O2` inlines across std
// and the program, unless it is over `RELEASE_MODULE_LENGTH`, and a dev build's as the program's
// part, with std's part and each of the program's files a unit of its own that the cache keeps by
// its text, so a rebuild compiles only the files whose code changed. A `-g` build keeps its files
// in the program's part, which holds the debug metadata their functions refer to.
function parts(pieces: Ref<string[]>, symbols: PartSymbols, release: boolean, target: Ref<Target>, debug = false): { cached: Unit[]; program: string; times: [string, f64][] } {
  if (release && lengthOf(pieces) < RELEASE_MODULE_LENGTH) return { cached: [], program: pieces.join("\n"), times: [] };
  // The selectors that stand in for GlobalISel drop a branch on a constant and keep the block it
  // never takes, and clang 18 passes over that block's return as it writes the unwind table, so
  // the code after it unwinds as if its frame were gone. A synchronous table says nothing at a
  // return, and a panic unwinds only from calls.
  const limit = debug ? 0 : UNIT_LENGTH;
  const halves = withoutGlobalIsel(release, target) ? split(pieces.map((p) => p.replace(/^(define [^\n]*) uwtable( personality [^\n]* \{| \{)$/gm, "$1 uwtable(sync)$2")), symbols.std, symbols.own, symbols.byFile, limit) : split(pieces, symbols.std, symbols.own, symbols.byFile, limit);
  const args = [...target.compile, "-x", "ir", "-", ...optimization(release, target), "-funwind-tables"];
  let cached: Unit[] = [];
  for (let i: usize = 0; i < halves.std.length; i++) cached.push({ name: i === 0 ? "std" : `std-${i + 1}`, args: [...args], stdin: halves.std[i]!, inputs: [] });
  for (let i: usize = 0; i < halves.rest.length; i++) cached.push({ name: `program-${i + 2}`, args: [...args], stdin: halves.rest[i]!, inputs: [] });
  for (const [file, text] of halves.groups) cached.push({ name: `file-${file.replace(/[^\w.-]/g, "_")}`, args: [...args], stdin: text, inputs: [] });
  return { cached, program: halves.program, times: [["split names", symbols.ms], ...halves.times] };
}

// The symbols of the compiled functions that go to std's part, the program's own and each of its
// files', read from the checked program so a build can drop it before the split runs.
type PartSymbols = { std: string[]; own: string[]; byFile: Map<string, string[]>; ms: f64 };

function partSymbols(pieces: Ref<string[]>, checked: Ref<Checked>, release: boolean, debug = false): PartSymbols {
  if (release && lengthOf(pieces) < RELEASE_MODULE_LENGTH) return { std: [], own: [], byFile: new Map<string, string[]>(), ms: 0 };
  const naming = performance.now();
  const arenas: Ref<Arenas> = checked.tables.arenas;
  const names = symbolNames(arenas, checked.tables.typing);
  let std: string[] = [];
  let own: string[] = [];
  let byFile = new Map<string, string[]>();
  for (const i of compiledOf(checked)) {
    const body = bodyOf(arenas, i);
    if (body.foreign === true || body.rust !== undefined) continue;
    // A function taking large values through pointers has a body under a second name, which goes
    // with it; a name no function has is never asked for.
    const symbols = [symbolIn(arenas, i, names), pointerSymbol(symbolIn(arenas, i, names))];
    if (body.start >= STD_BASE) {
      for (const symbol of symbols) std.push(symbol);
      continue;
    }
    for (const symbol of symbols) own.push(symbol);
    if (debug) continue;
    const file = fileAt(checked.tables.files, body.start);
    const had = byFile.get(file);
    if (had === undefined) byFile.set(file, [...symbols]);
    else {
      let list: string[] = had;
      for (const symbol of symbols) list.push(symbol);
      byFile.set(file, list);
    }
  }
  return { std, own, byFile, ms: performance.now() - naming };
}

// The runtime's units a program's IR needs and the libraries they link, read before the IR is
// dropped.
type Natives = { units: Unit[]; links: string[] };

/** @throws {IoError} */
function nativesOf(ir: Ref<string[]>, release: boolean, target: Ref<Target>, leaks: boolean): Natives {
  return { units: runtimeUnits(ir, release, false, copyTarget(target), leaks), links: runtimeLinks(ir, target) };
}

// Builds the program, split into `halves`, into the executable `out`.
/** @throws {Error | IoError} */
// `known` is each unit's text and object from the build before, kept by `fishc watch`, so a unit
// whose text is the same takes its object without hashing the text again.
function linked(session: Mut<BuildSession>, natives: Ref<Natives>, halves: Ref<{ cached: Unit[]; program: string }>, out: string, release: boolean, links: string[], shim: Shim | undefined, target: Ref<Target>, leaks: boolean, debug: boolean, known: Mut<Map<string, string[]>>) {
  const started = stageStart(session);
  const none: string[] = [];
  // A split program's own part is a unit beside the others, so every unit is compiled in one batch
  // and the link compiles nothing; a `-g` build's stays in the link, which gathers its debug info.
  const alongside = !debug && halves.cached.length > 0;
  let units: Unit[] = alongside ? [{ name: "program", args: [...halves.cached[0]!.args], stdin: halves.program, inputs: [] }] : [];
  for (const u of natives.units) units.push(u.clone());
  for (const u of halves.cached) units.push(u.clone());
  for (const u of mathUnits(session, [...target.compile])) units.push(u.clone());
  let objects = alongside && nativeBuild(session, release, leaks, target) ? nativeObjects(session, units, known) : knownObjects(session, units, known);
  stageEnd(session, "runtime", started);
  if (session.timings !== undefined) session.timings.notes.set("runtime", objectsNote(session.timings));
  const g = debug ? ["-g"] : none;
  const tls = [...natives.links];
  if (alongside) {
    const linking = stageStart(session);
    clang([...clangArgs(out, release, links, objects, shim, copyTarget(target), []), ...tls]);
    stageEnd(session, "link", linking);
    return;
  }
  if (session.timings === undefined) {
    clang([...clangArgs(out, release, links, objects, shim, copyTarget(target)), ...tls, ...g], halves.program);
    return;
  }
  // Timed, the program is compiled and linked by two clang calls, so each is measured on its own.
  const dir = mkdtempSync(join(tmpdir(), "fishc-"));
  try {
    const object = join(dir, "program.o");
    const compiling = stageStart(session);
    clang(["clang", ...target.compile, "-c", "-x", "ir", "-", "-o", object, "-funwind-tables", ...optimization(release, target), ...g], halves.program);
    stageEnd(session, "compile", compiling);
    const linking = stageStart(session);
    clang([...clangArgs(out, release, links, objects, shim, copyTarget(target), [object]), ...tls, ...g]);
    // On macOS the debug info stays in the object, deleted below; clang gathers it into a .dSYM
    // only when it compiles and links in one call, so it is gathered here.
    const darwin = target.triple === "" ? process.platform === "darwin" : target.triple.includes("-apple-");
    if (debug && darwin) clang(["dsymutil", out]);
    stageEnd(session, "link", linking);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// The backend a dev build's IR goes to when nothing chooses: `--backend` and FISH_BACKEND choose.
const DEFAULT_BACKEND = "llvm";

// Whether a build's IR goes to the native backend: a plain dev build for this machine, an arm64
// Mac, when the native backend is chosen. Release builds, `-g`, sanitizers, `--leaks` and other
// targets always go to clang.
function nativeBuild(session: Ref<BuildSession>, release: boolean, leaks: boolean, target: Ref<Target>): boolean {
  if ((session.backend ?? DEFAULT_BACKEND) !== "native") return false;
  if (release || leaks || target.triple !== "" || target.sanitize !== undefined) return false;
  return process.platform === "darwin" && process.arch === "arm64";
}

// The units' objects with every IR unit compiled by the native backend. A build's IR units are all
// native or all clang's, since the two pass aggregates differently, so a unit the native backend
// refuses or fails on sends them all back to clang, unless FISH_NATIVE_STRICT=1 makes that an error.
/** @throws {Error | IoError} */
function nativeObjects(session: Mut<BuildSession>, units: Ref<Unit[]>, known: Mut<Map<string, string[]>>): string[] {
  let native: Unit[] = [];
  for (const u of units) native.push(isIr(u) ? { name: u.name, args: [NATIVE_UNIT], stdin: u.stdin, inputs: [] } : u.clone());
  try {
    return knownObjects(session, native, known);
  } catch (e) {
    if (!(e instanceof Error) || !e.message.startsWith("the native backend failed") || process.env.FISH_NATIVE_STRICT === "1") throw e;
    return knownObjects(session, units, known);
  }
}

// Whether a unit is IR for clang.
function isIr(u: Ref<Unit>): boolean {
  for (let i: usize = 0; i + 1 < u.args.length; i++) if (u.args[i]! === "-x" && u.args[i + 1]! === "ir") return true;
  return false;
}

// The units' objects, in their order: for each, the one built from its text before when the text is
// the same and the object is still there, else the cache's, hashed from its text; those the cache
// lacks are compiled several at once.
/** @throws {Error | IoError} */
function knownObjects(session: Mut<BuildSession>, units: Ref<Unit[]>, known: Mut<Map<string, string[]>>): string[] {
  let objects: string[] = [];
  let fresh: Unit[] = [];
  let places: usize[] = [];
  for (let i: usize = 0; i < units.length; i++) {
    const u: Ref<Unit> = units[i]!;
    // Kept apart by backend, so `fishc watch` never takes one backend's object for the other's.
    const key = u.args.length === 1 && u.args[0]! === NATIVE_UNIT ? `${u.name}.native` : u.name;
    const was = known.get(key);
    if (u.inputs.length === 0 && was !== undefined && was[0]! === (u.stdin ?? "") && existsSync(was[1]!)) {
      if (session.timings !== undefined) session.timings!.objects.cached++;
      objects.push(was[1]!);
      continue;
    }
    objects.push("");
    fresh.push(u.clone());
    places.push(i);
  }
  const made = cachedObjects(session, fresh);
  for (let k: usize = 0; k < fresh.length; k++) {
    objects[places[k]!] = made[k]!;
    const u: Ref<Unit> = fresh[k]!;
    known.set(u.args.length === 1 && u.args[0]! === NATIVE_UNIT ? `${u.name}.native` : u.name, [u.stdin ?? "", made[k]!]);
  }
  return objects;
}

// Runs clang, or a tool beside it, throwing what it printed if it fails.
/** @throws {Error | IoError} */
function clang(args: string[], stdin?: string): void {
  const done = stdin === undefined ? Bun.spawnSync(args) : Bun.spawnSync(args, { stdin: new TextEncoder().encode(stdin) });
  if (done.exitCode !== 0) throw new Error(`clang failed:\n${new TextDecoder().decode(done.stderr)}`);
}

// `build`, with clang run without blocking, so several builds can go at once.
/** @throws {CompileError | Error | IoError | JsonError} */
export async function buildAsync(session: BuildSession, file: string, out: string, release = false, panic: Panic = "unwind", links: string[] = []): Promise<CompileError[]> {
  let { core, caches } = apart(session);
  let looked: string[] = [];
  let made = compiledIn(newCompilation(core), readFileSync(file, "utf8"), file, release, panic, false, false, false, looked);
  const host = hostTarget();
  const halves = parts(made.ir, partSymbols(made.ir, made.checked, release), release, host);
  const shim = rustShim(made.loaded.rust, made.checked);
  let building = together(made.checked.tables.session, caches);
  // ponytail: each object in turn, as Fish can't map to promises yet; Promise.all over them once it can.
  let objects: string[] = [];
  for (const u of runtimeUnits(made.ir, release)) {
    const object = await objectAsync(u, objectPath(building, u));
    objects.push(object);
  }
  for (const u of halves.cached) {
    const object = await objectAsync(u, objectPath(building, u));
    objects.push(object);
  }
  const math = await mathObjectsAsync(building);
  for (const o of math) objects.push(o);
  const compiler = Bun.spawn([...clangArgs(out, release, links, objects, shim, copyTarget(host)), ...runtimeLinks(made.ir, host)], { stdin: new TextEncoder().encode(halves.program), stderr: "pipe" });
  const errors = new Response(compiler.stderr);
  const [code, stderr] = await Promise.all([compiler.exited, errors.text()]);
  if (code !== 0) throw new Error(`clang failed:\n${stderr}`);
  return made.checked.warnings;
}

// Builds the tests of the package at `dir` into one program at `out`, unless it has none, and gives
// them in declaration order. Every `.fsh` file of the package is loaded through a generated entry,
// the harness, whose `main` runs one test by its index.
/** @throws {CompileError | Error | IoError | JsonError} */
export function buildTests(session: BuildSession, dir: string, out: string, release = false): Test[] {
  let problems: string[] = [];
  const files = fishFiles(dir, problems);
  for (const message of problems) console.error(message.replace(/^fishc fmt/, "fishc test"));
  // The harness is read as the manifest's path, which every package has and no `.fsh` file is, so
  // the files' names are written from the package's directory.
  const entry = join(dir, MANIFEST);
  const src = harnessImports(dir, [...files]);
  let { core, caches } = apart(session);
  let compilation = newCompilation(core);
  let loaded = load(compilation, entry, src);
  let tests: Test[] = [];
  let program: Stmt[] = [];
  try {
    let paths: string[] = [];
    for (const f of files) paths.push(realpathSync(f));
    tests = liftTests(compilation, loaded.modules, paths);
    if (tests.length === 0) return tests;
    hideMains(compilation, loaded.modules);
    let main = harnessMain(compilation.ids, tests, loaded.modules);
    while (main.length > 0) loaded.modules[0]!.statements.push(main.shift()!);
    program = expanded(compilation, loaded, false);
  } catch (e) {
    if (e instanceof CompileError) throw sourced(e, copyNames(compilation.names), loaded.sources);
    throw e;
  }
  const checked = checkedProgram(compilation, program, false, loaded.sources).checked;
  const sources = [...loaded.sources];
  const made = generated(checked, loaded, { src, file: entry, release, panic: "unwind", sources, harness: true });
  const shim = rustShim(made.loaded.rust, made.checked);
  const host = hostTarget();
  const halves = parts(made.ir, partSymbols(made.ir, made.checked, release), release, host);
  let building = together(made.checked.tables.session, caches);
  let none = new Map<string, string[]>();
  linked(building, nativesOf(made.ir, release, host, false), halves, out, release, [], shim, host, false, false, none);
  return tests;
}

// Runs the tests of the package at `dir` whose name holds `filter`, each in a process of its own.
// Gives the exit code.
/** @throws {Error | IoError | JsonError} */
async function testPackage(session: BuildSession, dir: string, filter: string | undefined, release: boolean, options: Ref<RunOptions>): Promise<i64> {
  const out = join(mkdtempSync(join(tmpdir(), "fishc-test-")), "tests");
  let code: i64 = 1;
  try {
    code = await testsIn(session, dir, out, filter, release, options);
  } catch (e) {
    rmSync(dirname(out), { recursive: true, force: true });
    throw e;
  }
  rmSync(dirname(out), { recursive: true, force: true });
  return code;
}

// A whole number above 0 written in decimal, as `--timeout` and `--jobs` take, or undefined.
function wholeNumber(text: string): usize | undefined {
  if (!/^[1-9][0-9]{0,8}$/.test(text)) return undefined;
  return (Number(text) ?? 0) as usize;
}

// `testPackage`'s build and run, the build at `out`.
/** @throws {Error | IoError | JsonError} */
async function testsIn(session: BuildSession, dir: string, out: string, filter: string | undefined, release: boolean, options: Ref<RunOptions>): Promise<i64> {
  let running = new Set<i32>();
  try {
    const tests = buildTests(session, dir, out, release);
    if (tests.length === 0) {
      console.log("no tests found");
      return 0;
    }
    const chosen = filter === undefined ? tests : tests.filter((t) => t.name.includes(filter));
    if (chosen.length > 0) {
      const code = await Promise.race([runTests(running, out, chosen, dir, options), signalled("SIGINT", 130), signalled("SIGTERM", 143)]);
      // Interrupted, the tests still running and what they started end.
      stopTests(running);
      return code;
    }
    console.error(`fishc test: no test's name contains '${filter ?? ""}'`);
    return 1;
  } catch (e) {
    if (!(e instanceof CompileError)) throw e;
    // The harness's own text is generated, and an error in it would be the compiler's.
    console.error(painted(e, relative(process.cwd(), join(dir, MANIFEST)), ""));
    return 1;
  }
}

// The exit code a shell gives for `signal`, once it arrives.
function signalled(signal: "SIGINT" | "SIGTERM", code: i64): Promise<i64> {
  return new Promise<i64>((resolve) => {
    process.once(signal, () => resolve(code));
  });
}

// Lints the TS-compat files among `paths`, a directory standing for its `.fsh` files as for
// `fishc fmt`, and a `.ts` file named itself being TS-compat: each rule's hit is printed as an
// error is, then the count. A file named itself that is native is said to have nothing to lint.
// With `fixing`, each file's auto fixes are written first, a `.ts` file moving to its `.fsh` name,
// and what is left is reported. Gives the exit code: 1 when anything is to change or couldn't be
// read or written, else 0.
/** @throws {IoError} */
function lintPaths(paths: string[], fixing: boolean): i64 {
  let code = 0;
  const problem = (message: string) => {
    console.error(message.replace(/^fishc fmt/, "fishc lint"));
    code = 1;
  };
  let files: { path: string; named: boolean }[] = [];
  for (const path of paths) {
    if (!existsSync(path)) problem(`fishc lint: can't find '${path}'`);
    else if (statSync(path).isDirectory()) {
      let problems: string[] = [];
      const found = fishFiles(path, problems);
      for (const message of problems) problem(message);
      for (const f of found) files.push({ path: f, named: false });
    }
    else files.push({ path, named: true });
  }
  // A manifest that can't be read is reported once, as "broken", and its files are skipped.
  let editions = new Map<string, Edition | "broken">();
  const packaged = (file: string): Edition | "broken" | undefined => {
    const manifest = findManifest(dirname(file));
    if (manifest === undefined) return undefined;
    if (!editions.has(manifest)) {
      try {
        const edition = loadManifest(manifest).edition;
        editions.set(manifest, edition);
      } catch (e) {
        editions.set(manifest, "broken");
        throw e;
      }
    }
    return editions.get(manifest);
  };
  // The `.ts` files named that move to their `.fsh` names under `--fix`, settled before any file is
  // written: each parses, its fixes apply, and no file has its `.fsh` name. Imports are renamed
  // against these and the `.fsh` files already there, and only then.
  let settled = new Set(files.filter((f) => f.named && f.path.endsWith(".ts") && !f.path.endsWith(".d.ts") && !existsSync(`${f.path.slice(0, -3)}.fsh`) && fixes(f.path)).map((f) => resolve(f.path)));
  // The files written with an import of each settled file's `.fsh` name.
  let importers = new Map<string, string[]>();
  const noFiles: string[] = [];
  let hits = 0;
  let changed = 0;
  // A file a fix left unparsable, which fixedText has reported.
  let unfixable = false;
  for (const { path, named } of files) {
    let at = path;
    let shown = fromHere(path);
    let src = "";
    try {
      if (named && path.endsWith(".d.ts")) {
        console.log(`fishc lint: '${shown}' is a declaration file, which describes JavaScript rather than holding code to port, so it isn't linted`);
        continue;
      }
      src = readFileSync(path, "utf8");
      const typescript = named && path.endsWith(".ts");
      let edition: Edition | "broken" = "native";
      const written = directive(src)?.edition;
      if (typescript) edition = "ts-compat";
      else if (written !== undefined) edition = written;
      else {
        const inPackage = packaged(path);
        if (inPackage !== undefined) edition = inPackage;
      }
      if (edition === "broken") continue;
      if (edition === "native") {
        if (named) console.log(`fishc lint: '${shown}' is in the native edition, so there's nothing to lint`);
        continue;
      }
      let parsing: Ids = { last: 0 };
      parse(src, parsing);
      if (fixing) {
        const to = typescript ? `${path.slice(0, -3)}.fsh` : undefined;
        if (to !== undefined && existsSync(to)) {
          problem(`fishc lint: '${shown}' isn't fixed, since '${fromHere(to)}', its Fish name, already exists`);
          continue;
        }
        const { text, fixed } = fixedText(src, shown, importsOf(path, settled));
        if (text === undefined) {
          unfixable = true;
          continue;
        }
        if (text !== src || to !== undefined) {
          const failed = rewrite(path, text, Buffer.from(src), to);
          if (failed !== undefined) {
            const target = resolve(path);
            settled.delete(target);
            const pointing = importers.get(target) ?? [...noFiles];
            const stranded = pointing.length > 0 ? `; ${pointing.map((p) => `'${p}'`).join(", ")} already import${pointing.length === 1 ? "s" : ""} its '.fsh' name, which isn't there` : "";
            problem(`fishc lint: can't write '${shown}': ${failed}${stranded}`);
            continue;
          }
        }
        for (const target of settledImports(path, src, settled)) importers.set(target, [...(importers.get(target) ?? [...noFiles]), to !== undefined ? fromHere(to) : shown]);
        if (fixed > 0) console.log(`fixed ${fixed} in ${shown}`);
        if (to !== undefined) {
          at = to;
          shown = fromHere(to);
          console.log(`renamed ${fromHere(path)} to ${shown}`);
        }
        src = text;
      }
      let numbering: Ids = { last: 0 };
      let found = migrations(parseWithComments(src, numbering), src, importsOf(path, settled));
      found.sort((a, b) => (a.start !== b.start ? (a.start as i64) - (b.start as i64) : (a.end as i64) - (b.end as i64)));
      if (at.endsWith(".ts")) found.unshift({ rule: "A10", action: "auto", start: 0, end: 0, message: `the file becomes '${basename(at, ".ts")}.fsh', its Fish name; 'fishc lint --fix' renames it` });
      for (const hit of found) console.log(formatError(new CompileError("E0802", hit.message ?? REJECTS[hit.rule]!, hit.start, hit.end), shown, src, `${hit.action} ${hit.rule}`));
      hits += found.length;
      if (found.length > 0) changed++;
    } catch (e) {
      if (!(e instanceof CompileError)) problem(`fishc lint: can't read '${shown}': ${(e as { message: string }).message}`);
      // A manifest's error carries its own source; any other is in this file.
      else problem(formatError(e, shown, src));
    }
  }
  console.log(`${hits} to change in ${changed} file${changed === 1 ? "" : "s"}`);
  return hits > 0 || unfixable ? 1 : code;
}

// What a fix does to each relative `.ts` import of the file at `path`: renamed when its `.fsh` file
// will be there, being one of `settled`, or is and the `.ts` file isn't; with both there, which is
// meant is for a person to say. It keeps its own copy of `settled`, which changes as files are written.
function importsOf(path: string, settled: Ref<Set<string>>): Imported {
  let known = new Set<string>();
  for (const t of settled) known.add(t);
  return (specifier): "rename" | "ambiguous" | undefined => {
    const target = resolve(dirname(path), specifier);
    if (known.has(target)) return "rename";
    if (!existsSync(`${target.slice(0, -3)}.fsh`)) return undefined;
    return existsSync(target) ? "ambiguous" : "rename";
  };
}

// The files of `settled` that the file at `path`, with text `src`, imports by a relative path,
// whose imports its fixes rename.
/** @throws {CompileError} */
function settledImports(path: string, src: string, settled: Ref<Set<string>>): string[] {
  let found: string[] = [];
  let ids: Ids = { last: 0 };
  for (const s of parse(src, ids)) {
    let module: string | undefined = undefined;
    if (s.kind === "import" || s.kind === "exportAll") module = s.module;
    else if (s.kind === "exportNamed") module = s.module;
    if (module === undefined || !module.startsWith(".")) continue;
    const target = resolve(dirname(path), module);
    if (settled.has(target) && !found.includes(target)) found.push(target);
  }
  return found;
}

// Compact JSON laid out as `JSON.stringify(value, null, 2)` lays it out: each member on a line of
// its own, two spaces deeper than its container, with empty containers kept as `{}` and `[]`.
export function indented(json: string): string {
  let out = "";
  let depth = 0;
  let quoted = false;
  for (let i = 0; i < json.length; i++) {
    const c = json[i]!;
    if (quoted) {
      out += c;
      if (c === "\\") {
        out += json[i + 1]!;
        i++;
      } else if (c === '"') quoted = false;
      continue;
    }
    if (c === '"') {
      quoted = true;
      out += c;
    } else if (c === "{" || c === "[") {
      const next = json[i + 1];
      if (next === "}" || next === "]") {
        out += c + next;
        i++;
      } else {
        depth++;
        out += `${c}\n${"  ".repeat(depth)}`;
      }
    } else if (c === "}" || c === "]") {
      depth--;
      out += `\n${"  ".repeat(depth)}${c}`;
    } else if (c === ",") out += `,\n${"  ".repeat(depth)}`;
    else if (c === ":") out += ": ";
    else out += c;
  }
  return out;
}

// A session for one build, with the lockfile kept as it is when `locked`, timed when `timed` or
// when `json` names where to write the times, and reading no cached check when `checking`.
function sessionWith(locked: boolean, timed: boolean, checking = false, json?: string, backend?: string): BuildSession {
  let made = cachedSession();
  const chosen = backend ?? process.env.FISH_BACKEND;
  if (chosen !== undefined && chosen !== "native" && chosen !== "llvm") fail(`fishc: the backend '${chosen!}' isn't one; give native or llvm`);
  made.backend = chosen;
  made.locking.locked = locked;
  // FISH_MEM=1 records what the process holds as each stage ends, as stages are timed.
  const memory = process.env.FISH_MEM === "1";
  // FISH_MEM_STOP=<stage> ends the process as that stage ends, with the same readings.
  const stop = process.env.FISH_MEM_STOP;
  if (stop !== undefined && !STOP_STAGES.includes(stop!)) fail(`fishc: FISH_MEM_STOP names '${stop!}', which is no stage to stop after; give ${STOP_STAGES.join(", ")}`);
  if (timed || json !== undefined || memory || stop !== undefined) {
    let timings = newTimings();
    timings.report = timed;
    if (json !== undefined) timings.json = json!;
    if (memory || stop !== undefined) timings.memory = new Map<string, Reading>();
    if (stop !== undefined) timings.stop = stop!;
    // FISH_USAGE=1 records each stage's CPU time and the peaks of fishc and of clang.
    if (process.env.FISH_USAGE === "1") timings.usage = { cpu: new Map<string, f64>(), peaks: new Map<string, Peaks>(), inner: 0 };
    made.timings = timings;
  }
  if (checking) made.checkCache = false;
  return made;
}

// Codegen's own parts, which watch's timings show apart since a rebuild may skip only some.
const CODEGEN_PARTS = ["codegen names", "codegen setup", "codegen comptime", "codegen sharing", "codegen functions", "codegen tail", "codegen assembly", "codegen kept", "codegen bundle"];
const OTHER_PARTS = ["reload compare", "reload read", "reload classify", "split names", "split items", "split reach", "split parts"];

// What one of `fishc watch`'s builds takes.
type Rebuild = { entry: string; binary: string; links: string[]; release: boolean; panic: Panic; leaks: boolean; debug: boolean; locked: boolean; timed: boolean; manifest: string | undefined };

// One of `fishc watch`'s builds: whether it built, and the files it read or looked for.
function rebuilt(r: Ref<Rebuild>, kept: Kept | undefined): Rebuilt {
  let loaded: string[] = [];
  try {
    const start = performance.now();
    let made = builtKept(sessionWith(r.locked, r.timed), r.entry, r.binary, r.release, r.panic, [...r.links], hostTarget(), r.leaks, r.debug, loaded, kept, r.manifest);
    const stages = ["reload", ...FRONT_END, "codegen", "instrument", "split", ...NATIVE_STAGES];
    reportTimings(made.session, ["reload", ...FRONT_END, "codegen", ...CODEGEN_PARTS, "instrument", "split", ...OTHER_PARTS, ...NATIVE_STAGES], start);
    // What no stage holds, so a rebuild's time is all accounted for.
    if (made.session.timings !== undefined) {
      let staged: f64 = 0;
      for (const s of stages) staged += made.session.timings!.ms.get(s) ?? 0;
      console.error(`other    ${(performance.now() - start - staged).toFixed(1).padStart(9)} ms`);
    }
    if (r.timed && made.kept.emitted !== undefined && made.kept.carried > 0) {
      const why = [...made.kept.emitted!.refusals].map(([k, n]) => `${n} ${k}`).join(", ");
      console.error(`codegen emitted ${made.kept.emitted!.reemitted} of ${made.kept.emitted!.made.size} functions again${why === "" ? "" : ` (${why})`}`);
    }
    for (const w of made.warnings) console.error(painted(w, r.entry, textOf(r.entry), "warning"));
    // Only a build from what an earlier one kept can differ from a clean one.
    saved(made.kept.carried, made.ir, made.warnings);
    if (made.kept.carried > 0 && process.env.FISH_WATCH_VERIFY !== undefined) verified(r, { ir: made.ir.join("\n"), warnings: [...made.warnings] });
    return { built: true, loaded, kept: made.kept };
  } catch (e) {
    if (e instanceof CompileError) {
      console.error(painted(e, r.entry, textOf(r.entry)));
      verified(r, e);
    } else console.error(`fishc: ${(e as { message: string }).message}`);
    return { built: false, loaded, kept: undefined };
  }
}

// With FISH_WATCH_IR set to a directory, each build's IR and warnings are written there, named by
// how many builds in a row it follows from what one kept, to compare with a clean build later
// when there's no memory for both at once.
function saved(carried: usize, ir: Ref<string[]>, warnings: Ref<CompileError[]>): void {
  const dir = process.env.FISH_WATCH_IR;
  if (dir === undefined) return;
  try {
    mkdirSync(dir!, { recursive: true });
    writeFileSync(join(dir!, `build-${carried}.ll`), ir.join("\n"));
    writeFileSync(join(dir!, `build-${carried}.warnings`), warnings.map((w) => `${w.code} ${w.message}`).join("\n"));
  } catch (e) {
    console.error(`[fishc] can't save the build's IR in ${dir!}: ${(e as { message: string }).message}`);
  }
}

// With FISH_WATCH_VERIFY set, says when a build from what watch kept differs from a clean one.
function verified(r: Ref<Rebuild>, got: Ref<{ ir: string; warnings: CompileError[] } | CompileError>): void {
  if (process.env.FISH_WATCH_VERIFY === undefined) return;
  try {
    const wrong = cleanDifference(sessionWith(r.locked, false, true), r.entry, r.release, r.panic, r.leaks, r.debug, got);
    console.error(wrong === undefined ? "[fishc] verified: the build matches a clean one" : `[fishc] verify failed: ${wrong}`);
  } catch (e) {
    console.error(`[fishc] verify failed: ${(e as { message: string }).message}`);
  }
}

// A file's text to show an error against, or none when it can't be read, as when it was removed
// while being watched.
function textOf(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (_e) {
    return "";
  }
}

// `path` from the working directory, or as it is when that is where it is.
function fromHere(path: string): string {
  const here = relative(process.cwd(), path);
  return here === "" ? path : here;
}

// Whether the TS-compat file at `path` reads, parses and takes its fixes, as a `.ts` file must
// before `--fix` moves it to its `.fsh` name.
function fixes(path: string): boolean {
  try {
    fix(readFileSync(path, "utf8"), () => undefined);
    return true;
  } catch {
    return false;
  }
}

// The file's text with its auto fixes, or undefined, said, when a fix left text that doesn't
// parse, which would be the lint's mistake.
function fixedText(src: string, shown: string, fsh: Imported): { text?: string; fixed: usize } {
  try {
    return fix(src, (specifier) => fsh(specifier));
  } catch (e) {
    console.error(`fishc lint: '${shown}' was left as it was, because a fix gave text that doesn't parse (${(e as { message: string }).message}); please report it`);
    return { fixed: 0 };
  }
}

// The vendored JS engine, compiled into a program only when it calls the engine.
// Found when a build needs them rather than while compiling, which a compiler built by Fish would
// otherwise do.
export function engineDir(): string {
  return join(sourceRoot(), "vendor", "quickjs-ng");
}

export function engineSources(): string[] {
  let sources: string[] = [];
  for (const f of ["quickjs.c", "libregexp.c", "libunicode.c", "dtoa.c"]) sources.push(join(engineDir(), f));
  return sources;
}

// Whether the IR calls into the JS engine: an instruction, not a declaration or a string's bytes.
// The lines of the IR holding `name`. A program's IR runs to hundreds of megabytes and these names
// are rare, so a regex is run over each line found rather than over the whole text.
function linesWith(pieces: Ref<string[]>, name: string): string[] {
  let out: string[] = [];
  for (const ir of pieces) {
    let at = ir.indexOf(name);
    while (at >= 0) {
      let end = ir.indexOf("\n", at);
      if (end < 0) end = ir.length as i64;
      out.push(ir.slice(ir.lastIndexOf("\n", at) + 1, end));
      at = ir.indexOf(name, end);
    }
  }
  return out;
}

// The length of the text pieces of IR make, joined by newlines.
function lengthOf(pieces: Ref<string[]>): usize {
  let n: usize = pieces.length > 0 ? pieces.length - 1 : 0;
  for (const p of pieces) n += p.length;
  return n;
}

// The IR in pieces as a sanitizer build gives clang it, each function marked for its sanitizer.
function instrumentedPieces(pieces: string[], target: Ref<Target>): string[] {
  if (target.sanitize === undefined) return pieces;
  return pieces.map((p) => instrumented(p, target));
}

export const callsEngine = (ir: Ref<string[]>) => linesWith(ir, "@fsh_rt_js_").some((l) => /^\s+(?:%\S+ = )?(?:call|invoke) [^"\n]*@fsh_rt_js_/.test(l));

// Whether the IR calls into the OpenSSL half of the runtime, as fetch, serve and the tls module do
// for TLS, and the postgres module and WebSocket handshakes for hashes. A function std declares
// itself is called by its quoted name.
export const callsTls = (ir: Ref<string[]>) => [...linesWith(ir, "fsh_rt_tls_"), ...linesWith(ir, "fsh_rt_crypto_")].some((l) => /^\s+(?:%\S+ = )?(?:call|invoke) [^"\n]*@"?fsh_rt_(?:tls|crypto)_/.test(l));

// Whether the IR calls into the zlib half of the runtime, as the zlib module does.
export const callsZlib = (ir: Ref<string[]>) => linesWith(ir, "fsh_rt_zlib_").some((l) => /^\s+(?:%\S+ = )?(?:call|invoke) [^"\n]*@"?fsh_rt_zlib_/.test(l));

// Whether the IR calls into the SQLite half of the runtime, as the sqlite module does.
export const callsSqlite = (ir: Ref<string[]>) => linesWith(ir, "fsh_rt_sqlite_").some((l) => /^\s+(?:%\S+ = )?(?:call|invoke) [^"\n]*@"?fsh_rt_sqlite_/.test(l));

// What links OpenSSL into a program calling the TLS runtime, when it was found, without which the
// runtime's TLS calls say how to install it, zlib into one calling the zlib runtime, and the
// system's SQLite into one calling the SQLite runtime.
export function runtimeLinks(ir: Ref<string[]>, target: Ref<Target>): string[] {
  let libraries: string[] = [];
  if (callsZlib(ir)) libraries.push("-lz");
  if (callsSqlite(ir)) libraries.push("-lsqlite3");
  if (!callsTls(ir)) return libraries;
  const openssl = findOpenSsl(target);
  const none: string[] = [];
  return [...("link" in openssl ? openssl.link : none), ...libraries];
}

// The C half of the runtime as cached objects, with the engine's glue and sources when the
// program's IR calls the engine, and the TLS, zlib and SQLite halves when it calls those. They are built with unwind tables so a panic can unwind through
// them, and position-independent when `pic`, for a library. A `--leaks` build's runtime records
// each block's site, so it is an object of its own.
/** @throws {IoError} */
export function runtimeUnits(ir: Ref<string[]>, release: boolean, pic = false, target: Target = hostTarget(), leaks = false): Unit[] {
  const js = callsEngine(ir);
  const openssl = callsTls(ir) ? findOpenSsl(target) : undefined;
  const none: string[] = [];
  const flags = [...target.compile, "-funwind-tables", "-pthread", ...optimization(release, target), ...(pic ? ["-fPIC"] : none), ...(js ? ["-I", engineDir()] : none)];
  const tls = openssl === undefined ? "" : "missing" in openssl ? "-tls-missing" : "-tls";
  const name = `${js ? "runtime-js" : "runtime"}${tls}${leaks ? "-leaks" : ""}`;
  const source = [NATIVE, ...(js ? [JS_NATIVE] : none), ...(openssl === undefined ? none : ["missing" in openssl ? tlsStub(openssl.missing) : TLS_NATIVE])].join("\n");
  const tlsFlags = openssl !== undefined && "compile" in openssl ? openssl.compile : [...none];
  const runtime: Unit = { name, args: ["-x", "c", "-", ...flags, ...tlsFlags, ...(leaks ? ["-DFSH_LEAK_SITES"] : none)], stdin: source, inputs: js ? files(engineDir()) : none };
  const engine: Unit[] = js ? engineSources().map((source): Unit => ({ name: basename(source, ".c"), args: ["-x", "c", source, ...flags], inputs: files(engineDir()) })) : [];
  const zlib: Unit[] = callsZlib(ir) ? [{ name: "zlib", args: ["-x", "c", "-", ...flags], stdin: ZLIB_NATIVE, inputs: [] }] : [];
  const sqlite: Unit[] = callsSqlite(ir) ? [{ name: "sqlite", args: ["-x", "c", "-", ...flags], stdin: SQLITE_NATIVE, inputs: [] }] : [];
  return [runtime, ...engine, ...zlib, ...sqlite];
}

// A build's optimization level. A sanitized dev build is optimized a little, as clang advises for
// its sanitizers: at -O0, clang for AArch64 misreads large aggregates passed by value to an
// address-sanitized function, so the program would quietly do something else.
function optimization(release: boolean, target: Ref<Target>): string[] {
  if (release) return ["-O2"];
  if (target.sanitize !== undefined) return ["-O1"];
  return withoutGlobalIsel(release, target) ? ["-O0", "-fno-global-isel"] : ["-O0"];
}

// Whether a build is unoptimized ARM64 code for Linux. Clang selects that with GlobalISel, which
// in clang 18 crashes on a load of an empty aggregate, as a field of a literal type is, so those
// builds go without it.
function withoutGlobalIsel(release: boolean, target: Ref<Target>): boolean {
  if (release || target.sanitize !== undefined) return false;
  return target.triple === "" ? process.platform === "linux" && process.arch === "arm64" : target.triple.startsWith("aarch64-unknown-linux");
}

// Clang's command line for a program, its IR read from stdin unless `program` names it compiled
// already, linked with `objects`.
/** @throws {Error} */
function clangArgs(out: string, release: boolean, links: string[], objects: string[], shim?: Shim, target: Target = hostTarget(), program: string[] = ["-x", "ir", "-"]): string[] {
  const none: string[] = [];
  return ["clang", ...target.compile, ...target.link, ...linkerFlags(target), ...program, "-x", "none", ...objects, "-funwind-tables", "-pthread", "-o", out, ...optimization(release, target), "-lm", ...links.map((l) => `-l${l}`), ...(shim !== undefined ? [shim.lib, ...shim.links] : none)];
}

// What computes a checked program's top-level consts for the repl: every function is checked.
class ReplHost {
  tables: Tables;

  constructor(tables: Tables) {
    this.tables = tables;
  }

  ensureChecked(this: Mut<this>, _id: InstanceId): boolean {
    return true;
  }
}

// The repl's file checked, and each top-level const in `names` computed as a build computes it,
// so one that can't be computed while compiling fails here; gives the last as `console.log`
// prints it, when that is certain.
/** @throws {CompileError | Error | IoError} */
function replComputed(session: Session, file: string, names: Ref<string[]>): string | undefined {
  let looked: string[] = [];
  let queries = new Queries(file, undefined, new Map<string, string>());
  const kept = queries.checked(session, looked, undefined);
  let { checked } = kept;
  let host = new ReplHost(checked.tables);
  let found: InstanceId[] = [];
  for (const name of names) {
    for (let i: usize = 1; i <= host.tables.arenas.instanceCount(); i++) {
      const body = bodyOf(host.tables.arenas, host.tables.arenas.instanceOf(i as InstanceId));
      if (body.comptime === "const" && body.name === `const ${name}`) found.push(i as InstanceId);
    }
  }
  let text: string | undefined = undefined;
  for (const id of found) {
    const value = comptimeBody(host, id);
    text = shown(host.tables.typing, value, host.tables.arenas.instanceOf(id).returns, false);
  }
  return found.length === names.length ? text : undefined;
}

// An error as the repl prints it: placed in the line just entered when it lies there, and in the
// whole program the line was run as otherwise.
function replError(e: Ref<CompileError>, source: string, at: usize, line: string): string {
  const end = at + line.length;
  if (e.errors.length > 0 || e.start < at || e.end > end) return painted(e, "repl", source);
  const n = e.note === undefined ? undefined : { ...e.note! };
  const note = n !== undefined && n.start >= at && n.end <= end ? { message: n.message, start: n.start - at, end: n.end - at } : undefined;
  return painted(new CompileError(e.code, e.message, e.start - at, e.end - at, note), "repl", line);
}

// What the repl needs to answer a line: what each check's session is made with, the file each line's program is
// written to, beside the working directory's own so its imports resolve, and the binary a line
// that has to run is built as.
type Repl = { locked: boolean; timed: boolean; checking: boolean; file: string; binary: string };

// Checks `above` at the top level, or checks or runs `before`, the line and `after` in `main`
// after the kept bindings, adding to what `main` declares each error the check says it throws.
// Gives "void" for a line that was to be printed and has no value.
function replTried(repl: Ref<Repl>, state: Mut<ReplState>, above: string, before: string, line: string, after: string, awaits: boolean, run: boolean): "done" | "void" | "failed" {
  for (let attempt = 0; attempt < 8; attempt++) {
    const made = program(state, above, before + line + after, true, awaits);
    try {
      writeFileSync(repl.file, made.source);
      if (run) {
        let looked: string[] = [];
        built(sessionWith(repl.locked, repl.timed, repl.checking), repl.file, repl.binary, false, "unwind", [], hostTarget(), false, false, looked);
        Bun.spawnSync([repl.binary], { stdin: "ignore", stdout: "inherit", stderr: "inherit" });
      } else replComputed(sessionWith(repl.locked, repl.timed, repl.checking), repl.file, []);
      return "done";
    } catch (e) {
      if (!(e instanceof CompileError)) {
        console.error((e as { message: string }).message);
        return "failed";
      }
      let more: string[] = [];
      if (e.code === "E0602") for (const t of thrownBy(e.message)) if (!state.throws.includes(t)) more.push(t);
      if (more.length > 0) {
        for (const t of more) state.throws.push(t);
        continue;
      }
      const nothing = e.code === "E0118" || (e.code === "E0305" && e.message.includes("gives nothing once awaited"));
      if (nothing && before !== "") return "void";
      console.error(replError(e, made.source, above !== "" ? made.at : made.at + before.length, above !== "" ? above : line));
      return "failed";
    }
  }
  return "failed";
}

// Answers one statement of a line; false when it failed, which drops the rest of the line.
function replEntry(repl: Ref<Repl>, state: Mut<ReplState>, entry: Ref<Entry>): boolean {
  if (entry.kind === "declaration") {
    if (replTried(repl, state, entry.text, "", "", "", false, false) !== "done") return false;
    state.top.push(entry.text);
    return true;
  }
  if (entry.kind === "binding") {
    // A const that can be computed while compiling stands at the top level, where the functions
    // declared after it see it; any other binding runs again inside main before each later line.
    if (entry.constant && !entry.awaits && entry.names.length > 0) {
      try {
        writeFileSync(repl.file, program(state, entry.text, "", true, false).source);
        replComputed(sessionWith(repl.locked, repl.timed, repl.checking), repl.file, entry.names);
        state.top.push(entry.text);
        return true;
      } catch (_e) {}
    }
    if (replTried(repl, state, "", "", entry.text, "", entry.awaits, false) !== "done") return false;
    state.bindings.push(entry.text);
    if (entry.awaits) state.awaits = true;
    return true;
  }
  if (entry.kind === "statement") return replTried(repl, state, "", "", entry.text, "", entry.awaits, true) === "done";
  // A pure expression is answered by the interpreter that computes top-level consts, with no
  // build; anything else, or a value whose printed form isn't certain, is built and run.
  if (!entry.awaits) {
    try {
      writeFileSync(repl.file, program(state, `const ${REPL_VALUE} = ${entry.text};`, "", false, false).source);
      const text = replComputed(sessionWith(repl.locked, repl.timed, repl.checking), repl.file, [REPL_VALUE]);
      if (text !== undefined) {
        console.log(text);
        return true;
      }
    } catch (_e) {}
  }
  // An awaited value is named first, since an await can't sit inside the call that prints it.
  const before = entry.awaits ? `const ${REPL_VALUE} = ` : "console.log(";
  const after = entry.awaits ? `;\nconsole.log(${REPL_VALUE});` : ");";
  const printed = replTried(repl, state, "", before, entry.text, after, entry.awaits, true);
  if (printed !== "void") return printed === "done";
  return replTried(repl, state, "", "", entry.text, ";", entry.awaits, true) === "done";
}

// `fishc repl`: reads lines until input ends or `.exit`, keeping declarations and bindings.
/** @throws {IoError} */
function runRepl(locked: boolean, timed: boolean, checking: boolean): never {
  const scratch = mkdtempSync(join(tmpdir(), "fishc-repl-"));
  const repl: Repl = { locked, timed, checking, file: join(process.cwd(), `.fishc-repl-${Date.now()}.fsh`), binary: join(scratch, "line") };
  let state: ReplState = { top: [], bindings: [], awaits: false, throws: [] };
  // An interrupt is how a repl is usually left, and it would leave the line's file behind.
  const file = repl.file;
  process.on("SIGINT", () => {
    try {
      rmSync(file, { force: true });
      rmSync(scratch, { recursive: true, force: true });
    } catch (_e) {}
    process.exit(130);
  });
  try {
    while (true) {
      const first = prompt("fish>");
      if (first === null) break;
      let text: string = first;
      while (!complete(text)) {
        const more = prompt("....>");
        if (more === null || more === "") break;
        text += "\n" + more;
      }
      if (text.trim() === ".exit") break;
      try {
        for (const entry of entries(text)) if (!replEntry(repl, state, entry)) break;
      } catch (e) {
        console.error(e instanceof CompileError ? painted(e, "repl", text) : (e as { message: string }).message);
      }
    }
  } finally {
    rmSync(repl.file, { force: true });
    rmSync(scratch, { recursive: true, force: true });
  }
  return process.exit(0);
}

function fail(message: string): never {
  console.error(message);
  return process.exit(2);
}

// The errors that are what `fishc explain-borrows` shows rather than what stops it.
const OWNERSHIP = new Set(["E0201", "E0202", "E0203", "E0204", "E0205"]);

// `fishc explain-borrows`: prints `file` with its moves, loans and ownership errors under the
// lines they are on, or just the function `only` names. Any other error is printed as
// `fishc check` prints it.
/** @throws {Error | IoError} */
function explainFile(file: string, only: string | undefined): never {
  let src = "";
  let range: { start: usize; end: usize } | undefined = undefined;
  try {
    src = readFileSync(file, "utf8");
    if (only !== undefined) {
      const functions = functionsIn(parse(src, { last: 0 }));
      const found = functions.find((f) => f.name === only);
      if (found === undefined) fail(`fishc explain-borrows: '${file}' has no function '${only}'; it has ${functions.length === 0 ? "none" : functions.map((f) => f.name).join(", ")}`);
      else range = { start: found.start, end: found.end };
    }
  } catch (e) {
    if (!(e instanceof CompileError)) fail(`fishc explain-borrows: can't read '${file}': ${(e as { message: string }).message}`);
    else console.error(painted(e, file, src));
    process.exit(1);
  }
  // A check read back from the cache would log nothing.
  let session = sessionWith(false, false, true);
  session.borrows = [];
  // Only this file's are kept: another file's offsets start past any this file's text reaches.
  let events: BorrowEvent[] = [];
  let errors: CompileError[] = [];
  try {
    const made = checkedFile(session, file);
    if (made.session.borrows !== undefined) for (const b of made.session.borrows) if (b.end <= src.length) events.push({ ...b });
  } catch (e) {
    if (!(e instanceof CompileError)) {
      console.error((e as { message: string }).message);
      process.exit(1);
    } else {
      if (e.errors.length > 0) for (const x of e.errors) errors.push(x.clone());
      else errors.push(e.clone());
      if (errors.some((x) => !OWNERSHIP.has(x.code) || x.end > src.length)) {
        console.error(painted(e, file, src));
        process.exit(1);
      }
      for (const b of e.borrows) if (b.end <= src.length) events.push({ ...b });
    }
  }
  console.log(explainBorrows(src, file, events, errors, range));
  return process.exit(0);
}

// `fishc openapi`: prints the OpenAPI document of the routes `file`'s program adds to std's
// routers, or writes it to `out`, and names on stderr each route the document leaves out. Its
// title and version are the package's, or the file's name and 0.0.0 for a file in no package.
/** @throws {Error | IoError} */
function openapiFile(file: string, out: string | undefined): never {
  let src = "";
  try {
    src = readFileSync(file, "utf8");
  } catch (e) {
    fail(`fishc openapi: can't read '${file}': ${(e as { message: string }).message}`);
  }
  let title = basename(file);
  let version = "0.0.0";
  const manifest = findManifest(dirname(resolve(file)));
  if (manifest !== undefined) {
    try {
      const pkg = loadManifest(manifest!);
      title = pkg.name;
      version = pkg.version;
    } catch (e) {
      if (!(e instanceof CompileError)) throw e;
      console.error(painted(e, relative(process.cwd(), manifest!), readFileSync(manifest!, "utf8")));
      process.exit(1);
    }
  }
  try {
    let looked: string[] = [];
    let queries = new Queries(file, undefined, new Map<string, string>());
    // A check read back from the cache would hold no routes.
    const kept = queries.checked(sessionWith(false, false, true), looked, undefined);
    const made = openapiOf(kept.checked.tables, title, version);
    for (const l of made.left) {
      const skipped = sourced(new CompileError("W0003", `this route is left out of the document: ${l.why}`, l.start, l.end), undefined, kept.loaded.sources);
      console.error(painted(skipped, file, src, "warning"));
    }
    const text = indented(made.document);
    if (out === undefined) console.log(text);
    else writeFileSync(out!, `${text}\n`);
  } catch (e) {
    if (e instanceof CompileError) console.error(painted(e, file, src));
    else console.error((e as { message: string }).message);
    process.exit(1);
  }
  return process.exit(0);
}

// The time each of a build's `stages` took, printed when the build was timed, with the files it
// went to, and written as JSON where `--timings-json` asks.
function reportTimings(session: Ref<Session>, stages: Ref<string[]>, start: f64) {
  if (session.timings === undefined) return;
  const total = performance.now() - start;
  if (session.timings.report) process.stderr.write(formatTimings(session.timings, stages, total) + formatFiles(session.timings, 10));
  if (session.timings.json !== undefined) {
    try {
      writeFileSync(session.timings.json!, timingsJson(session.timings, stages, total));
    } catch (e) {
      console.error(`fishc: can't write the timings to '${session.timings.json!}': ${e.message}`);
    }
  }
  if (session.timings.memory !== undefined) process.stderr.write(formatMemory(session.timings.memory!, stages));
  if (session.timings.usage !== undefined) process.stderr.write(formatUsage(session.timings.usage!, stages));
  if (session.timings.tables !== undefined) process.stderr.write(session.timings.tables!);
}

// `--timings-json`'s object: the stages in order, FISH_USAGE's readings when kept, and every file.
function timingsJson(timings: Ref<Timings>, stages: Ref<string[]>, total: f64): string {
  let staged: { stage: string; ms: f64; note?: string }[] = [];
  let usage: { stage: string; cpu: f64; peak: i64; children: i64 }[] = [];
  for (const s of stages) {
    staged.push({ stage: s.clone(), ms: timings.ms.get(s) ?? 0, note: timings.notes.get(s) });
    const p = timings.usage !== undefined ? timings.usage!.peaks.get(s) : undefined;
    if (p !== undefined) usage.push({ stage: s.clone(), cpu: timings.usage!.cpu.get(s) ?? 0, peak: p!.own, children: p!.children });
  }
  if (timings.usage === undefined) return JSON.stringify({ version: 1, total, stages: staged, files: fileCosts(timings) }) + "\n";
  return JSON.stringify({ version: 1, total, stages: staged, usage, files: fileCosts(timings) }) + "\n";
}

// A report's `--top`, 20 rows unless given.
function rowsOf(command: string, top: string | undefined): i64 {
  const rows = top === undefined ? 20 : parseInt(top);
  if (rows === undefined || rows < 1 || (top !== undefined && `${rows}` !== top)) fail(`fishc ${command}: '--top' takes a count of rows, as in --top 30`);
  return rows!;
}

// A .fsh file's IR as `build --emit-llvm` gives it, for the reports that read it. A compile error
// ends the process.
/** @throws {Error | IoError} */
function reportedIr(file: string, release: boolean): string {
  let src = "";
  try {
    src = readFileSync(file, "utf8");
    let looked: string[] = [];
    return compiledIn(newCompilation(plain(sessionWith(false, false))), src, file, release, "unwind", false, false, false, looked).ir.join("\n");
  } catch (e) {
    if (e instanceof CompileError) console.error(painted(e, file, src));
    else console.error((e as { message: string }).message);
    return process.exit(1);
  }
}

// `fishc bloat`: a .fsh file's IR by function and generic body, or a binary's machine code.
/** @throws {Error | IoError} */
function bloatReport(file: string, release: boolean, top: string | undefined, json: boolean): never {
  const rows = rowsOf("bloat", top);
  if (!existsSync(file)) fail(`fishc bloat: '${file}' doesn't exist`);
  let sized: Sized[] = [];
  let unit = "IR text";
  if (file.endsWith(".fsh")) {
    sized = irFunctions(reportedIr(file, release));
  } else {
    if (release) fail("fishc bloat: '--release' chooses how a .fsh file is compiled, and a binary is measured as it was built; leave it out");
    if (Bun.which("nm") === null) fail("fishc bloat: reading a binary's symbols needs nm, which isn't on PATH; install the Xcode command line tools or binutils");
    const done = Bun.spawnSync(["nm", "-n", file]);
    if (done.exitCode !== 0) fail(`fishc bloat: nm can't read '${file}': ${new TextDecoder().decode(done.stderr).trim()}`);
    sized = binaryFunctions(new TextDecoder().decode(done.stdout));
    unit = "machine code";
  }
  const report = bloat(unit, sized);
  process.stdout.write(json ? bloatJson(report) : formatBloat(report, rows));
  return process.exit(0);
}

// `fishc demangle`: standard input to standard output with each of the compiler's symbols in it
// named as Fish names it, from the table beside `binary`, or `names`, when one is given.
/** @throws {Error | IoError} */
function demangleReport(binary: string | undefined, names: string | undefined): never {
  if (binary !== undefined && names !== undefined) fail("fishc demangle: give a binary or '--names <file>', not both");
  if (binary !== undefined && !existsSync(binary)) fail(`fishc demangle: '${binary}' doesn't exist`);
  const path = names !== undefined ? names! : binary !== undefined ? `${binary!}.fshnames` : undefined;
  let table = new Map<string, string>();
  if (path !== undefined) {
    if (!existsSync(path!)) fail(binary !== undefined ? `fishc demangle: '${binary!}' has no names table beside it, '${path!}'; build it again with this fishc` : `fishc demangle: '${path!}' doesn't exist`);
    try {
      table = namesFrom(readFileSync(path!, "utf8"));
    } catch (e) {
      fail(`fishc demangle: '${path!}' isn't a names table: ${(e as { message: string }).message}`);
    }
  }
  process.stdout.write(demangled(new TextDecoder().decode(readFileSync(0)), table));
  return process.exit(0);
}

// `fishc allocs`: the heap allocation sites in a .fsh file's IR, through the runtime functions
// that may allocate, by function and generic body.
/** @throws {Error | IoError} */
function allocsReport(file: string, release: boolean, top: string | undefined, json: boolean): never {
  const rows = rowsOf("allocs", top);
  if (!file.endsWith(".fsh")) fail(`fishc allocs: '${file}' isn't a .fsh file; allocation sites are read from the IR a program compiles to`);
  if (!existsSync(file)) fail(`fishc allocs: '${file}' doesn't exist`);
  const report = allocs(reportedIr(file, release), allocators([NATIVE, TLS_NATIVE, ZLIB_NATIVE, SQLITE_NATIVE, JS_NATIVE].join("\n")));
  process.stdout.write(json ? allocsJson(report) : formatAllocs(report, rows));
  return process.exit(0);
}

// `fishc layout`: a type's layout, as `layoutsOf` gives it.
/** @throws {Error | IoError} */
function layoutTypes(file: string, named: string, json: boolean): never {
  if (!file.endsWith(".fsh")) fail(`fishc layout: '${file}' isn't a .fsh file; a type is laid out as the program that names it compiles it`);
  if (!existsSync(file)) fail(`fishc layout: '${file}' doesn't exist`);
  if (named.trim() === "") fail("fishc layout: name a type, as in fishc layout main.fsh Shape or 'Box<i64>'");
  let src = "";
  try {
    src = readFileSync(file, "utf8");
    const layouts = layoutsOf(file, src, named);
    process.stdout.write(json ? layoutsJson(layouts) : formatLayouts(layouts));
  } catch (e) {
    // An error in the type named is shown under the line the probe gives it.
    if (e instanceof CompileError) console.error(painted(e, file, probing(src, named)));
    else console.error(`fishc layout: ${(e as { message: string }).message}`);
    process.exit(1);
  }
  return process.exit(0);
}

// A directory `fishc survey` can read, holding TypeScript.
/** @throws {IoError} */
function checkProject(dir: string, fish: boolean = false) {
  if (!existsSync(dir)) fail(`fishc survey: '${dir}' doesn't exist`);
  if (!statSync(dir).isDirectory()) fail(`fishc survey: '${dir}' is a file; give the directory of a TypeScript project`);
  try {
    readdirSync(dir);
  } catch (e) {
    fail(`fishc survey: '${dir}' can't be read: ${(e as { message: string }).message}`);
  }
  if (sources(dir, fish).length === 0) fail(`fishc survey: '${dir}' holds no TypeScript ${fish ? "or Fish " : ""}files (.ts, .tsx or .mts${fish ? ", or .fsh" : ""}, outside node_modules)`);
}

/** @throws {Error | IoError | JsonError} */
async function main(): Promise<void> {
  if (Bun.argv.length === 3 && Bun.argv[2] === "lsp") {
    await serveLsp();
    return;
  }
  // A bare `--lib` builds the default kind, a static library.
  const { values, positionals } = (() => {
    try {
      return parseArgs({
        args: Bun.argv.slice(2).map((a) => (a === "--lib" ? "--lib=static" : a)),
        allowPositionals: true,
        options: {
          out: { type: "string", short: "o" },
          "emit-llvm": { type: "boolean" },
          release: { type: "boolean" },
          panic: { type: "string", default: "unwind" },
          link: { type: "string", multiple: true },
          lib: { type: "string" },
          target: { type: "string" },
          sysroot: { type: "string" },
          static: { type: "boolean" },
          dockerfile: { type: "boolean" },
          json: { type: "boolean" },
          rank: { type: "boolean" },
          self: { type: "string" },
          plan: { type: "string" },
          compare: { type: "string" },
          locked: { type: "boolean" },
          "dry-run": { type: "boolean" },
          "allow-dirty": { type: "boolean" },
          submit: { type: "boolean" },
          fork: { type: "string" },
          yes: { type: "boolean" },
          check: { type: "boolean" },
          fix: { type: "boolean" },
          leaks: { type: "boolean" },
          debug: { type: "boolean", short: "g" },
          timings: { type: "boolean" },
          "timings-json": { type: "string" },
          "no-check-cache": { type: "boolean" },
          sanitize: { type: "string", multiple: true },
          timeout: { type: "string" },
          jobs: { type: "string" },
          fn: { type: "string" },
          top: { type: "string" },
          names: { type: "string" },
          linker: { type: "string" },
          backend: { type: "string" },
        },
      });
    } catch (e) {
      return fail(`fishc: ${(e as { message: string }).message}`);
    }
  })();
  // The options given, as Node's parseArgs keys them: those on the command line and `panic`'s default.
  let flags: string[] = [];
  for (const [k, v] of Object.entries(values)) if (v !== undefined) flags.push(k);
  const links: string[] = values.link === undefined ? [] : [...values.link];
  // The target with `--linker`'s choice, checked before anything is built.
  const linking = (t: Target): Target => {
    const chosen: Target = { ...t, linker: values.linker };
    try {
      linkerFlags(chosen);
    } catch (e) {
      fail((e as { message: string }).message);
    }
    return chosen;
  };
  // Each build compiles within a session of its own, since a check uses up the one it is given.
  const locked = values.locked === true;
  const timed = values.timings === true;
  const checking = values["no-check-cache"] === true;
  const json = values["timings-json"];
  const sessionFor = (): BuildSession => sessionWith(locked, timed, checking, json, values.backend);
  // `fishc run` and `fishc watch` take the program's arguments after the file, or all of them with no file.
  const command = positionals.length > 0 ? positionals[0] : undefined;
  const named = positionals.length > 1 ? positionals[1] : undefined;
  const file = (command === "run" || command === "watch") && named !== undefined && !named.endsWith(".fsh") ? undefined : named;
  const programArgs = positionals.slice(file === undefined ? 1 : 2);
  if (json !== undefined && command !== "build" && command !== "check" && command !== "run") fail(`fishc: '--timings-json' writes the timings of a build, check or run; 'fishc ${command ?? ""}' takes no '--timings-json'`);
  if (command === "native-object") {
    if (values.out === undefined || positionals.length !== 1) fail("usage: fishc native-object -o <out.o> < <unit.ll>");
    writeFileSync(values.out!, objectOf(readFileSync(0)));
    return;
  }
  if (command === "repl") {
    if (positionals.length !== 1 || flags.some((k) => k !== "panic")) fail("usage: fishc repl");
    runRepl(locked, timed, checking);
  }
  // Parses a file without checking it, for test programs that only have to parse.
  if (command === "parse") {
    if (positionals.length !== 2 || flags.some((k) => k !== "panic")) fail("usage: fishc parse <file.fsh>");
    let src = "";
    try {
      src = readFileSync(named!, "utf8");
      parse(src, { last: 0 });
    } catch (err) {
      if (!(err instanceof CompileError)) fail(`fishc parse: can't read '${named!}': ${(err as { message: string }).message}`);
      else console.error(formatError(err, named!, src));
      process.exit(1);
    }
    process.exit(0);
  }
  if (command === "explain") {
    if (positionals.length !== 2 || flags.some((k) => k !== "panic")) fail("usage: fishc explain <code>");
    const text = explain(named!);
    if (text === undefined) fail(`fishc explain: '${named ?? ""}' isn't an error code; a code looks like E0201 or W0001, as an error shows it`);
    console.log(text);
    process.exit(0);
  }
  if (command === "explain-borrows") {
    if (positionals.length !== 2 || flags.some((k) => k !== "panic" && k !== "fn")) fail("usage: fishc explain-borrows <file.fsh> [--fn <name>]");
    explainFile(named!, values.fn);
  }
  if (command === "openapi") {
    if (positionals.length !== 2 || flags.some((k) => k !== "panic" && k !== "out")) fail("usage: fishc openapi <file.fsh> [-o <out>]");
    openapiFile(named!, values.out);
  }
  if (command === "bloat") {
    if (positionals.length !== 2 || flags.some((k) => k !== "panic" && k !== "release" && k !== "top" && k !== "json")) fail("usage: fishc bloat <file.fsh> [--release] [--top <n>] [--json]\n       fishc bloat <binary> [--top <n>] [--json]");
    bloatReport(named!, values.release === true, values.top, values.json === true);
  }
  if (command === "allocs") {
    if (positionals.length !== 2 || flags.some((k) => k !== "panic" && k !== "release" && k !== "top" && k !== "json")) fail("usage: fishc allocs <file.fsh> [--release] [--top <n>] [--json]");
    allocsReport(named!, values.release === true, values.top, values.json === true);
  }
  if (command === "demangle") {
    if (positionals.length > 2 || flags.some((k) => k !== "panic" && k !== "names")) fail("usage: fishc demangle [<binary>] [--names <file.fshnames>]");
    demangleReport(named, values.names);
  }
  if (command === "layout") {
    if (positionals.length !== 3 || flags.some((k) => k !== "panic" && k !== "json")) fail("usage: fishc layout <file.fsh> <type> [--json]");
    layoutTypes(named!, positionals[2]!, values.json === true);
  }
  if (command === "survey") {
    const dirs = positionals.slice(1);
    const usage = "usage: fishc survey <dir> [--compare <old.json>] [--json]\n       fishc survey --rank <dir>... [--self <dir>] [--plan <build-plan.md>] [--json]";
    const extra = values.self !== undefined || values.plan !== undefined;
    if (dirs.length === 0 || (values.rank !== true && (dirs.length > 1 || extra))) fail(usage);
    if (values.rank === true && values.compare !== undefined) fail("fishc survey: --compare compares one project's survey; rankings can't be compared yet");
    for (const dir of dirs) checkProject(dir);
    if (values.self !== undefined) checkProject(values.self, true);
    // A directory given twice, or inside another given, would count its files twice.
    const real = dirs.map((d) => realpathSync(d));
    const nested = real.findIndex((d, k) => real.some((e, l) => l !== k && (d === e ? l < k : d.startsWith(e + sep))));
    if (nested >= 0) fail(`fishc survey: '${dirs[nested as usize]}' is already surveyed as part of another directory given`);
    if (values.rank === true) {
      let plan: Plan | undefined = undefined;
      try {
        plan = values.plan !== undefined ? readPlan(values.plan) : undefined;
      } catch (e) {
        fail(`fishc survey: the plan '${values.plan ?? ""}' can't be read: ${(e as { message: string }).message}`);
      }
      const planned = plan !== undefined;
      const ranking = rank(dirs, values.self, plan);
      console.log(values.json === true ? indented(JSON.stringify(ranking)) : formatRanking(ranking, planned));
    } else if (values.compare !== undefined) {
      let then: SurveyReport | undefined = undefined;
      try {
        if (!existsSync(values.compare)) throw new Error("it doesn't exist");
        if (!statSync(values.compare).isFile()) throw new Error("it isn't a file");
        // A saved report is kilobytes; anything far larger isn't one.
        if (statSync(values.compare).size > 64 * 1024 * 1024) throw new Error("it is too large to be a saved survey");
        then = readReport(readFileSync(values.compare, "utf8"));
      } catch (e) {
        fail(`fishc survey: the baseline '${values.compare}' can't be compared: ${(e as { message: string }).message}`);
      }
      const c = compare(then!, survey(file!));
      console.log(values.json === true ? indented(JSON.stringify(c)) : formatComparison(c));
    } else {
      const report = survey(file!);
      console.log(values.json === true ? indented(JSON.stringify(report)) : formatReport(report));
    }
    process.exit(0);
  }
  if (command === "fmt") {
    const usage = "usage: fishc fmt [<path>...] [--check]\n       fishc fmt - [--check]";
    let paths = positionals.slice(1);
    if (flags.some((k) => k !== "check" && k !== "panic") || (paths.includes("-") && paths.length > 1)) fail(usage);
    const check = values.check === true;
    if (paths.length > 0 && paths[0] === "-") process.exit(formatStdin(check));
    if (paths.length === 0) {
      const found = findManifest(process.cwd()) ?? fail(`fishc fmt: no ${MANIFEST} here or in any directory above; name the files to format, or run it inside a package`);
      paths.push(dirname(found!));
    }
    process.exit(formatPaths(paths, check));
  }
  if (command === "lint") {
    let paths = positionals.slice(1);
    if (flags.some((k) => k !== "panic" && k !== "fix") || values.panic !== "unwind") fail("usage: fishc lint [<path>...] [--fix]");
    if (paths.length === 0) {
      const found = findManifest(process.cwd()) ?? fail(`fishc lint: no ${MANIFEST} here or in any directory above; name the files to lint, or run it inside a package`);
      paths.push(dirname(found!));
    }
    process.exit(lintPaths(paths, values.fix === true));
  }
  if (command === "test") {
    // Tests are built to unwind, so `--panic=abort` is refused rather than ignored.
    const usage = "usage: fishc test [<filter>] [--release] [--timeout <ms>] [--jobs <n>]";
    if (positionals.length > 2 || flags.some((k) => k !== "panic" && k !== "release" && k !== "timeout" && k !== "jobs") || values.panic !== "unwind") fail(usage);
    let options = runDefaults();
    if (values.timeout !== undefined) options.timeout = wholeNumber(values.timeout) ?? fail(`fishc test: --timeout takes a whole number of milliseconds above 0, not '${values.timeout}'`);
    if (values.jobs !== undefined) options.jobs = wholeNumber(values.jobs) ?? fail(`fishc test: --jobs takes a whole number of tests above 0, not '${values.jobs}'`);
    const found = findManifest(process.cwd()) ?? fail(`fishc test: no ${MANIFEST} here or in any directory above; tests run inside a package`);
    const code = await testPackage(sessionFor(), dirname(found!), file, values.release === true, options);
    process.exit(code);
  }
  if (command === "publish") {
    const usage = "usage: fishc publish [--dry-run] [--allow-dirty] [--submit [--fork <url>] [--yes]]";
    const allowed = new Set(["panic", "dry-run", "allow-dirty", "submit", "fork", "yes"]);
    const submitting = values.submit === true;
    if (positionals.length > 1 || flags.some((k) => !allowed.has(k)) || ((values.fork !== undefined || values.yes === true) && !submitting) || (submitting && values["dry-run"] === true)) fail(usage);
    const found = findManifest(process.cwd()) ?? fail(`fishc publish: no ${MANIFEST} here or in any directory above; publish runs inside a package`);
    try {
      const packed = pack(found, values["allow-dirty"] === true);
      console.log(`packed ${packed.manifest.name} ${packed.manifest.version}: ${packed.files.length} files, ${Math.ceil((packed.bytes.length as f64) / 1024)} KiB, sha256 ${packed.sha256}`);
      for (const f of packed.files) console.log(`  ${f}`);
      console.log(`wrote ${relative(process.cwd(), packed.file)}`);
      const deps = unsafeDependencies(packed.manifest);
      if (packed.unsafe.length === 0 && deps.length === 0) console.log(`no unsafe in ${packed.manifest.name} or its dependencies`);
      for (const u of packed.unsafe) console.log(`unsafe: ${u.file}:${u.line}:${u.col} ${u.what}`);
      for (const d of deps) console.log(`unsafe: the dependency '${d.name}' ${d.text} uses unsafe`);
      if (values["dry-run"] !== true) {
        const prepared = prepare(packed);
        console.log(`prepared ${prepared.branch} in ${prepared.clone}: ${prepared.archive} and its index line`);
        if (!submitting) console.log(`run 'fishc publish --submit' to push it to your fork and open a pull request`);
        else {
          // Pushing and opening a pull request reach outside this machine, so they're asked for.
          const confirm = (question: string) => values.yes === true || /^y(es)?$/i.test((prompt(question) ?? "").trim());
          console.log(`opened ${submit(prepared, packed.manifest, values.fork, confirm)}`);
        }
      }
    } catch (e) {
      if (e instanceof CompileError) {
        console.error(painted(e, relative(process.cwd(), found), readFileSync(found, "utf8")));
        process.exit(1);
      }
      fail(`fishc publish: ${(e as { message: string }).message}`);
    }
    process.exit(0);
  }
  if (command === "add" || command === "update") {
    const usage = "usage: fishc add <name>[@<range>]\n       fishc update [<name>]";
    if (positionals.length > 2 || (command === "add" && file === undefined) || flags.some((k) => k !== "panic")) fail(usage);
    const found = findManifest(process.cwd()) ?? fail(`fishc ${command ?? ""}: no ${MANIFEST} here or in any directory above; make a package with 'fishc new <name>' or 'fishc init'`);
    try {
      const manifest = loadManifest(found);
      if (command === "add") {
        const at = file!.indexOf("@");
        const name = at >= 0 ? file!.slice(0, at) : file!;
        const range = at >= 0 ? file!.slice(at + 1) : undefined;
        if (!validName(name)) fail(`fishc add: '${name}' isn't a package name: ${NAME_RULE}`);
        if (manifest.dependencies.some((d) => d.name === name)) fail(`fishc add: '${name}' is already a dependency in ${MANIFEST}`);
        if (range !== undefined && (range.trim() === "" || /[\n\r"\\]/.test(range) || parseRange(range) === undefined)) fail(`fishc add: '${range}' isn't a version range; write one as package.json does, as in ^1.2.0`);
        const released = openIndex(registryUrl(manifest), true).versions(name).filter((e) => !e.yanked);
        let versions: Version[] = [];
        for (const e of released) versions.push({ major: e.version.major, minor: e.version.minor, patch: e.version.patch, pre: [...e.version.pre] });
        const latest = maxSatisfying(versions, parseRange(range ?? "*")!);
        if (latest === undefined) fail(`fishc add: no version of '${name}' in the registry fits '${range ?? "*"}'`);
        const written = range ?? `^${formatVersion(latest!)}`;
        const edited = withDependency(readFileSync(found, "utf8"), `${name} = { version = "${written}" }`);
        // Written only once the result still reads as the manifest with the new dependency.
        if (!readManifest(edited, manifest.dir).dependencies.some((d) => d.name === name)) fail(`fishc add: couldn't add '${name}' to ${MANIFEST}; add it by hand`);
        writeFileSync(found, edited);
        console.log(`added ${name} ${written}`);
        const chosen = released.find((e) => formatVersion(e.version) === formatVersion(latest!));
        if (chosen !== undefined && chosen.unsafe === true) console.error(`note: '${name}' ${chosen.text} uses unsafe`);
      } else {
        if (file !== undefined && !manifest.dependencies.some((d) => d.name === file && "version" in d)) fail(`fishc update: '${file}' isn't a dependency from the registry in ${MANIFEST}`);
        let updating = cachedSession();
        updating.locking.update = file !== undefined ? new Set([file]) : "all";
        resolvePackages(join(manifest.dir, manifest.entry), updating.locking);
        console.log(`updated ${fromHere(join(manifest.dir, "fish.lock"))}`);
      }
    } catch (e) {
      if (e instanceof CompileError) {
        console.error(painted(e, relative(process.cwd(), found), readFileSync(found, "utf8")));
        process.exit(1);
      }
      fail(`fishc ${command ?? ""}: ${(e as { message: string }).message}`);
    }
    process.exit(0);
  }
  if (command === "new" || command === "init") {
    const usage = "usage: fishc new <name>\n       fishc init [<name>]";
    const extra = flags.some((k) => k !== "panic");
    if (positionals.length > 2 || extra || (command === "new" && file === undefined)) fail(usage);
    const dir = command === "new" ? join(process.cwd(), file!) : process.cwd();
    const name = file ?? basename(dir);
    if (!validName(name)) {
      fail(command === "init" && file === undefined ? `fishc init: this directory's name '${name}' isn't a package name: ${NAME_RULE}; give one, as in 'fishc init my-app'` : `fishc ${command ?? ""}: '${name}' isn't a package name: ${NAME_RULE}`);
    }
    if (command === "new" && !vacant(dir)) fail(`fishc new: '${file ?? ""}' already exists and isn't empty; choose another name, or run 'fishc init' inside it`);
    if (command === "init" && existsSync(join(dir, MANIFEST))) fail(`fishc init: there is already a ${MANIFEST} here`);
    createPackage(dir, name);
    console.log(`created the package '${name}'${command === "new" ? ` in ${file ?? ""}/` : ""}`);
    process.exit(0);
  }
  const panicName = values.panic;
  const panic: Panic = panicName === "abort" ? "abort" : "unwind";
  const libName = values.lib;
  const lib: Library | undefined = libName === undefined ? undefined : libName === "shared" ? "shared" : "static";
  const release = values.release === true;
  const leaks = values.leaks === true;
  if (values.sanitize !== undefined && command !== "build") fail(`fishc ${command ?? ""}: '--sanitize' instruments a build; build with 'fishc build --sanitize address|thread', then run the binary it writes`);
  let target = file;
  let out = values.out;
  // With no file, the package around the working directory is built, as cargo builds one.
  if ((command === "build" || command === "check" || command === "run" || command === "watch") && file === undefined && lib === undefined) {
    const found = findManifest(process.cwd()) ?? fail(`fishc ${command ?? ""}: no ${MANIFEST} here or in any directory above; give a file to build, or make a package with 'fishc new <name>' or 'fishc init'`);
    try {
      const manifest = loadManifest(found, "entry");
      // An entry inside a package nested here would build as that package's program.
      const holder = findManifest(dirname(realpathSync(join(manifest.dir, manifest.entry))));
      if (holder !== undefined && realpathSync(holder) !== realpathSync(found!)) throw fieldError(found, "entry", `the entry '${manifest.entry}' is a file inside the package '${loadManifest(holder).name}'; a package's entry is one of its own files`);
      target = relative(process.cwd(), join(manifest.dir, manifest.entry));
      if (out === undefined) out = join(manifest.dir, "target", release ? "release" : "debug", manifest.name);
      if (values["emit-llvm"] !== true && command !== "check") mkdirSync(dirname(out), { recursive: true });
    } catch (e) {
      if (!(e instanceof CompileError)) throw e;
      console.error(painted(e, relative(process.cwd(), found!), readFileSync(found!, "utf8")));
      process.exit(1);
    }
  }
  const llvm = values["emit-llvm"] === true;
  if (command === "check" && target !== undefined && values.out === undefined && !release && !llvm && lib === undefined) {
    try {
      const start = performance.now();
      // Nothing but the warnings is read once the check ends, so it keeps what a plain build keeps.
      const made = checkedFile(plain(sessionFor()), target);
      reportTimings(made.session, FRONT_END, start);
      for (const w of made.warnings) console.error(painted(w, target, readFileSync(target, "utf8"), "warning"));
    } catch (e) {
      if (e instanceof CompileError) console.error(painted(e, target, readFileSync(target, "utf8")));
      else console.error((e as { message: string }).message);
      process.exit(1);
    }
    process.exit(0);
  }
  if (command === "run" && target !== undefined && values.out === undefined && !llvm && lib === undefined) {
    // A lone file's program is built where nothing else looks, and removed once it has run.
    const scratch = out === undefined ? mkdtempSync(join(tmpdir(), "fishc-run-")) : undefined;
    const binary = out ?? join(scratch!, basename(target, ".fsh"));
    let code = 1;
    try {
      const start = performance.now();
      let looked: string[] = [];
      const made = built(sessionFor(), target, binary, release, panic, [...links], linking(hostTarget()), leaks, values.debug === true, looked);
      reportTimings(made.session, [...FRONT_END, "codegen", "instrument", "split", ...NATIVE_STAGES], start);
      for (const w of made.warnings) console.error(painted(w, target, readFileSync(target, "utf8"), "warning"));
      const ran = Bun.spawnSync([binary, ...programArgs], { stdin: "inherit", stdout: "inherit", stderr: "inherit" });
      // A signal ends it with 128 plus the signal's number, as a shell reports it.
      const signal = ran.signalCode;
      const found = signal === null ? undefined : Object.entries(constants.signals).find(([name]) => name === signal);
      code = ran.exitCode ?? 128 + (found === undefined ? 0 : found[1]);
    } catch (e) {
      if (e instanceof CompileError) console.error(painted(e, target, readFileSync(target, "utf8")));
      else console.error((e as { message: string }).message);
    } finally {
      if (scratch !== undefined) rmSync(scratch, { recursive: true, force: true });
    }
    process.exit(code);
  }
  if (command === "watch" && target !== undefined && values.out === undefined && !llvm && lib === undefined) {
    const entry = target;
    const scratch = out === undefined ? mkdtempSync(join(tmpdir(), "fishc-watch-")) : undefined;
    const binary = out ?? join(scratch!, basename(entry, ".fsh"));
    // What each build takes, the callback's own, since it may run on another thread.
    const manifest = findManifest(dirname(resolve(entry)));
    const rebuild: Rebuild = { entry: `${entry}`, binary: `${binary}`, links: [...links], release, panic, leaks, debug: values.debug === true, locked, timed, manifest };
    await watchProgram({
      entry,
      binary,
      args: programArgs,
      manifest,
      build: (kept) => rebuilt(rebuild, kept),
      done: () => {
        try {
          if (scratch !== undefined) rmSync(scratch, { recursive: true, force: true });
        } catch (_e) {
          // The scratch directory is the system's temporary one, which it clears in time.
        }
      },
    });
  }
  if (command !== "build" || target === undefined || values.fix === true || values.json === true || values.rank === true || values.self !== undefined || values.plan !== undefined || values.compare !== undefined || (panicName !== "unwind" && panicName !== "abort") || links.some((l) => l.trim() === "") || (libName !== undefined && libName !== "static" && libName !== "shared")) {
    console.error("usage: fishc build [<file.fsh>] [-o <out>] [--release] [-g] [--locked] [--panic=unwind|abort] [--link <library>]... [--lib[=static|shared]] [--target <triple>] [--sysroot <dir>] [--static [--dockerfile]] [--leaks] [--timings] [--emit-llvm] [--sanitize address|thread] [--linker system|lld|mold] [--backend native|llvm] [--timings-json <path>]\n       fishc check [<file.fsh>] [--timings] [--timings-json <path>] [--no-check-cache]\n       fishc run [<file.fsh>] [--release] [-g] [--leaks] [--linker system|lld|mold] [--backend native|llvm] [--timings] [--timings-json <path>] [-- <args>...]\n       fishc watch [<file.fsh>] [--release] [-g] [--leaks] [--timings] [-- <args>...]\n       fishc new <name>\n       fishc init [<name>]\n       fishc add <name>[@<range>]\n       fishc update [<name>]\n       fishc publish [--dry-run] [--allow-dirty] [--submit [--fork <url>] [--yes]]\n       fishc fmt [<path>...] [--check]\n       fishc fmt - [--check]\n       fishc test [<filter>] [--release]\n       fishc lint [<path>...] [--fix]\n       fishc survey <dir> [--compare <old.json>] [--json]\n       fishc survey --rank <dir>... [--self <dir>] [--plan <build-plan.md>] [--json]\n       fishc bloat <file.fsh|binary> [--release] [--top <n>] [--json]\n       fishc allocs <file.fsh> [--release] [--top <n>] [--json]\n       fishc layout <file.fsh> <type> [--json]\n       fishc demangle [<binary>] [--names <file.fshnames>]\n       fishc explain <code>\n       fishc explain-borrows <file.fsh> [--fn <name>]\n       fishc openapi <file.fsh> [-o <out>]\n       fishc parse <file.fsh>\n       fishc lsp");
    process.exit(2);
  }
  // A library keeps no frames to name sites with, and its host's exit isn't the library's to report.
  if (values.timings === true && lib !== undefined) fail("fishc build: '--timings' times an executable's build; leave out '--lib' to time the program it would be built from");
  if (json !== undefined && lib !== undefined) fail("fishc build: '--timings-json' times an executable's build; leave out '--lib' to time the program it would be built from");
  if (leaks && lib !== undefined) fail("fishc build: '--leaks' can't build a library; build the program that uses it with '--leaks' instead");
  if (values.static === true && lib !== undefined) fail("fishc build: '--static' builds an executable, not a library; leave out '--lib', or '--static'");
  if ((values.static === true || values.dockerfile === true) && llvm) fail("fishc build: '--emit-llvm' prints the IR without linking it, so '--static' and '--dockerfile' don't apply; leave them out");
  const sanitize = values.sanitize === undefined ? undefined : values.sanitize.flatMap((s) => s.split(","));
  if (sanitize !== undefined && lib !== undefined) fail("fishc build: '--sanitize' can't build a library; build the program that uses it with '--sanitize' instead");
  if (sanitize !== undefined && llvm) fail("fishc build: '--emit-llvm' prints the IR before clang instruments it, so '--sanitize' doesn't apply; leave it out");
  if (values.dockerfile === true && values.static !== true) fail("fishc build: '--dockerfile' writes an image holding only the binary, which needs it built with '--static'");
  try {
    if (llvm) {
      const start = performance.now();
      let looked: string[] = [];
      const made = compiledIn(newCompilation(plain(sessionFor())), readFileSync(target!, "utf8"), target!, release, panic, lib !== undefined, leaks, values.debug === true, looked);
      reportTimings(made.checked.tables.session, [...FRONT_END, "codegen"], start);
      writePieces(made.ir);
    } else {
      // FISH_SYSROOT is for building for another target, never the host's own plain builds.
      const fromEnv = process.env.FISH_SYSROOT ?? "";
      const sysroot = values.sysroot ?? (values.target !== undefined && values.target !== hostTriple() && fromEnv !== "" ? fromEnv : undefined);
      const resolved = resolveTarget(values.target, sysroot);
      const base = values.static === true ? staticTarget(resolved) : resolved;
      const sanitized = sanitize !== undefined;
      const platform = linking(sanitize !== undefined ? sanitizedTarget(base, sanitize) : base);
      // A sanitizer's report names .fsh lines only when the program carries line tables.
      const debug = values.debug === true || sanitized;
      const binary = out ?? basename(target!, ".fsh");
      const image = values.dockerfile === true ? dockerfilePath(binary) : undefined;
      try {
        let warnings: CompileError[] = [];
        if (lib !== undefined) warnings = buildLibrary(sessionFor(), target!, binary, lib, release, panic, [...links], copyTarget(platform), debug);
        else {
          const start = performance.now();
          let looked: string[] = [];
          const made = built(sessionFor(), target!, binary, release, panic, [...links], copyTarget(platform), leaks, debug, looked);
          reportTimings(made.session, [...FRONT_END, "codegen", "instrument", "split", ...NATIVE_STAGES], start);
          warnings = made.warnings;
        }
        if (image !== undefined) writeFileSync(image, dockerfile(binary));
        for (const w of warnings) console.error(painted(w, target!, readFileSync(target!, "utf8"), "warning"));
      } catch (e) {
        // A missing header or library for another target is most often a missing or partial sysroot.
        if (e instanceof Error && platform.compile.includes("-target") && e.message.startsWith("clang failed")) throw new Error(`${e.message}\nfishc build: building for ${platform.triple} needs its headers and libraries; check that --sysroot or FISH_SYSROOT names a complete sysroot for it`);
        throw e;
      }
    }
  } catch (e) {
    if (e instanceof CompileError) console.error(painted(e, target!, readFileSync(target!, "utf8")));
    else console.error((e as { message: string }).message);
    process.exit(1);
  }
}

if (import.meta.main) main();
