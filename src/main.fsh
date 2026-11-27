#!/usr/bin/env bun
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, readSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { constants, tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import { bodyOf, type Arenas } from "./arenas.fsh";
import { C_KEYWORDS } from "./check.fsh";
import { codegenChecked, compiledOf, symbolIn, symbolNames, type Emitted, type Options } from "./codegen.fsh";
import { buildFor, formatMemory, formatTimings, FRONT_END, NATIVE_STAGES, newCompilation, newSession, newTimings, objectsNote, partEnd, partStart, stageEnd, stageStart, STOP_STAGES, stopAfter, type Compilation, type BuildFlag, type Reading, type Session, type Tables } from "./compilation.fsh";
import { expanded, sourced } from "./analysis.fsh";
import { cachedSession } from "./mathlib.fsh";
import { CompileError, copyNames, formatError, movedOffset, type BorrowEvent, type Names, type Source } from "./diag.fsh";
import { load, type Loaded, type RustCrate } from "./modules.fsh";
import { resolvePackages } from "./dependencies.fsh";
import { pack, prepare, submit, unsafeDependencies, upload } from "./publish.fsh";
import { openIndex, registryUrl, sparseBase, useRegistry } from "./registry_index.fsh";
import { formatVersion, parseRange, maxSatisfying, type Version } from "./semver.fsh";
import { createPackage, type Edition, fieldError, findManifest, loadManifest, MANIFEST, NAME_RULE, readManifest, vacant, validName, withDependency } from "./manifest.fsh";
import { parse, parseWithComments, type Stmt } from "./parser.fsh";
import type { Ids } from "./nodes.fsh";
import { addonOf } from "./addon.fsh";
import { mobileOf, typeName, type Mobile } from "./mobile.fsh";
import { bundle } from "./bundle.fsh";
import { JS_NATIVE } from "./js_native.fsh";
import { BROTLI_NATIVE, NATIVE, SQLITE_NATIVE, TLS_NATIVE, tlsStub, ZLIB_NATIVE } from "./native.fsh";
import { cachedObjects, files, MATH_RUNTIME, mathObjects, mathObjectsAsync, objectAsync, objectPath, sourceRoot, type BuildSession, type Unit } from "./mathlib.fsh";
import { RUNTIME } from "./runtime.fsh";
import { copyTarget, dockerfile, dockerfilePath, findBrotli, findFuzzerClang, findOpenSsl, fuzzerTarget, hostTarget, hostTriple, forTarget, instrumented, isLambda, isWasm, isWindows, PGO_INSTRUMENT, pgoUse, resolveTarget, sanitizedTarget, staticTarget, threading, withFlags, type Target } from "./target.fsh";
import { browserFiles, loader } from "./wasi.fsh";
import { zipped } from "./serverless.fsh";
import { fishFiles, formatPaths, formatStdin, rewrite } from "./fmt.fsh";
import { EXERCISES, exerciseText, FOLDER } from "./learn.fsh";
import { commandNamed, helpOf, overview, usageOf, VERSION } from "./commands.fsh";
import { documented, indexPage, modulePage, pageName, type Documented } from "./docs.fsh";
import { displayFixPath, fixProgram } from "./fix.fsh";
import { formatReproducer, fuzzHarnessImports, fuzzHarnessMain, liftFuzz, shellQuote, type FuzzTarget } from "./fuzz.fsh";
import { serveLsp } from "./lsp.fsh";
import { directive, fix, migrations, REJECTS, type Imported } from "./migrate.fsh";
import { hideMains, harnessImports, harnessMain, liftTests, runDefaults, runTests, stopTests, type RunOptions, type Test } from "./tests.fsh";
import { formatRanking, rank, readPlan, type Plan } from "./rank.fsh";
import { compare, formatComparison, formatReport, readReport, sources, survey, type Report as SurveyReport } from "./survey.fsh";
import { explain } from "./codes.fsh";
import { explainBorrows, functionsIn } from "./explain.fsh";
import { openapiOf, type LeftOut } from "./openapi.fsh";
import { clientOf, typesOf } from "./client.fsh";
import { bindHeader } from "./bindc.fsh";
import { heapDiffFiles } from "./heap.fsh";
import { complete, entries, program, REPL_VALUE, shown, thrownBy, type Entry, type ReplState } from "./repl.fsh";
import { comptimeBody } from "./comptime.fsh";
import type { InstanceId } from "./arenas.fsh";
import type { Checked, Instance } from "./check.fsh";
import type { Type, Typing } from "./typing.fsh";
import { rustShim, type Shim } from "./rustshim.fsh";
import { split } from "./split.fsh";
import { withDebugInfo } from "./debuginfo.fsh";
import { watchProgram, type Rebuilt } from "./watch.fsh";
import { develop, HANDLERS_C, HOST_C, hostSource, stateShapes, type Handlers } from "./dev.fsh";
import { cachedScript, keepScript, scriptBuildPath } from "./scripts.fsh";
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
// What a build is profiled for: stack samples (true), live memory by allocation site ("heap"), or
// nothing.
export type Profiling = boolean | "heap";

export { analyze } from "./analysis.fsh";

// What compiling a program gives: its IR, the checked program, and the Rust crates its calls go to.
// The program as loaded comes back too, which `fishc watch` keeps.
type Compiled = { ir: string; checked: Checked; loaded: Loaded; emitted: Emitted | undefined };

// A build session apart: what a compilation takes, and the caches only building objects reads.
type Caches = { clang?: string; clangCc?: string; cc?: string; digests: Map<string, string>; mathUnits?: Unit[] };

function apart(session: BuildSession): { core: Session; caches: Caches } {
  return { core: { locking: session.locking, engineHook: session.engineHook, std: session.std, timings: session.timings, failed: session.failed, checkCache: session.checkCache, build: session.build }, caches: { clang: session.clang, clangCc: session.clangCc, cc: session.cc, digests: session.digests, mathUnits: session.mathUnits } };
}

function together(core: Session, caches: Caches): BuildSession {
  return { locking: core.locking, engineHook: core.engineHook, std: core.std, timings: core.timings, failed: core.failed, checkCache: core.checkCache, build: core.build, clang: caches.clang, clangCc: caches.clangCc, cc: caches.cc, digests: caches.digests, mathUnits: caches.mathUnits };
}

// `session` for a build that keeps nothing of its check once its program is emitted.
function plain(session: Session): Session {
  let made = session;
  made.plain = true;
  return made;
}

// Compiles the program whose entry is `file`, with text `src`, and every file it imports.
/** @throws {CompileError | Error | IoError | JsonError} */
export function compile(session: Session, src: string, file: string, release = false, panic: Panic = "unwind", library = false, leaks = false, debug = false, profile: Profiling = false): string {
  let looked: string[] = [];
  return compiledIn(newCompilation(session), src, file, release, panic, library, leaks, debug, looked, profile).ir;
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
function compiledIn(compilation: Compilation, src: string, file: string, release: boolean, panic: Panic, library: boolean, leaks: boolean, debug: boolean, looked: Mut<string[]>, profile: Profiling = false): Compiled {
  let program = compilation;
  program.session.build = buildFor(program.session.build, undefined, release);
  // What a build's codegen fails on is collected in the session's list, when it has one.
  const failed = program.session.failed;
  program.session.failed = undefined;
  let made = checkedSource(program, file, src, library ? runtimeNames() : false, looked);
  const sources = [...made.loaded.sources];
  return generated(made.checked, made.loaded, { src, file, release, panic, library, sources, leaks, profile, debug, failed });
}

// `codegenChecked`, its errors given the program's files. A function of its own so that what
// codegen made is returned straight from the call: unwrapped from a local after the `try`, the
// checked program and its IR would be copied whole while the originals stayed alive.
/** @throws {CompileError | Error | IoError | JsonError} */
function codegenSourced(checked: Checked, options: Options, names: Names, sources: Ref<Source[]>): { ir: string; checked: Checked; emitted: Emitted | undefined } {
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
  if (debug) ir = withDebugInfo(ir, src, file, [...loaded.sources], release);
  partEnd(done.checked.tables.session, "codegen bundle", bundling);
  stageEnd(done.checked.tables.session, "codegen", started);
  stopAfter(done.checked.tables.session, "codegen");
  return { ir, checked: done.checked, loaded, emitted: done.emitted };
}

// The IR with the program's packages bundled into it, those its code reaches, when it reaches any.
/** @throws {CompileError | Error | IoError | JsonError} */
function bundled(ir: string, loaded: Ref<Loaded>): string {
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
  return `${ir}\n@fsh.js.bundle = private unnamed_addr constant [${bytes.length + 1} x i8] c"${text}\\00"\n`;
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
// `glue` is C compiled into the library, a Node addon's or a mobile module's, whose caller writes
// any header itself. A shared library with glue is built at `out` itself, finding what the glue
// leaves undefined, such as N-API's functions, in the process that loads it.
export function buildLibrary(session: BuildSession, file: string, out: string, kind: Library, release = false, panic: Panic = "unwind", links: string[] = [], target: Target = hostTarget(), debug = false, glue?: string): CompileError[] {
  const src = readFileSync(file, "utf8");
  let { core, caches } = apart(session);
  core.build = buildFor(core.build, target.triple, release);
  let looked: string[] = [];
  const made = compiledIn(newCompilation(core), src, file, release, panic, true, false, debug, looked);
  const ir = made.ir;
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
    for (const o of cachedObjects(building, runtimeUnits(ir, release, true, copyTarget(target)))) objects.push(o);
    for (const o of mathObjects(building, [...target.compile])) objects.push(o);
    if (kind === "shared") {
      const darwin = target.triple === "" ? process.platform === "darwin" : target.triple.includes("-apple-");
      const extension = darwin ? "dylib" : "so";
      const glued = glue === undefined ? [...none] : ["-x", "c", glue!, "-x", "none", ...(darwin ? ["-undefined", "dynamic_lookup"] : none)];
      const written = glue === undefined ? join(dirname(out), `lib${name}.${extension}`) : out;
      run([target.cc ?? "clang", ...target.compile, ...target.link, "-shared", "-fPIC", "-pthread", "-x", "ir", "-", "-x", "none", ...objects, ...glued, "-funwind-tables", "-o", written, optimize, ...g, "-lm", ...links.map((l) => `-l${l}`), ...runtimeLinks(ir, target), ...(shim !== undefined ? [shim.lib, ...shim.links] : none)], ir);
    } else {
      run([target.cc ?? "clang", ...target.compile, "-c", "-fPIC", "-x", "ir", "-", "-o", fish, optimize, ...g], ir);
      if (glue !== undefined) {
        const glueObject = join(dir, "glue.o");
        run([target.cc ?? "clang", ...target.compile, "-c", "-fPIC", "-x", "c", glue!, "-o", glueObject, optimize, ...g]);
        objects.push(glueObject);
      }
      const archive = shim !== undefined ? join(dir, "fish.a") : join(dirname(out), `lib${name}.a`);
      if (target.ar !== "ar" && Bun.which(target.ar) === null) throw new Error(`fishc build: a static library for ${target.triple} is archived with llvm-ar, which isn't on PATH; install LLVM and put its bin directory on PATH, or build with --lib=shared`);
      run([target.ar, "rcs", archive, fish, ...objects]);
      // The shim's archive is merged in, so the library is still one file to link.
      if (shim !== undefined && process.platform === "darwin") run(["libtool", "-static", "-o", join(dirname(out), `lib${name}.a`), archive, shim.lib]);
      else if (shim !== undefined) run(["ar", "-M"], `CREATE ${join(dirname(out), `lib${name}.a`)}\nADDLIB ${archive}\nADDLIB ${shim.lib}\nSAVE\nEND\n`);
    }
    let exported: Ref<Instance>[] = [];
    for (const i of compiledOf(checked)) if (bodyOf(checked.tables.arenas, i).exported === true) exported.push(i);
    if (glue === undefined) writeFileSync(join(dirname(out), `${name}.h`), header(name, checked.tables, exported));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return made.checked.warnings;
}

// `fishc dev`'s builds: with `handlers`, the program as a shared library its host loads, its serve
// answering through the host; else the host, an executable. `glue` is the C half it links. Gives
// the warnings and the shapes of the state the handlers keep; `looked` is given the files read.
/** @throws {CompileError | Error | IoError | JsonError} */
export function buildDev(session: BuildSession, file: string, out: string, glue: string, handlers: boolean, looked: Mut<string[]>): { warnings: CompileError[]; shapes: string } {
  const src = readFileSync(file, "utf8");
  let { core, caches } = apart(session);
  core.build = buildFor(core.build, undefined, false, handlers);
  // The handlers are checked with std's dev section, which no other build of the program shares.
  core.checkCache = false;
  const made = compiledIn(newCompilation(core), src, file, false, "unwind", false, false, false, looked);
  const ir = made.ir;
  const checked: Ref<Checked> = made.checked;
  if (rustShim(made.loaded.rust, checked) !== undefined) throw new Error("fishc dev: a program calling Rust isn't reloaded in place yet; run it with 'fishc watch'");
  const target = hostTarget();
  const darwin = process.platform === "darwin";
  let building = together(newSession(), caches);
  let objects: string[] = [];
  for (const o of cachedObjects(building, runtimeUnits(ir, false, handlers, copyTarget(target)))) objects.push(o);
  for (const o of mathObjects(building, [...target.compile])) objects.push(o);
  // Each load's own calls stay its own, never bound to a later load's or the host's.
  const shared: string[] = !handlers ? [] : darwin ? ["-shared", "-fPIC"] : ["-shared", "-fPIC", "-Wl,-Bsymbolic"];
  const dl: string[] = darwin ? [] : ["-ldl"];
  const dir = mkdtempSync(join(tmpdir(), "fishc-dev-"));
  try {
    const c = join(dir, "glue.c");
    writeFileSync(c, glue);
    run(["clang", ...target.compile, ...target.link, ...shared, "-x", "ir", "-", "-x", "c", c, "-x", "none", ...objects, "-funwind-tables", ...threading(target), "-o", out, "-O0", "-lm", ...runtimeLinks(ir, target), ...dl], ir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return { warnings: made.checked.warnings, shapes: handlers ? stateShapes(ir) : "" };
}

// What one of `fishc dev`'s builds takes: the source, where the build goes, and --locked.
type DevBuild = { file: string; out: string; locked: boolean };

// The host `fishc dev` serves through, built once from its generated source.
function devHost(b: Ref<DevBuild>): boolean {
  try {
    let looked: string[] = [];
    buildDev(sessionWith(b.locked, false), b.file, b.out, HOST_C, false, looked);
    return true;
  } catch (e) {
    console.error(`fishc: ${(e as { message: string }).message}`);
    return false;
  }
}

// One build of the handlers at `out`, its warnings or error shown as `fishc watch` shows them.
function devHandlers(b: Ref<DevBuild>, out: string): Handlers {
  let loaded: string[] = [];
  try {
    const made = buildDev(sessionWith(b.locked, false), b.file, out, HANDLERS_C, true, loaded);
    for (const w of made.warnings) console.error(painted(w, b.file, textOf(b.file), "warning"));
    return { built: true, loaded, shapes: made.shapes };
  } catch (e) {
    if (e instanceof CompileError) console.error(painted(e, b.file, textOf(b.file)));
    else console.error(`fishc: ${(e as { message: string }).message}`);
    return { built: false, loaded, shapes: "" };
  }
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
export function build(session: BuildSession, file: string, out: string, release = false, panic: Panic = "unwind", links: string[] = [], target: Target = hostTarget(), leaks = false, debug = false, profile: Profiling = false): CompileError[] {
  let looked: string[] = [];
  return built(session, file, out, release, panic, [...links], target, leaks, debug, looked, profile).warnings;
}

// `build`, giving the session back, with its caches and the build's timings. `looked` is given the
// files the program was read from, or looked for, even when it doesn't build.
/** @throws {CompileError | Error | IoError | JsonError} */
function built(session: BuildSession, file: string, out: string, release: boolean, panic: Panic, links: string[], target: Target, leaks: boolean, debug: boolean, looked: Mut<string[]>, profile: Profiling = false): { warnings: CompileError[]; session: BuildSession } {
  let { core, caches } = apart(session);
  core.build = buildFor(core.build, target.triple, release);
  let ready = readied(core, caches, file, release, panic, leaks, debug, looked, target, profile);
  let known = new Map<string, string[]>();
  linked(ready.building, ready.ir, ready.split, out, release, links, ready.shim, target, leaks, debug, known, profile);
  return { warnings: ready.warnings, session: ready.building };
}

// A build up to its IR and how clang takes it, which is all linking reads. A function of its own
// so the checked program and the loaded files, which only `fishc watch` keeps for its next build,
// are dropped as it returns: clang then compiles with nothing of them held beside it.
/** @throws {CompileError | Error | IoError | JsonError} */
function readied(core: Session, caches: Caches, file: string, release: boolean, panic: Panic, leaks: boolean, debug: boolean, looked: Mut<string[]>, target: Ref<Target>, profile: Profiling = false): { ir: string; split: { cached: Unit[]; program: string; times: [string, f64][] }; shim: Shim | undefined; warnings: CompileError[]; building: BuildSession } {
  let made = compiledKept(core, file, release, panic, leaks, debug, looked, undefined, undefined, false, profile);
  const instrumenting = stageStart(made.kept.checked.tables.session);
  const ir = forTarget(instrumented(made.ir, target), target);
  const shim = rustShim(made.kept.loaded.rust, made.kept.checked);
  if (shim !== undefined) refuseForeignRust(target);
  stageEnd(made.kept.checked.tables.session, "instrument", instrumenting);
  const splitting = stageStart(made.kept.checked.tables.session);
  const split = parts(ir, made.kept.checked, release, target, debug);
  stageEnd(made.kept.checked.tables.session, "split", splitting);
  if (made.kept.checked.tables.session.timings !== undefined) for (const [name, ms] of split.times) made.kept.checked.tables.session.timings!.ms.set(name, ms);
  let { checked } = made.kept;
  let { tables } = checked;
  const building = together(tables.session, caches);
  return { ir, split, shim, warnings: made.warnings, building };
}

// `built` for `fishc watch`, from what its last build kept: a program whose files all read as they
// did is not loaded or checked again. Gives what to keep for the next build. `manifest` is the
// package's, which a build may read.
/** @throws {CompileError | Error | IoError | JsonError} */
export function builtKept(session: BuildSession, file: string, out: string, release: boolean, panic: Panic, links: string[], target: Target, leaks: boolean, debug: boolean, looked: Mut<string[]>, kept: Kept | undefined, manifest: string | undefined, keep = true, profile: Profiling = false): { ir: string; warnings: CompileError[]; session: BuildSession; kept: Kept } {
  let { core, caches } = apart(session);
  core.build = buildFor(core.build, target.triple, release);
  let made = compiledKept(core, file, release, panic, leaks, debug, looked, kept, manifest, keep, profile);
  const instrumenting = stageStart(made.kept.checked.tables.session);
  const ir = forTarget(instrumented(made.ir, target), target);
  const shim = rustShim(made.kept.loaded.rust, made.kept.checked);
  if (shim !== undefined) refuseForeignRust(target);
  stageEnd(made.kept.checked.tables.session, "instrument", instrumenting);
  const splitting = stageStart(made.kept.checked.tables.session);
  const split = parts(ir, made.kept.checked, release, target, debug);
  stageEnd(made.kept.checked.tables.session, "split", splitting);
  if (made.kept.checked.tables.session.timings !== undefined) for (const [name, ms] of split.times) made.kept.checked.tables.session.timings!.ms.set(name, ms);
  let { checked, parts: checkerParts, loaded, contents, carried, emitted, units } = made.kept;
  let { instances, tables, warnings } = checked;
  let building = together(tables.session, caches);
  // The next build gives the kept tables its own session.
  tables.session = newSession();
  let known: Map<string, string[]> = units !== undefined ? units! : new Map<string, string[]>();
  linked(building, ir, split, out, release, links, shim, target, leaks, debug, known, profile);
  return { ir: made.ir, warnings: made.warnings, session: building, kept: { checked: { instances, tables, warnings }, parts: checkerParts, loaded, contents, carried, emitted, units: known } };
}

// `compile` for `fishc watch`, from what its last build kept, giving the IR, the warnings and what
// to keep.
/** @throws {CompileError | Error | IoError | JsonError} */
export function compiledKept(session: Session, file: string, release: boolean, panic: Panic, leaks: boolean, debug: boolean, looked: Mut<string[]>, kept: Kept | undefined, manifest: string | undefined, keep = true, profile: Profiling = false): { ir: string; warnings: CompileError[]; kept: Kept } {
  const reusing = kept !== undefined;
  // Reading the files again and putting the changed ones back, apart from the check it times itself.
  // Counted by hand from the front end's stages, since the session it starts on moves into the
  // check's tables and takes its own copy of the timings with it.
  const began = performance.now();
  let before: f64 = 0;
  if (session.timings !== undefined) for (const name of FRONT_END) before += session.timings!.ms.get(name) ?? 0;
  let queries = new Queries(file, manifest, new Map<string, string>());
  let given = session;
  given.build = buildFor(given.build, undefined, release);
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
  let made = generated(start.checked, start.loaded, { src: readFileSync(file, "utf8"), file, release, panic, library: false, sources, leaks, profile, debug, failed, prior: debug ? undefined : start.emitted, rechecked: start.rechecked, keep });
  let warnings = [...made.checked.warnings];
  // A clean check gives its warnings in the order they are written in, which a kept one's
  // positions only give through their files' maps.
  if (reusing) {
    const placed: Ref<Source[]> = made.loaded.sources;
    warnings.sort((a, b) => (realOffset(a.start, placed) as i64) - (realOffset(b.start, placed) as i64));
  }
  return { ir: made.ir, warnings, kept: { checked: made.checked, parts: start.parts, loaded: made.loaded, contents: start.contents, carried: start.carried, emitted: made.emitted, units: start.units } };
}

// How a build from what `fishc watch` kept differs from a clean build of `file`: its IR, its
// warnings, or the error it stopped at, or undefined when they match.
/** @throws {IoError} */
export function cleanDifference(session: Session, file: string, release: boolean, panic: Panic, leaks: boolean, debug: boolean, got: Ref<{ ir: string; warnings: CompileError[] } | CompileError>, profile: Profiling = false): string | undefined {
  let clean: { ir: string; warnings: CompileError[] } | CompileError | undefined = undefined;
  try {
    let looked: string[] = [];
    const made = compiledIn(newCompilation(session), readFileSync(file, "utf8"), file, release, panic, false, leaks, debug, looked, profile);
    clean = { ir: made.ir, warnings: [...made.checked.warnings] };
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

// The length of IR up to which a release build is one module. Clang optimizing a module holds
// about 40 bytes for each byte of it, 24 GB for the compiler's own 570 MB, so a larger program
// is compiled a file at a time, as a dev build is, and clang holds one file's code at once.
const RELEASE_MODULE_LENGTH: usize = 64 * 1024 * 1024;
// The most of one file's functions that go to clang as one unit. Clang holds a unit of this much
// IR in under a gigabyte and compiles it in well under a minute, so a build's units can go to it
// side by side on a small machine, and no one file sets how long the build takes.
const UNIT_LENGTH: usize = 16 * 1024 * 1024;

// A build's IR as clang is given it: a release build's as one module, so `-O2` inlines across std
// and the program, unless it is over `RELEASE_MODULE_LENGTH`, and a dev build's as the program's
// part, with std's part and each of the program's files a unit of its own that the cache keeps by
// its text, so a rebuild compiles only the files whose code changed. A `-g` build keeps its files
// in the program's part, which holds the debug metadata their functions refer to.
function parts(ir: string, checked: Ref<Checked>, release: boolean, target: Ref<Target>, debug = false): { cached: Unit[]; program: string; times: [string, f64][] } {
  if (release && ir.length < RELEASE_MODULE_LENGTH) return { cached: [], program: ir, times: [] };
  const naming = performance.now();
  const arenas: Ref<Arenas> = checked.tables.arenas;
  const names = symbolNames(arenas);
  let std: string[] = [];
  let own: string[] = [];
  let byFile = new Map<string, string[]>();
  for (const i of compiledOf(checked)) {
    const body = bodyOf(arenas, i);
    if (body.foreign === true || body.rust !== undefined) continue;
    const symbol = symbolIn(arenas, i, names);
    if (body.start >= STD_BASE) {
      std.push(symbol);
      continue;
    }
    own.push(symbol);
    if (debug) continue;
    const file = fileAt(checked.tables.files, body.start);
    const had = byFile.get(file);
    if (had === undefined) byFile.set(file, [symbol]);
    else {
      let list: string[] = had;
      list.push(symbol);
      byFile.set(file, list);
    }
  }
  const named = performance.now() - naming;
  // The selectors that stand in for GlobalISel drop a branch on a constant and keep the block it
  // never takes, and clang 18 passes over that block's return as it writes the unwind table, so
  // the code after it unwinds as if its frame were gone. A synchronous table says nothing at a
  // return, and a panic unwinds only from calls.
  if (withoutGlobalIsel(release, target)) ir = ir.replace(/^(define [^\n]*) uwtable( personality [^\n]* \{| \{)$/gm, "$1 uwtable(sync)$2");
  const halves = split(ir, std, own, byFile, UNIT_LENGTH);
  const args = [...target.compile, "-x", "ir", "-", ...optimization(release, target), "-funwind-tables"];
  let cached: Unit[] = [{ name: "std", args: [...args], stdin: halves.std, inputs: [] }];
  for (const [file, text] of halves.groups) cached.push({ name: `file-${file.replace(/[^\w.-]/g, "_")}`, args: [...args], stdin: text, inputs: [] });
  return { cached, program: halves.program, times: [["split names", named], ...halves.times] };
}

// Builds the program's IR, split into `halves`, into the executable `out`.
/** @throws {Error | IoError} */
// `known` is each unit's text and object from the build before, kept by `fishc watch`, so a unit
// whose text is the same takes its object without hashing the text again.
function linked(session: Mut<BuildSession>, ir: string, halves: Ref<{ cached: Unit[]; program: string }>, out: string, release: boolean, links: string[], shim: Shim | undefined, target: Ref<Target>, leaks: boolean, debug: boolean, known: Mut<Map<string, string[]>>, profile: Profiling = false) {
  const started = stageStart(session);
  let units = runtimeUnits(ir, release, false, copyTarget(target), leaks, profile);
  for (const u of halves.cached) units.push(u.clone());
  let objects = knownObjects(session, units, known);
  for (const o of mathObjects(session, [...target.compile])) objects.push(o);
  stageEnd(session, "runtime", started);
  const none: string[] = [];
  const g = debug ? ["-g"] : none;
  const tls = runtimeLinks(ir, target);
  const cc = session.cc ?? "clang";
  if (session.timings === undefined) {
    clang([...clangArgs(out, release, links, objects, shim, copyTarget(target), ["-x", "ir", "-"], cc), ...tls, ...g], halves.program);
    return;
  }
  // Timed, the program is compiled and linked by two clang calls, so each is measured on its own.
  const note = objectsNote(session.timings);
  session.timings.notes.set("runtime", note);
  const dir = mkdtempSync(join(tmpdir(), "fishc-"));
  try {
    const object = join(dir, "program.o");
    const compiling = stageStart(session);
    clang([cc, ...target.compile, "-c", "-x", "ir", "-", "-o", object, "-funwind-tables", ...optimization(release, target), ...g], halves.program);
    stageEnd(session, "compile", compiling);
    const linking = stageStart(session);
    clang([...clangArgs(out, release, links, objects, shim, copyTarget(target), [object], cc), ...tls, ...g]);
    // On macOS the debug info stays in the object, deleted below; clang gathers it into a .dSYM
    // only when it compiles and links in one call, so it is gathered here.
    const darwin = target.triple === "" ? process.platform === "darwin" : target.triple.includes("-apple-");
    if (debug && darwin) clang(["dsymutil", out]);
    stageEnd(session, "link", linking);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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
    const was = known.get(u.name);
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
    known.set(fresh[k]!.name, [fresh[k]!.stdin ?? "", made[k]!]);
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
  const halves = parts(made.ir, made.checked, release, host);
  const shim = rustShim(made.loaded.rust, made.checked);
  let building = together(made.checked.tables.session, caches);
  // ponytail: each object in turn, as Fish can't map to promises yet; Promise.all over them once it can.
  let objects: string[] = [];
  const cc = building.cc ?? "clang";
  for (const u of runtimeUnits(made.ir, release)) {
    const object = await objectAsync(u, objectPath(building, u), cc);
    objects.push(object);
  }
  for (const u of halves.cached) {
    const object = await objectAsync(u, objectPath(building, u), cc);
    objects.push(object);
  }
  const math = await mathObjectsAsync(building);
  for (const o of math) objects.push(o);
  const compiler = Bun.spawn([...clangArgs(out, release, links, objects, shim, copyTarget(host), ["-x", "ir", "-"], cc), ...runtimeLinks(made.ir, host)], { stdin: new TextEncoder().encode(halves.program), stderr: "pipe" });
  const errors = new Response(compiler.stderr);
  const [code, stderr] = await Promise.all([compiler.exited, errors.text()]);
  if (code !== 0) throw new Error(`clang failed:\n${stderr}`);
  return made.checked.warnings;
}

// Builds the tests of the package at `dir` into one program at `out`, unless it has none, and gives
// them in declaration order. Every `.fsh` file of the package is loaded through a generated entry,
// the harness, whose `main` runs one test by its index.
/** @throws {CompileError | Error | IoError | JsonError} */
export function buildTests(session: BuildSession, dir: string, out: string, release = false, docs = false): Test[] {
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
    tests = liftTests(compilation, loaded.modules, paths, docs);
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
  const halves = parts(made.ir, made.checked, release, host);
  let building = together(made.checked.tables.session, caches);
  let none = new Map<string, string[]>();
  linked(building, made.ir, halves, out, release, [], shim, host, false, false, none);
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

function parseSimSeed(text: string): u64 | undefined {
  if (!/^[0-9]{1,20}$/.test(text)) return undefined;
  let value: u64 = 0 as u64;
  const maxDiv10: u64 = 1844674407370955161 as u64;
  for (let i: usize = 0; i < text.length; i++) {
    const d = (text.charCodeAt(i) - 48) as u64;
    if (value > maxDiv10 || (value === maxDiv10 && d > (5 as u64))) return undefined;
    value = value * (10 as u64) + d;
  }
  return value;
}

// `testPackage`'s build and run, the build at `out`.
/** @throws {Error | IoError | JsonError} */
async function testsIn(session: BuildSession, dir: string, out: string, filter: string | undefined, release: boolean, options: Ref<RunOptions>): Promise<i64> {
  let running = new Set<i32>();
  try {
    const tests = buildTests(session, dir, out, release, options.docs);
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

type FuzzOptions = {
  runs?: usize;
  maxTime?: usize;
  corpus?: string;
  artifacts?: string;
  replay?: string;
  asan: boolean;
  list: boolean;
};

// Discovers all `fuzz()` blocks in `files` (relative to `dir`).
/** @throws {CompileError | Error | IoError} */
function discoverFuzz(session: BuildSession, dir: string, files: Ref<string[]>): FuzzTarget[] {
  if (files.length === 0) return [];
  const realDir = realpathSync(dir);
  let paths: string[] = [];
  for (const f of files) paths.push(realpathSync(f));
  const manifest = findManifest(realDir);
  const scratchDir = manifest === undefined ? realpathSync(mkdtempSync(join(tmpdir(), "fishc-fuzz-h-"))) : undefined;
  const harnessDir = manifest !== undefined ? realpathSync(dirname(manifest!)) : scratchDir!;
  const entry = manifest !== undefined ? realpathSync(manifest!) : join(scratchDir!, "harness.fsh");
  const src = fuzzHarnessImports(harnessDir, [...paths]);
  try {
    if (scratchDir !== undefined) writeFileSync(entry, src);
    let { core } = apart(session);
    let compilation = newCompilation(core);
    let loaded = load(compilation, entry, src);
    try {
      const targets = liftFuzz(compilation, loaded.modules, paths);
      let shown: FuzzTarget[] = [];
      for (const t of targets) shown.push({ name: t.name, module: { file: relative(realDir, t.module.path), path: t.module.path }, index: t.index });
      return shown;
    } catch (e) {
      if (e instanceof CompileError) throw sourced(e, copyNames(compilation.names), loaded.sources);
      throw e;
    }
  } finally {
    if (scratchDir !== undefined) rmSync(scratchDir!, { recursive: true, force: true });
  }
}

// Builds one `fuzz()` target (by name) into a libFuzzer executable at `out`.
/** @throws {CompileError | Error | IoError | JsonError} */
function buildFuzzTarget(session: BuildSession, dir: string, files: Ref<string[]>, targetName: string, out: string, asan: boolean, cc: string): void {
  const realDir = realpathSync(dir);
  let paths: string[] = [];
  for (const f of files) paths.push(realpathSync(f));
  const manifest = findManifest(realDir);
  const scratchDir = manifest === undefined ? realpathSync(mkdtempSync(join(tmpdir(), "fishc-fuzz-h-"))) : undefined;
  const harnessDir = manifest !== undefined ? realpathSync(dirname(manifest!)) : scratchDir!;
  const entry = manifest !== undefined ? realpathSync(manifest!) : join(scratchDir!, "harness.fsh");
  const src = fuzzHarnessImports(harnessDir, [...paths]);
  try {
    if (scratchDir !== undefined) writeFileSync(entry, src);
    let { core, caches } = apart(session);
    let compilation = newCompilation(core);
    let loaded = load(compilation, entry, src);
    let program: Stmt[] = [];
    try {
      const targets = liftFuzz(compilation, loaded.modules, paths);
      const chosen = targets.find((t) => t.name === targetName);
      if (chosen === undefined) throw new Error(`fishc fuzz: internal error: target '${targetName}' disappeared`);
      hideMains(compilation, loaded.modules);
      let harness = fuzzHarnessMain(compilation.ids, chosen!, loaded.modules);
      while (harness.length > 0) loaded.modules[0]!.statements.push(harness.shift()!);
      program = expanded(compilation, loaded, true);
    } catch (e) {
      if (e instanceof CompileError) throw sourced(e, copyNames(compilation.names), loaded.sources);
      throw e;
    }
    const checked = checkedProgram(compilation, program, runtimeNames(), loaded.sources).checked;
    const sources = [...loaded.sources];
    const release = !asan;
    const made = generated(checked, loaded, { src, file: entry, release, panic: "abort", library: true, fuzz: true, sources, harness: true, debug: false });
    const shim = rustShim(made.loaded.rust, made.checked);
    const platform = fuzzerTarget(asan);
    const ir = instrumented(made.ir, platform);
    const halves = parts(ir, made.checked, release, platform, false);
    let building = together(made.checked.tables.session, caches);
    building.cc = cc;
    building.clang = undefined;
    let none = new Map<string, string[]>();
    linked(building, ir, halves, out, release, [], shim, platform, false, false, none);
  } finally {
    if (scratchDir !== undefined) rmSync(scratchDir!, { recursive: true, force: true });
  }
}

function isArtifactName(name: string): boolean {
  return name.startsWith("crash-") || name.startsWith("oom-") || name.startsWith("timeout-") || name.startsWith("leak-");
}

// Records existing libFuzzer artifact files and their mtimes so a new crash artifact can be
// identified after an inherited-stdio run without buffering libFuzzer's output in memory.
function snapshotArtifacts(dir: string): Map<string, f64> {
  let snap = new Map<string, f64>();
  try {
    for (const name of readdirSync(dir)) {
      if (!isArtifactName(name)) continue;
      const st = statSync(join(dir, name));
      if (st.isFile()) snap.set(name, st.mtimeMs);
    }
  } catch (_e) {
    // Directory may not exist yet or be unreadable.
  }
  return snap;
}

function newestArtifact(dir: string, before: Ref<Map<string, f64>>): string | undefined {
  let bestPath: string | undefined = undefined;
  let bestMtime: f64 = -1;
  try {
    for (const name of readdirSync(dir)) {
      if (!isArtifactName(name)) continue;
      const full = join(dir, name);
      const st = statSync(full);
      if (!st.isFile()) continue;
      const prev = before.get(name);
      if (prev !== undefined && st.mtimeMs <= prev!) continue;
      if (st.mtimeMs >= bestMtime) {
        bestMtime = st.mtimeMs;
        bestPath = full;
      }
    }
  } catch (_e) {
    return undefined;
  }
  return bestPath;
}

// Reads at most `limit` bytes plus total file size from `path` without loading huge artifacts.
/** @throws {IoError} */
function readArtifactHead(path: string, limit: usize): { sample: u8[]; total: usize } {
  const total = statSync(path).size as usize;
  const take = total < limit ? total : limit;
  if (take === 0) return { sample: [], total };
  let buf = new Uint8Array(take);
  const fd = openSync(path, "r");
  let got: usize = 0;
  try {
    const n = readSync(fd, buf, 0, take as i64, 0);
    if (n > 0) got = n as usize;
  } finally {
    closeSync(fd);
  }
  return { sample: buf.slice(0, got as i64), total };
}

function buildReplayHint(isFile: boolean, fileArg: string | undefined, totalTargets: usize, targetName: string, artifactPath: string): string {
  let parts: string[] = ["fishc", "fuzz"];
  if (isFile && fileArg !== undefined) parts.push(shellQuote(fileArg));
  if (totalTargets > 1) parts.push(shellQuote(targetName));
  parts.push("--replay");
  parts.push(shellQuote(artifactPath));
  return parts.join(" ");
}

type FuzzRace = { kind: "exit"; code: i64 } | { kind: "signal"; code: i64 };

function fuzzSignalled(signal: "SIGINT" | "SIGTERM", code: i64): Promise<FuzzRace> {
  return new Promise<FuzzRace>((resolve) => {
    process.once(signal, () => resolve({ kind: "signal", code }));
  });
}

// Runs one built libFuzzer binary with inherited stdio so progress streams live in O(1) memory,
// detecting any saved crash artifact and printing the formatted reproducer.
/** @throws {IoError} */
async function runFuzzBinary(binary: string, scratch: string, target: Ref<FuzzTarget>, isFile: boolean, fileArg: string | undefined, totalTargets: usize, options: Ref<FuzzOptions>, running: Mut<Set<i32>>): Promise<i64> {
  let args: string[] = [];
  let artDir = process.cwd();
  let before = new Map<string, f64>();
  if (options.replay !== undefined) {
    args.push(`-artifact_prefix=${scratch}${sep}`);
    args.push(resolve(options.replay!));
  } else {
    if (options.runs !== undefined) args.push(`-runs=${options.runs!}`);
    if (options.maxTime !== undefined) args.push(`-max_total_time=${options.maxTime!}`);
    if (options.artifacts !== undefined) {
      artDir = resolve(options.artifacts!);
      mkdirSync(artDir, { recursive: true });
      args.push(`-artifact_prefix=${artDir}${sep}`);
    }
    if (options.corpus !== undefined) {
      const dir = resolve(options.corpus!);
      mkdirSync(dir, { recursive: true });
      args.push(dir);
    }
    before = snapshotArtifacts(artDir);
  }
  const child = Bun.spawn([binary, ...args], { cwd: process.cwd(), stdin: "ignore", stdout: "inherit", stderr: "inherit", detached: true });
  const group = child.pid as i32;
  running.add(group);
  const code = await child.exited;
  running.delete(group);
  if (code === 0) {
    console.log(`ok ${target.module.file} > ${target.name}`);
    return 0;
  }
  const artifact = options.replay !== undefined ? resolve(options.replay!) : newestArtifact(artDir, before);
  if (artifact !== undefined && existsSync(artifact!) && statSync(artifact!).isFile()) {
    const shown = options.artifacts !== undefined || options.replay !== undefined ? artifact! : relative(process.cwd(), artifact!);
    const head = readArtifactHead(artifact!, 256);
    const replayHint = buildReplayHint(isFile, fileArg, totalTargets, target.name, shown);
    console.error(`\n${formatReproducer(target, shown, head.sample, head.total, replayHint)}`);
  } else {
    console.error(`FAIL ${target.module.file} > ${target.name} (exited with ${code})`);
  }
  return 1;
}

/** @throws {Error | IoError | JsonError} */
async function runFuzzLoop(dir: string, files: Ref<string[]>, chosen: Ref<FuzzTarget[]>, totalTargets: usize, scratch: string, cc: string, isFile: boolean, fileArg: string | undefined, options: Ref<FuzzOptions>, running: Mut<Set<i32>>): Promise<FuzzRace> {
  for (let i: usize = 0; i < chosen.length; i++) {
    const target: Ref<FuzzTarget> = chosen[i]!;
    const binary = join(scratch, `fuzz-${i}`);
    try {
      buildFuzzTarget(sessionWith(false, false, true), dir, files, target.name, binary, options.asan, cc);
    } catch (e) {
      if (e instanceof CompileError) {
        console.error(painted(e, relative(process.cwd(), join(dir, "__fish_fuzz__.fsh")), ""));
        return { kind: "exit", code: 1 };
      }
      throw e;
    }
    const ran = await runFuzzBinary(binary, scratch, target, isFile, fileArg, totalTargets, options, running);
    if (ran !== 0) return { kind: "exit", code: ran };
  }
  return { kind: "exit", code: 0 };
}

/** @throws {Error | IoError | JsonError} */
async function runFuzz(session: BuildSession, dir: string, files: Ref<string[]>, filter: string | undefined, isFile: boolean, fileArg: string | undefined, options: Ref<FuzzOptions>): Promise<i64> {
  let targets: FuzzTarget[] = [];
  try {
    targets = discoverFuzz(session, dir, files);
  } catch (e) {
    if (e instanceof CompileError) {
      console.error(painted(e, relative(process.cwd(), join(dir, "__fish_fuzz__.fsh")), ""));
      return 1;
    }
    throw e;
  }
  if (targets.length === 0) {
    console.log("no fuzz targets found");
    return 0;
  }
  const totalTargets = targets.length;
  const chosen = filter === undefined ? targets : targets.filter((t) => t.name.includes(filter!));
  if (chosen.length === 0) {
    console.error(`fishc fuzz: no fuzz target's name contains '${filter ?? ""}'`);
    return 1;
  }
  if (options.list) {
    for (const t of chosen) console.log(`${t.module.file} > ${t.name}`);
    return 0;
  }
  if (chosen.length > 1 && options.runs === undefined && options.maxTime === undefined && options.replay === undefined) {
    console.error(`fishc fuzz: found ${chosen.length} fuzz targets (${chosen.map((t) => t.name).join(", ")}); name one to fuzz, or pass --runs <n> or --max-time <sec>`);
    return 2;
  }
  const cc = findFuzzerClang(options.asan);
  const scratch = mkdtempSync(join(tmpdir(), "fishc-fuzz-"));
  let running = new Set<i32>();
  let code: i64 = 0;
  try {
    const outcome = await Promise.race([
      runFuzzLoop(dir, files, chosen, totalTargets, scratch, cc, isFile, fileArg, options, running),
      fuzzSignalled("SIGINT", 130),
      fuzzSignalled("SIGTERM", 143),
    ]);
    code = outcome.code;
  } catch (e) {
    stopTests(running);
    rmSync(scratch, { recursive: true, force: true });
    throw e;
  }
  stopTests(running);
  rmSync(scratch, { recursive: true, force: true });
  return code;
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

// A session for one build, with the lockfile kept as it is when `locked`, timed when `timed`, and
// reading no cached check when `checking`.
function flagsCopy(flags: Ref<BuildFlag[]>): BuildFlag[] {
  return flags.map((f) => ({ name: f.name, value: f.value }));
}

// Each `--flag name` or `--flag name=value`, the last one given for a name winning.
function buildFlagsOf(given: string[]): BuildFlag[] {
  let flags: BuildFlag[] = [];
  for (const g of given) {
    const at = g.indexOf("=");
    const name = at < 0 ? g : g.slice(0, at);
    if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(name)) fail(`fishc: '--flag ${g}' names no flag; a flag is a name such as 'fast' or 'level=3', starting with a letter`);
    const value = at < 0 ? null : g.slice(at + 1);
    const known = flags.findIndex((f) => f.name === name);
    if (known >= 0) flags.splice(known, 1);
    flags.push({ name, value });
  }
  return flags;
}

function sessionWith(locked: boolean, timed: boolean, checking = false, flags: BuildFlag[] = []): BuildSession {
  let made = cachedSession();
  if (flags.length > 0) made.build = { triple: "", release: false, flags };
  made.locking.locked = locked;
  // FISH_MEM=1 records what the process holds as each stage ends, as stages are timed.
  const memory = process.env.FISH_MEM === "1";
  // FISH_MEM_STOP=<stage> ends the process as that stage ends, with the same readings.
  const stop = process.env.FISH_MEM_STOP;
  if (stop !== undefined && !STOP_STAGES.includes(stop!)) fail(`fishc: FISH_MEM_STOP names '${stop!}', which is no stage to stop after; give ${STOP_STAGES.join(", ")}`);
  if (timed || memory || stop !== undefined) {
    let timings = newTimings();
    timings.report = timed;
    if (memory || stop !== undefined) timings.memory = new Map<string, Reading>();
    if (stop !== undefined) timings.stop = stop!;
    made.timings = timings;
  }
  if (checking) made.checkCache = false;
  return made;
}

// Codegen's own parts, which watch's timings show apart since a rebuild may skip only some.
const CODEGEN_PARTS = ["codegen names", "codegen setup", "codegen comptime", "codegen sharing", "codegen functions", "codegen tail", "codegen assembly", "codegen kept", "codegen bundle"];
const OTHER_PARTS = ["reload compare", "reload read", "reload classify", "split names", "split items", "split reach", "split parts"];

// What one of `fishc watch`'s builds takes.
type Rebuild = { entry: string; binary: string; links: string[]; release: boolean; panic: Panic; leaks: boolean; profile: Profiling; debug: boolean; locked: boolean; timed: boolean; manifest: string | undefined; flags: BuildFlag[] };

// One of `fishc watch`'s builds: whether it built, and the files it read or looked for.
function rebuilt(r: Ref<Rebuild>, kept: Kept | undefined): Rebuilt {
  let loaded: string[] = [];
  try {
    const start = performance.now();
    let made = builtKept(sessionWith(r.locked, r.timed, false, flagsCopy(r.flags)), r.entry, r.binary, r.release, r.panic, [...r.links], hostTarget(), r.leaks, r.debug, loaded, kept, r.manifest, true, r.profile);
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
    if (made.kept.carried > 0) verified(r, { ir: made.ir, warnings: [...made.warnings] });
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
function saved(carried: usize, ir: string, warnings: Ref<CompileError[]>): void {
  const dir = process.env.FISH_WATCH_IR;
  if (dir === undefined) return;
  try {
    mkdirSync(dir!, { recursive: true });
    writeFileSync(join(dir!, `build-${carried}.ll`), ir);
    writeFileSync(join(dir!, `build-${carried}.warnings`), warnings.map((w) => `${w.code} ${w.message}`).join("\n"));
  } catch (e) {
    console.error(`[fishc] can't save the build's IR in ${dir!}: ${(e as { message: string }).message}`);
  }
}

// With FISH_WATCH_VERIFY set, says when a build from what watch kept differs from a clean one.
function verified(r: Ref<Rebuild>, got: Ref<{ ir: string; warnings: CompileError[] } | CompileError>): void {
  if (process.env.FISH_WATCH_VERIFY === undefined) return;
  try {
    const wrong = cleanDifference(sessionWith(r.locked, false, true, flagsCopy(r.flags)), r.entry, r.release, r.panic, r.leaks, r.debug, got, r.profile);
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
function linesWith(ir: string, name: string): string[] {
  let out: string[] = [];
  let at = ir.indexOf(name);
  while (at >= 0) {
    let end = ir.indexOf("\n", at);
    if (end < 0) end = ir.length as i64;
    out.push(ir.slice(ir.lastIndexOf("\n", at) + 1, end));
    at = ir.indexOf(name, end);
  }
  return out;
}

export const callsEngine = (ir: string) => linesWith(ir, "@fsh_rt_js_").some((l) => /^\s+(?:%\S+ = )?(?:call|invoke) [^"\n]*@fsh_rt_js_/.test(l));

// Whether the IR calls into the OpenSSL half of the runtime, as fetch, serve and the tls module do
// for TLS, and the postgres module and WebSocket handshakes for hashes. A function std declares
// itself is called by its quoted name.
export const callsTls = (ir: string) => [...linesWith(ir, "fsh_rt_tls_"), ...linesWith(ir, "fsh_rt_crypto_")].some((l) => /^\s+(?:%\S+ = )?(?:call|invoke) [^"\n]*@"?fsh_rt_(?:tls|crypto)_/.test(l));

// Whether the IR calls into the zlib half of the runtime, as the zlib module does.
export const callsZlib = (ir: string) => linesWith(ir, "fsh_rt_zlib_").some((l) => /^\s+(?:%\S+ = )?(?:call|invoke) [^"\n]*@"?fsh_rt_zlib_/.test(l));

// Whether the IR calls into the brotli half of the runtime, as the compress module does.
export const callsBrotli = (ir: string) => linesWith(ir, "fsh_rt_brotli_").some((l) => /^\s+(?:%\S+ = )?(?:call|invoke) [^"\n]*@"?fsh_rt_brotli_/.test(l));

// Whether the IR calls into the SQLite half of the runtime, as the sqlite module does.
export const callsSqlite = (ir: string) => linesWith(ir, "fsh_rt_sqlite_").some((l) => /^\s+(?:%\S+ = )?(?:call|invoke) [^"\n]*@"?fsh_rt_sqlite_/.test(l));

// What links OpenSSL into a program calling the TLS runtime, when it was found, without which the
// runtime's TLS calls say how to install it, zlib into one calling the zlib runtime, libbrotlienc
// into one calling the brotli runtime, and the system's SQLite into one calling the SQLite runtime.
export function runtimeLinks(ir: string, target: Ref<Target>): string[] {
  let libraries: string[] = [];
  if (callsZlib(ir)) libraries.push("-lz");
  // runtimeUnits has already refused a build when libbrotlienc is missing.
  const brotli = callsBrotli(ir) ? findBrotli(target) : undefined;
  if (brotli !== undefined && "link" in brotli) for (const flag of brotli.link) libraries.push(flag);
  if (callsSqlite(ir)) libraries.push("-lsqlite3");
  if (!callsTls(ir)) return libraries;
  const openssl = findOpenSsl(target);
  const none: string[] = [];
  return [...("link" in openssl ? openssl.link : none), ...libraries];
}

// The C half of the runtime as cached objects, with the engine's glue and sources when the
// program's IR calls the engine, and the TLS, zlib, brotli and SQLite halves when it calls those. They are built with unwind tables so a panic can unwind through
// them, and position-independent when `pic`, for a library. A `--leaks` build's runtime records
// each block's site, so it is an object of its own.
/** @throws {IoError} */
export function runtimeUnits(ir: string, release: boolean, pic = false, target: Target = hostTarget(), leaks = false, profile: Profiling = false): Unit[] {
  const js = callsEngine(ir);
  const openssl = callsTls(ir) ? findOpenSsl(target) : undefined;
  const none: string[] = [];
  if (js && isWasm(target.triple)) throw new IoError(`fishc build: npm packages run in the JS engine, which isn't built for ${target.triple}; build without --target, or without the package`);
  const flags = [...target.compile, "-funwind-tables", ...threading(target), ...optimization(release, target), ...(pic ? ["-fPIC"] : none), ...(js ? ["-I", engineDir()] : none)];
  const tls = openssl === undefined ? "" : "missing" in openssl ? "-tls-missing" : "-tls";
  const name = `${js ? "runtime-js" : "runtime"}${tls}${leaks ? "-leaks" : ""}${profile === true ? "-profile" : profile === "heap" ? "-heap-profile" : ""}`;
  // A debug build's runtime checks the order Locks are taken in.
  const source = [...(release ? none : ["#define FSH_LOCK_ORDER"]), NATIVE, ...(js ? [JS_NATIVE] : none), ...(openssl === undefined ? none : ["missing" in openssl ? tlsStub(openssl.missing) : TLS_NATIVE])].join("\n");
  const tlsFlags = openssl !== undefined && "compile" in openssl ? openssl.compile : [...none];
  const runtime: Unit = { name, args: ["-x", "c", "-", ...flags, ...tlsFlags, ...(leaks ? ["-DFSH_LEAK_SITES"] : none), ...(profile === true ? ["-DFSH_PROFILE"] : profile === "heap" ? ["-DFSH_HEAP_PROFILE"] : none)], stdin: source, inputs: js ? files(engineDir()) : none };
  const engine: Unit[] = js ? engineSources().map((source): Unit => ({ name: basename(source, ".c"), args: ["-x", "c", source, ...flags], inputs: files(engineDir()) })) : [];
  const zlib: Unit[] = callsZlib(ir) ? [{ name: "zlib", args: ["-x", "c", "-", ...flags], stdin: ZLIB_NATIVE, inputs: [] }] : [];
  const brotlienc = callsBrotli(ir) ? findBrotli(target) : undefined;
  if (brotlienc !== undefined && "missing" in brotlienc) throw new IoError(brotlienc.missing);
  const brotli: Unit[] = brotlienc !== undefined && "compile" in brotlienc ? [{ name: "brotli", args: ["-x", "c", "-", ...flags, ...brotlienc.compile], stdin: BROTLI_NATIVE, inputs: [] }] : [];
  const sqlite: Unit[] = callsSqlite(ir) ? [{ name: "sqlite", args: ["-x", "c", "-", ...flags], stdin: SQLITE_NATIVE, inputs: [] }] : [];
  const shim = cShimLines(ir);
  const c: Unit[] = shim.length > 0 ? [{ name: "cshim", args: ["-x", "c", "-", ...flags, "-w", "-fno-builtin"], stdin: ["#include <stddef.h>", "#include <stdint.h>", ...shim, ""].join("\n"), inputs: [] }] : [];
  return [runtime, ...engine, ...zlib, ...brotli, ...sqlite, ...c];
}

// The C the module carries for its C functions taking or giving `@c` structs, which clang
// compiles so that each struct is passed as the target's C ABI passes it.
function cShimLines(ir: string): string[] {
  let out: string[] = [];
  for (const line of linesWith(ir, "; fsh.c ")) if (line.startsWith("; fsh.c ")) out.push(line.slice(8));
  return out;
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
function clangArgs(out: string, release: boolean, links: string[], objects: string[], shim?: Shim, target: Target = hostTarget(), program: string[] = ["-x", "ir", "-"], cc = "clang"): string[] {
  const none: string[] = [];
  return [cc, ...target.compile, ...target.link, ...program, "-x", "none", ...objects, "-funwind-tables", ...threading(target), "-o", out, ...optimization(release, target), "-lm", ...links.map((l) => `-l${l}`), ...(shim !== undefined ? [shim.lib, ...shim.links] : none)];
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

// `fishc bind c`: a header's bindings written to `out`, or printed, and what was left out listed
// on stderr.
function bindFile(header: string, out: string | undefined, flags: string[]): never {
  try {
    const bound = bindHeader(header, process.env.CC ?? "clang", flags);
    if (out === undefined) process.stdout.write(bound.source);
    else writeFileSync(out!, bound.source);
    for (const line of bound.skipped) console.error(`skipped ${line}`);
  } catch (e) {
    fail(`fishc bind: ${e instanceof Error ? e.message : (e as { message: string }).message}`);
  }
  return process.exit(0);
}

// `fishc openapi`: prints the OpenAPI document of the routes `file`'s program adds to std's
// routers, or writes it to `out`, and names on stderr each route the document leaves out. Its
// title and version are the package's, or the file's name and 0.0.0 for a file in no package.
// With `client`, `fishc client`: the TypeScript client of the same routes in its place.
/** @throws {Error | IoError} */
function openapiFile(file: string, out: string | undefined, client = false): never {
  let src = "";
  try {
    src = readFileSync(file, "utf8");
  } catch (e) {
    fail(`fishc ${client ? "client" : "openapi"}: can't read '${file}': ${(e as { message: string }).message}`);
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
    let text = "";
    let left: LeftOut[] = [];
    if (client) {
      const made = clientOf(kept.checked.tables, basename(file));
      text = made.code.trimEnd();
      left = made.left;
    } else {
      const made = openapiOf(kept.checked.tables, title, version);
      text = indented(made.document);
      left = made.left;
    }
    for (const l of left) {
      const skipped = sourced(new CompileError("W0003", `this route is left out of the ${client ? "client" : "document"}: ${l.why}`, l.start, l.end), undefined, kept.loaded.sources);
      console.error(painted(skipped, file, src, "warning"));
    }
    if (out === undefined) console.log(text);
    else writeFileSync(out!, `${text}\n`);
  } catch (e) {
    if (e instanceof CompileError) console.error(painted(e, file, src));
    else console.error((e as { message: string }).message);
    process.exit(1);
  }
  return process.exit(0);
}

// The time each of a build's `stages` took, printed when the build was timed.
function reportTimings(session: Ref<Session>, stages: Ref<string[]>, start: f64) {
  if (session.timings === undefined) return;
  if (session.timings.report) process.stderr.write(formatTimings(session.timings, stages, performance.now() - start));
  if (session.timings.memory !== undefined) process.stderr.write(formatMemory(session.timings.memory!, stages));
  if (session.timings.tables !== undefined) process.stderr.write(session.timings.tables!);
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

// The first exercise in `dir`, from `from` on, that doesn't compile, and its error as fishc check
// prints it; undefined when they all do.
/** @throws {IoError} */
function unsolved(dir: string, from: usize): { at: usize; error: string } | undefined {
  for (let i = from; i < EXERCISES.length; i++) {
    const path = join(dir, EXERCISES[i]!.file);
    const shown = join(FOLDER, EXERCISES[i]!.file);
    try {
      checkedFile(sessionWith(false, false, true), path);
    } catch (e) {
      if (e instanceof CompileError) return { at: i, error: painted(e, shown, readFileSync(path, "utf8")) };
      return { at: i, error: (e as { message: string }).message };
    }
  }
  return undefined;
}

// `fishc learn`: writes the exercises missing from `fish-learn/`, then shows the first that doesn't
// compile and waits for it to be saved, going on to the next once it compiles, until all do. With
// `hint`, the hint of the first that doesn't; with `once`, the first that doesn't, without waiting.
// Gives the exit code: 0 once every exercise compiles.
/** @throws {IoError} */
async function learn(hint: boolean, once: boolean): Promise<i64> {
  const dir = join(process.cwd(), FOLDER);
  mkdirSync(dir, { recursive: true });
  for (let i: usize = 0; i < EXERCISES.length; i++) {
    const path = join(dir, EXERCISES[i]!.file);
    if (!existsSync(path)) writeFileSync(path, exerciseText(i, EXERCISES[i]!));
  }
  const done = `every one of the ${EXERCISES.length} exercises compiles; you've finished the tutorial`;
  let found = unsolved(dir, 0);
  if (hint) {
    console.log(found === undefined ? done : `${join(FOLDER, EXERCISES[found!.at]!.file)}: ${EXERCISES[found!.at]!.hint}`);
    return 0;
  }
  while (found !== undefined) {
    const at = found!.at;
    const path = join(dir, EXERCISES[at]!.file);
    console.log(`exercise ${at + 1} of ${EXERCISES.length}: ${join(FOLDER, EXERCISES[at]!.file)}\n`);
    console.error(found!.error);
    if (once) return 1;
    console.log("fix it and save the file; 'fishc learn hint' gives a hint\n");
    const seen = statSync(path).mtimeMs;
    while (statSync(path).mtimeMs === seen) await Bun.sleep(300);
    found = unsolved(dir, at);
    if (found === undefined || found!.at !== at) console.log(`exercise ${at + 1} compiles\n`);
  }
  console.log(done);
  return 0;
}

// `fishc client --types`: the `.d.ts` declarations of a file's exported types, printed or written
// to `out`.
/** @throws {IoError} */
function typesFile(file: string, out: string | undefined): never {
  let src = "";
  try {
    src = readFileSync(file, "utf8");
  } catch (e) {
    fail(`fishc client: can't read '${file}': ${(e as { message: string }).message}`);
  }
  try {
    const parsed = parseWithComments(src, { last: 0 });
    const text = typesOf(src, parsed.program, basename(file));
    if (out === undefined) process.stdout.write(text);
    else writeFileSync(out!, text);
  } catch (e) {
    if (!(e instanceof CompileError)) throw e;
    console.error(painted(e, file, src));
    process.exit(1);
  }
  return process.exit(0);
}

// `fishc doc`: the package's files, or the one named, as HTML pages and an index in `out`,
// `build/doc` by default. Gives the exit code.
/** @throws {IoError} */
function docSite(file: string | undefined, out: string | undefined): i64 {
  const manifest = findManifest(process.cwd());
  const root = manifest !== undefined ? dirname(manifest!) : process.cwd();
  let problems: string[] = [];
  const files = file !== undefined ? [resolve(file!)] : fishFiles(root, problems);
  for (const message of problems) console.error(message.replace(/^fishc fmt/, "fishc doc"));
  const dir = out ?? join(root, "build", "doc");
  mkdirSync(dir, { recursive: true });
  let modules: { file: string; items: Documented[] }[] = [];
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    const shown = relative(root, f);
    try {
      const parsed = parseWithComments(src, { last: 0 });
      const items = documented(src, parsed.program, parsed.comments);
      writeFileSync(join(dir, pageName(shown)), modulePage(shown, items));
      modules.push({ file: shown, items });
    } catch (e) {
      if (!(e instanceof CompileError)) throw e;
      console.error(painted(e, f, src));
      return 1;
    }
  }
  writeFileSync(join(dir, "index.html"), indexPage(basename(root), modules));
  const where = relative(process.cwd(), dir);
  console.log(`wrote ${modules.length} module page${modules.length === 1 ? "" : "s"} and an index to ${where === "" ? "." : where}`);
  return 0;
}

// `fishc build --addon`: the file's exports as a Node and Bun addon, `<name>.node` beside it unless
// `out` says where, with the `.d.ts` declaring them beside that. Gives the exit code.
/** @throws {IoError} */
function buildAddon(session: BuildSession, file: string, out: string | undefined, release: boolean, debug: boolean): i64 {
  const src = readFileSync(file, "utf8");
  const output = out ?? join(dirname(file), `${basename(file, ".fsh")}.node`);
  const dir = mkdtempSync(join(tmpdir(), "fishc-addon-"));
  const entry = join(dir, "addon.fsh");
  try {
    const from = relative(dir, resolve(file));
    const made = addonOf(src, from.startsWith(".") ? from : `./${from}`);
    writeFileSync(entry, made.fish);
    writeFileSync(join(dir, "glue.c"), made.glue);
    const warnings = buildLibrary(session, entry, resolve(output), "shared", release, "unwind", [], hostTarget(), debug, join(dir, "glue.c"));
    for (const w of warnings) console.error(painted(w, file, src, "warning"));
    writeFileSync(`${output.replace(/\.node$/, "")}.d.ts`, made.dts);
    return 0;
  } catch (e) {
    // An error in the generated entry is shown against it; every other names its own file.
    if (e instanceof CompileError) console.error(existsSync(entry) ? painted(e, entry, readFileSync(entry, "utf8")) : painted(e, file, src));
    else console.error((e as { message: string }).message);
    return 1;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// `fishc build --mobile ios|android|react-native`: the file's exports as a module an app calls, in
// `<name>-<platform>` beside it unless `out` says where. A panic aborts, since unwinding into Swift
// or JNI frames is undefined. Gives the exit code.
/** @throws {IoError} */
function buildMobile(fresh: () => BuildSession, file: string, platform: string, out: string | undefined, release: boolean, debug: boolean, sysroot: string | undefined): i64 {
  const src = readFileSync(file, "utf8");
  const name = basename(file, ".fsh");
  const output = resolve(out ?? join(dirname(file), `${name}-${platform}`));
  const dir = mkdtempSync(join(tmpdir(), "fishc-mobile-"));
  const entry = join(dir, "mobile.fsh");
  try {
    const from = relative(dir, resolve(file));
    const made = mobileOf(src, from.startsWith(".") ? from : `./${from}`, name);
    writeFileSync(entry, made.fish);
    mkdirSync(output, { recursive: true });
    const type = typeName(name);
    writeFileSync(join(output, `${type}.h`), made.header);
    let warnings: CompileError[] = [];
    if (platform === "ios") warnings = buildIos(fresh, entry, dir, output, made, release, debug);
    else if (platform === "android") warnings = buildAndroid(fresh, entry, dir, output, made, release, debug, sysroot);
    else {
      writeFileSync(join(output, `Native${type}.ts`), made.spec);
      writeFileSync(join(output, `Native${type}Module.h`), made.module);
    }
    for (const w of warnings) console.error(painted(w, file, src, "warning"));
    return 0;
  } catch (e) {
    if (e instanceof CompileError) console.error(existsSync(entry) ? painted(e, entry, readFileSync(entry, "utf8")) : painted(e, file, src));
    else console.error((e as { message: string }).message);
    return 1;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// The iOS SDK `sdk` names, iphoneos or iphonesimulator, as Xcode has it.
/** @throws {Error | IoError} */
function iosSdk(sdk: string): string {
  const missing = "fishc build: building for iOS needs Xcode with its iOS SDKs; install Xcode, then run 'sudo xcode-select -s /Applications/Xcode.app'";
  if (process.platform !== "darwin" || Bun.which("xcrun") === null) throw new Error(missing);
  const found = Bun.spawnSync(["xcrun", "--sdk", sdk, "--show-sdk-path"]);
  const path = new TextDecoder().decode(found.stdout).trim();
  if (found.exitCode !== 0 || path === "") throw new Error(missing);
  return path;
}

// A static library for the device and one for the simulator on both CPUs, joined as
// `<Name>.xcframework` with the header and a module map, and the Swift wrapper beside it.
/** @throws {CompileError | Error | IoError | JsonError} */
function buildIos(fresh: () => BuildSession, entry: string, dir: string, output: string, made: Ref<Mobile>, release: boolean, debug: boolean): CompileError[] {
  const type = typeName(made.name);
  const lib = `lib${made.name}.a`;
  const glue = join(dir, "glue.c");
  writeFileSync(glue, made.glue);
  const slices: [string, string, string][] = [["arm64-apple-ios13.0", "iphoneos", "device"], ["arm64-apple-ios13.0-simulator", "iphonesimulator", "sim-arm64"], ["x86_64-apple-ios13.0-simulator", "iphonesimulator", "sim-x86_64"]];
  let warnings: CompileError[] = [];
  for (const [triple, sdk, slice] of slices) {
    const root = iosSdk(sdk);
    mkdirSync(join(dir, slice));
    const target: Target = { triple, compile: ["-target", triple, "-isysroot", root, "-Wno-override-module"], link: [], ar: "ar" };
    warnings = buildLibrary(fresh(), entry, join(dir, slice, lib), "static", release, "abort", [], target, debug, glue);
  }
  mkdirSync(join(dir, "sim"));
  run(["lipo", "-create", join(dir, "sim-arm64", lib), join(dir, "sim-x86_64", lib), "-output", join(dir, "sim", lib)]);
  const headers = join(dir, "headers");
  mkdirSync(headers);
  writeFileSync(join(headers, `${type}.h`), made.header);
  writeFileSync(join(headers, "module.modulemap"), made.modulemap);
  const framework = join(output, `${type}.xcframework`);
  rmSync(framework, { recursive: true, force: true });
  run(["xcodebuild", "-create-xcframework", "-library", join(dir, "device", lib), "-headers", headers, "-library", join(dir, "sim", lib), "-headers", headers, "-output", framework]);
  writeFileSync(join(output, `${type}.swift`), made.swift);
  return warnings;
}

// Orders NDK versions like 27.1.12297006 by their numbers.
function newerNdk(a: string, b: string): i64 {
  const x = a.split(".").map((p) => Number(p));
  const y = b.split(".").map((p) => Number(p));
  for (let i = 0; i < x.length && i < y.length; i++) if (x[i]! !== y[i]!) return y[i]! > x[i]! ? 1 : -1;
  return (y.length as i64) - (x.length as i64);
}

// The NDK's clang: from `--sysroot`, ANDROID_NDK_HOME, or the newest NDK in the Android SDK.
/** @throws {Error | IoError} */
function ndkClang(given: string | undefined): string {
  const install = "install one with Android Studio's SDK Manager or 'sdkmanager \"ndk;<version>\"', or give its directory with --sysroot <dir> or ANDROID_NDK_HOME";
  let ndk = given ?? process.env.ANDROID_NDK_HOME ?? "";
  if (ndk === "") {
    const home = process.env.HOME ?? "";
    const sdk = process.env.ANDROID_HOME ?? (process.platform === "darwin" ? join(home, "Library", "Android", "sdk") : join(home, "Android", "Sdk"));
    let versions: string[] = existsSync(join(sdk, "ndk")) ? readdirSync(join(sdk, "ndk")).filter((v) => /^\d+(\.\d+)*$/.test(v)) : [];
    versions.sort(newerNdk);
    if (versions.length === 0) throw new Error(`fishc build: building for Android needs the Android NDK, and ${join(sdk, "ndk")} has none; ${install}`);
    ndk = join(sdk, "ndk", versions[0]!);
  }
  const host = process.platform === "darwin" ? "darwin-x86_64" : "linux-x86_64";
  const clang = join(resolve(ndk), "toolchains", "llvm", "prebuilt", host, "bin", "clang");
  if (!existsSync(clang)) throw new Error(`fishc build: ${resolve(ndk)} isn't an Android NDK for this machine: it has no ${clang}; ${install}`);
  return clang;
}

// A shared library per ABI under `jniLibs`, built by the NDK's clang for API 28 with the JNI glue,
// and the Kotlin wrapper beside them. Bionic has getentropy and posix_spawn, which the runtime
// calls, from API 28.
/** @throws {CompileError | Error | IoError | JsonError} */
function buildAndroid(fresh: () => BuildSession, entry: string, dir: string, output: string, made: Ref<Mobile>, release: boolean, debug: boolean, sysroot: string | undefined): CompileError[] {
  const clang = ndkClang(sysroot);
  const glue = join(dir, "jni.c");
  writeFileSync(glue, made.jni);
  const abis: [string, string, string[]][] = [["aarch64-linux-android28", "arm64-v8a", ["-fno-global-isel"]], ["x86_64-linux-android28", "x86_64", []]];
  let warnings: CompileError[] = [];
  for (const [triple, abi, extra] of abis) {
    const at = join(output, "jniLibs", abi);
    mkdirSync(at, { recursive: true });
    let session = fresh();
    session.cc = clang;
    const target: Target = { triple, compile: ["-target", triple, "-Wno-override-module", ...extra], link: [], ar: "ar", cc: clang };
    warnings = buildLibrary(session, entry, join(at, `lib${made.name}.so`), "shared", release, "abort", [], target, debug, glue);
  }
  writeFileSync(join(output, `${typeName(made.name)}.kt`), made.kotlin);
  return warnings;
}

// Runs `binary` with `args` on this process's standard streams, giving its exit code, or 128 plus
// the signal's number when a signal ended it, as a shell reports it.
/** @throws {IoError} */
function ranProgram(binary: string, args: Ref<string[]>): i64 {
  const ran = Bun.spawnSync([binary, ...args], { stdin: "inherit", stdout: "inherit", stderr: "inherit" });
  const signal = ran.signalCode;
  const found = signal === null ? undefined : Object.entries(constants.signals).find(([name]) => name === signal);
  return ran.exitCode ?? 128 + (found === undefined ? 0 : found[1]);
}

// `fishc script.fsh args...`: the cached binary when the script, what it imports and fishc are all
// as they were when it was built, else a fresh build kept for the next run.
/** @throws {IoError} */
function runScript(script: string, args: Ref<string[]>): i64 {
  let binary = cachedScript(script);
  if (binary === undefined) {
    let temp = "";
    try {
      temp = scriptBuildPath(script);
      let looked: string[] = [];
      const made = built(sessionWith(false, false, false), script, temp, false, "unwind", [], hostTarget(), false, false, looked);
      for (const w of made.warnings) console.error(painted(w, script, readFileSync(script, "utf8"), "warning"));
      binary = keepScript(script, temp, looked);
    } catch (e) {
      if (e instanceof CompileError) console.error(painted(e, script, readFileSync(script, "utf8")));
      else console.error((e as { message: string }).message);
      if (temp !== "") rmSync(temp, { force: true });
      return 1;
    }
  }
  return ranProgram(binary!, args);
}

/** @throws {Error | IoError | JsonError} */
async function main(): Promise<void> {
  if (Bun.argv.length === 3 && Bun.argv[2] === "lsp") {
    await serveLsp();
    return;
  }
  // `fishc script.fsh args...`, as a `#!/usr/bin/env fishc` line runs it: every argument after the
  // file is the script's, so none of them is read as fishc's own flag.
  if (Bun.argv.length > 2 && Bun.argv[2]!.endsWith(".fsh") && existsSync(Bun.argv[2]!)) process.exit(runScript(Bun.argv[2]!, Bun.argv.slice(3)));
  if (Bun.argv.length === 2) fail(overview());
  // Help and the version are looked for only before `--`, since what follows is the program's.
  let own: string[] = [];
  for (const a of Bun.argv.slice(2)) {
    if (a === "--") break;
    own.push(a);
  }
  if (own.length === 1 && (own[0]! === "--version" || own[0]! === "-V")) {
    console.log(`fishc ${VERSION}`);
    process.exit(0);
  }
  if (own.length > 0 && (own[0]! === "help" || own.some((a) => a === "--help" || a === "-h"))) {
    // `fishc help --help` asks about help itself; `fishc --help` and `fishc help` for the list.
    let name: string | undefined = undefined;
    if (own[0]! !== "help") {
      if (!own[0]!.startsWith("-")) name = own[0];
    } else if (own.length > 1) name = own[1]!.startsWith("-") ? "help" : own[1];
    if (name === undefined) console.log(overview());
    else console.log(helpOf(name!) ?? fail(`fishc help: '${name!}' isn't a command; run 'fishc help' for the list`));
    process.exit(0);
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
          addon: { type: "boolean" },
          mobile: { type: "string" },
          types: { type: "boolean" },
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
          registry: { type: "string" },
          yes: { type: "boolean" },
          check: { type: "boolean" },
          fix: { type: "boolean" },
          leaks: { type: "boolean" },
          profile: { type: "boolean" },
          "heap-profile": { type: "boolean" },
          debug: { type: "boolean", short: "g" },
          timings: { type: "boolean" },
          "no-check-cache": { type: "boolean" },
          sanitize: { type: "string", multiple: true },
          "pgo-instrument": { type: "boolean" },
          pgo: { type: "string", multiple: true },
          timeout: { type: "string" },
          jobs: { type: "string" },
          fn: { type: "string" },
          runs: { type: "string" },
          "max-time": { type: "string" },
          corpus: { type: "string" },
          artifacts: { type: "string" },
          replay: { type: "string" },
          "no-asan": { type: "boolean" },
          list: { type: "boolean" },
          sim: { type: "boolean" },
          seed: { type: "string" },
          seeds: { type: "string" },
          "no-doc": { type: "boolean" },
          flag: { type: "string", multiple: true },
        },
      });
    } catch (e) {
      return fail(`fishc: ${(e as { message: string }).message}`);
    }
  })();
  // The options given, as Node's parseArgs keys them: those on the command line and `panic`'s default.
  // --registry applies to whatever reads the registry, so no command's own flags list it.
  let flags: string[] = [];
  for (const [k, v] of Object.entries(values)) if (v !== undefined && k !== "registry") flags.push(k);
  if (values.registry !== undefined) useRegistry(values.registry);
  const links: string[] = values.link === undefined ? [] : [...values.link];
  // Each build compiles within a session of its own, since a check uses up the one it is given.
  const locked = values.locked === true;
  const timed = values.timings === true;
  const checking = values["no-check-cache"] === true;
  const buildFlags = buildFlagsOf(values.flag === undefined ? [] : [...values.flag]);
  const sessionFor = (): BuildSession => sessionWith(locked, timed, checking, flagsCopy(buildFlags));
  // `fishc run` and `fishc watch` take the program's arguments after the file, or all of them with no file.
  const command = positionals.length > 0 ? positionals[0] : undefined;
  const named = positionals.length > 1 ? positionals[1] : undefined;
  const file = (command === "run" || command === "watch") && named !== undefined && !named.endsWith(".fsh") ? undefined : named;
  const programArgs = positionals.slice(file === undefined ? 1 : 2);
  if (command === "repl") {
    if (positionals.length !== 1 || flags.some((k) => k !== "panic")) fail(usageOf("repl"));
    runRepl(locked, timed, checking);
  }
  // Parses a file without checking it, for test programs that only have to parse.
  if (command === "parse") {
    if (positionals.length !== 2 || flags.some((k) => k !== "panic")) fail(usageOf("parse"));
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
    if (positionals.length !== 2 || flags.some((k) => k !== "panic")) fail(usageOf("explain"));
    const text = explain(named!);
    if (text === undefined) fail(`fishc explain: '${named ?? ""}' isn't an error code; a code looks like E0201 or W0001, as an error shows it`);
    console.log(text);
    process.exit(0);
  }
  if (command === "explain-borrows") {
    if (positionals.length !== 2 || flags.some((k) => k !== "panic" && k !== "fn")) fail(usageOf("explain-borrows"));
    explainFile(named!, values.fn);
  }
  if (command === "learn") {
    const sub = positionals.length > 1 ? positionals[1] : undefined;
    if (positionals.length > 2 || (sub !== undefined && sub !== "hint") || flags.some((k) => k !== "panic" && k !== "check")) fail(usageOf("learn"));
    const code = await learn(sub === "hint", values.check === true);
    process.exit(code);
  }
  if (command === "client") {
    if (positionals.length !== 2 || flags.some((k) => k !== "panic" && k !== "out" && k !== "types")) fail(usageOf("client"));
    if (values.types === true) typesFile(named!, values.out);
    openapiFile(named!, values.out, true);
  }
  if (command === "doc") {
    if (positionals.length > 2 || flags.some((k) => k !== "panic" && k !== "out")) fail(usageOf("doc"));
    process.exit(docSite(file, values.out));
  }
  if (command === "openapi") {
    if (positionals.length !== 2 || flags.some((k) => k !== "panic" && k !== "out")) fail(usageOf("openapi"));
    openapiFile(named!, values.out);
  }
  if (command === "heap") {
    if (positionals.length !== 4 || positionals[1] !== "diff" || flags.some((k) => k !== "panic")) fail(usageOf("heap"));
    try {
      for (const line of heapDiffFiles(positionals[2]!, positionals[3]!)) console.log(line);
    } catch (e) {
      fail(`fishc heap diff: ${e.message}`);
    }
    process.exit(0);
  }
  if (command === "bind") {
    if (positionals.length < 3 || positionals[1] !== "c" || flags.some((k) => k !== "panic" && k !== "out")) fail(usageOf("bind"));
    bindFile(positionals[2]!, values.out, positionals.slice(3));
  }
  if (command === "survey") {
    const dirs = positionals.slice(1);
    const usage = usageOf("survey");
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
    const usage = usageOf("fmt");
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
    if (flags.some((k) => k !== "panic" && k !== "fix") || values.panic !== "unwind") fail(usageOf("lint"));
    if (paths.length === 0) {
      const found = findManifest(process.cwd()) ?? fail(`fishc lint: no ${MANIFEST} here or in any directory above; name the files to lint, or run it inside a package`);
      paths.push(dirname(found!));
    }
    process.exit(lintPaths(paths, values.fix === true));
  }
  if (command === "fix") {
    const usage = usageOf("fix");
    const allowed = new Set(["panic", "dry-run", "check"]);
    if (positionals.length > 2 || flags.some((k) => !allowed.has(k)) || values.panic !== "unwind") fail(usage);
    const dryRun = values["dry-run"] === true;
    const checkOnly = values.check === true;
    let entry = file;
    let manifest: string | undefined = undefined;
    let projectRoot = "";
    if (entry !== undefined) {
      if (!existsSync(entry!) || !statSync(entry!).isFile()) fail(`fishc fix: can't find file '${entry!}'`);
      const found = findManifest(dirname(resolve(entry!)));
      manifest = found;
      projectRoot = found !== undefined ? dirname(found!) : dirname(resolve(entry!));
    } else {
      const found = findManifest(process.cwd()) ?? fail(`fishc fix: no ${MANIFEST} here or in any directory above; give a .fsh file or run inside a package`);
      try {
        const pkg = loadManifest(found!, "entry");
        manifest = found;
        projectRoot = pkg.dir;
        entry = join(pkg.dir, pkg.entry);
      } catch (e) {
        if (e instanceof CompileError) {
          console.error(painted(e, relative(process.cwd(), found!), readFileSync(found!, "utf8")));
          process.exit(1);
        }
        fail(`fishc fix: ${(e as { message: string }).message}`);
      }
    }
    try {
      const report = fixProgram(entry!, manifest, projectRoot);
      const cwd = process.cwd();
      let writeFailed = false;
      let failedPaths = new Set<string>();
      if (!dryRun && !checkOnly) {
        for (const [path, text] of report.edited) {
          const orig = report.originals.get(path) ?? "";
          const failed = rewrite(path, text, Buffer.from(orig));
          if (failed !== undefined) {
            console.error(`fishc fix: can't write '${displayFixPath(path, cwd)}': ${failed}`);
            writeFailed = true;
            failedPaths.add(path);
          }
        }
      }
      let reportedCount: usize = 0;
      for (const a of report.applied) {
        if (failedPaths.has(a.file)) continue;
        const verb = dryRun || checkOnly ? "would fix" : "fixed";
        console.log(`${verb} [${a.kind}] ${displayFixPath(a.file, cwd)}:${a.line}: ${a.message}`);
        reportedCount++;
      }
      const entryText = report.edited.get(realpathSync(resolve(entry!))) ?? report.originals.get(realpathSync(resolve(entry!))) ?? "";
      for (const rem of report.remaining) {
        console.error(painted(rem, displayFixPath(realpathSync(resolve(entry!)), cwd), entryText));
      }
      const count = dryRun || checkOnly ? report.applied.length : reportedCount;
      const fileCount = dryRun || checkOnly ? report.edited.size : report.edited.size - failedPaths.size;
      if (count === 0 && report.remaining.length === 0 && !writeFailed) {
        console.log("nothing to fix");
      } else {
        const prefix = dryRun || checkOnly ? "would apply" : "applied";
        const suffix = report.remaining.length > 0 ? `, ${report.remaining.length} error${report.remaining.length === 1 ? "" : "s"} remaining` : "";
        console.log(`${prefix} ${count} fix${count === 1 ? "" : "es"} in ${fileCount} file${fileCount === 1 ? "" : "s"}${suffix}`);
      }
      if (writeFailed || report.remaining.length > 0 || (checkOnly && count > 0)) process.exit(1);
      process.exit(0);
    } catch (e) {
      console.error(`fishc fix: ${(e as { message: string }).message}`);
      process.exit(1);
    }
  }
  if (command === "test") {
    // Tests are built to unwind, so `--panic=abort` is refused rather than ignored.
    const usage = usageOf("test");
    if (positionals.length > 2 || flags.some((k) => k !== "panic" && k !== "release" && k !== "timeout" && k !== "jobs" && k !== "sim" && k !== "seed" && k !== "seeds" && k !== "no-doc" && k !== "flag") || values.panic !== "unwind") fail(usage);
    let options = runDefaults();
    if (values["no-doc"] === true) options.docs = false;
    if (values.timeout !== undefined) options.timeout = wholeNumber(values.timeout) ?? fail(`fishc test: --timeout takes a whole number of milliseconds above 0, not '${values.timeout}'`);
    if (values.jobs !== undefined) options.jobs = wholeNumber(values.jobs) ?? fail(`fishc test: --jobs takes a whole number of tests above 0, not '${values.jobs}'`);
    if (values.sim === true) {
      options.sim = true;
      if (values.seed !== undefined) options.seed = parseSimSeed(values.seed) ?? fail(`fishc test: --seed takes an unsigned 64-bit integer, not '${values.seed}'`);
      if (values.seeds !== undefined) options.seeds = wholeNumber(values.seeds) ?? fail(`fishc test: --seeds takes a whole number above 0, not '${values.seeds}'`);
      const u64Max: u64 = (1844674407370955161 as u64) * (10 as u64) + (5 as u64);
      if (u64Max - options.seed < ((options.seeds - 1) as u64)) fail("fishc test: --seed + --seeds overflows unsigned 64-bit range");
    } else if (values.seeds !== undefined) {
      fail("fishc test: --seeds requires --sim");
    } else if (values.seed !== undefined) {
      // Without --sim, the seed is the one every property draws its inputs from.
      options.propSeed = parseSimSeed(values.seed) ?? fail(`fishc test: --seed takes an unsigned 64-bit integer, not '${values.seed}'`);
    }
    const found = findManifest(process.cwd()) ?? fail(`fishc test: no ${MANIFEST} here or in any directory above; tests run inside a package`);
    const code = await testPackage(sessionFor(), dirname(found!), file, values.release === true, options);
    process.exit(code);
  }
  if (command === "fuzz") {
    const usage = usageOf("fuzz");
    const allowed = new Set(["panic", "runs", "max-time", "corpus", "artifacts", "replay", "no-asan", "list"]);
    if (positionals.length > 3 || flags.some((k) => !allowed.has(k)) || values.panic !== "unwind") fail(usage);
    let options: FuzzOptions = { asan: values["no-asan"] !== true, list: values.list === true };
    if (values.runs !== undefined) options.runs = wholeNumber(values.runs) ?? fail(`fishc fuzz: --runs takes a whole number above 0, not '${values.runs}'`);
    const maxTime = values["max-time"];
    if (maxTime !== undefined) options.maxTime = wholeNumber(maxTime) ?? fail(`fishc fuzz: --max-time takes a whole number of seconds above 0, not '${maxTime}'`);
    if (values.corpus !== undefined) options.corpus = values.corpus;
    if (values.artifacts !== undefined) options.artifacts = values.artifacts;
    if (values.replay !== undefined) {
      if (!existsSync(values.replay) || !statSync(values.replay).isFile()) fail(`fishc fuzz: replay file '${values.replay}' doesn't exist or isn't a regular file`);
      options.replay = values.replay;
    }
    const first = positionals.length > 1 ? positionals[1] : undefined;
    const second = positionals.length > 2 ? positionals[2] : undefined;
    const isFile = first !== undefined && first.endsWith(".fsh");
    if (!isFile && second !== undefined) fail(usage);
    let dir = "";
    let files: string[] = [];
    let filter: string | undefined = undefined;
    if (isFile) {
      if (!existsSync(first!) || !statSync(first!).isFile()) fail(`fishc fuzz: can't find file '${first!}'`);
      const full = resolve(first!);
      dir = dirname(full);
      files = [full];
      filter = second;
    } else {
      const found = findManifest(process.cwd()) ?? fail(`fishc fuzz: no ${MANIFEST} here or in any directory above; give a .fsh file or run inside a package`);
      dir = dirname(found!);
      let problems: string[] = [];
      files = fishFiles(dir, problems);
      for (const message of problems) console.error(message.replace(/^fishc fmt/, "fishc fuzz"));
      filter = first;
    }
    try {
      const code = await runFuzz(sessionFor(), dir, files, filter, isFile, isFile ? first : undefined, options);
      process.exit(code);
    } catch (e) {
      console.error((e as { message: string }).message);
      process.exit(1);
    }
  }
  if (command === "publish") {
    const usage = usageOf("publish");
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
      if (values["dry-run"] !== true && sparseBase(registryUrl(packed.manifest)) !== undefined) {
        if (submitting) fail("fishc publish: --submit opens a pull request against a git index; a registry server takes the release itself");
        console.log(`published ${packed.manifest.name} ${packed.manifest.version} to ${upload(packed)}`);
      } else if (values["dry-run"] !== true) {
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
    const usage = usageOf(command!);
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
    const usage = usageOf(command!);
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
  if (values.profile === true && values["heap-profile"] === true) fail(`fishc ${command ?? ""}: '--profile' and '--heap-profile' each instrument the program on their own; build with one of them`);
  if (values.leaks === true && values["heap-profile"] === true) fail(`fishc ${command ?? ""}: '--leaks' and '--heap-profile' each keep a header on every block; build with one of them`);
  const profile: Profiling = values.profile === true ? true : values["heap-profile"] === true ? "heap" : false;
  if ((values["pgo-instrument"] === true || values.pgo !== undefined) && command !== "build") fail(`fishc ${command ?? ""}: profile-guided optimization is a build's; build with 'fishc build --pgo-instrument', run the binary it writes, then 'fishc build --release --pgo default.profraw'`);
  if (values.sanitize !== undefined && command !== "build") fail(`fishc ${command ?? ""}: '--sanitize' instruments a build; build with 'fishc build --sanitize address|thread', then run the binary it writes`);
  let target = file;
  let out = values.out;
  // With no file, the package around the working directory is built, as cargo builds one.
  if ((command === "build" || command === "check" || command === "run" || command === "watch" || command === "dev") && file === undefined && lib === undefined) {
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
  const fuzzFlag = values.runs !== undefined || values["max-time"] !== undefined || values.corpus !== undefined || values.artifacts !== undefined || values.replay !== undefined || values["no-asan"] === true || values.list === true || values.sim === true || values.seed !== undefined || values.seeds !== undefined;
  if (command === "check" && target !== undefined && values.out === undefined && !release && !llvm && profile === false && !fuzzFlag && lib === undefined) {
    try {
      const start = performance.now();
      const made = checkedFile(sessionFor(), target);
      reportTimings(made.session, FRONT_END, start);
      for (const w of made.warnings) console.error(painted(w, target, readFileSync(target, "utf8"), "warning"));
    } catch (e) {
      if (e instanceof CompileError) console.error(painted(e, target, readFileSync(target, "utf8")));
      else console.error((e as { message: string }).message);
      process.exit(1);
    }
    process.exit(0);
  }
  if (command === "run" && target !== undefined && values.out === undefined && !llvm && !fuzzFlag && lib === undefined) {
    // A lone file's program is built where nothing else looks, and removed once it has run.
    const scratch = out === undefined ? mkdtempSync(join(tmpdir(), "fishc-run-")) : undefined;
    const binary = out ?? join(scratch!, basename(target, ".fsh"));
    let code = 1;
    try {
      const start = performance.now();
      let looked: string[] = [];
      const made = built(sessionFor(), target, binary, release, panic, [...links], hostTarget(), leaks, values.debug === true, looked, profile);
      reportTimings(made.session, [...FRONT_END, "codegen", ...NATIVE_STAGES], start);
      for (const w of made.warnings) console.error(painted(w, target, readFileSync(target, "utf8"), "warning"));
      code = ranProgram(binary, programArgs);
    } catch (e) {
      if (e instanceof CompileError) console.error(painted(e, target, readFileSync(target, "utf8")));
      else console.error((e as { message: string }).message);
    } finally {
      if (scratch !== undefined) rmSync(scratch, { recursive: true, force: true });
    }
    process.exit(code);
  }
  if (command === "watch" && target !== undefined && values.out === undefined && !llvm && !fuzzFlag && lib === undefined) {
    const entry = target;
    const scratch = out === undefined ? mkdtempSync(join(tmpdir(), "fishc-watch-")) : undefined;
    const binary = out ?? join(scratch!, basename(entry, ".fsh"));
    // What each build takes, the callback's own, since it may run on another thread.
    const manifest = findManifest(dirname(resolve(entry)));
    const rebuild: Rebuild = { entry: `${entry}`, binary: `${binary}`, links: [...links], release, panic, leaks, profile, debug: values.debug === true, locked, timed, manifest, flags: flagsCopy(buildFlags) };
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
  if (command === "dev") {
    if (target === undefined || positionals.length > 2 || flags.some((k) => k !== "panic" && k !== "locked") || values.panic !== "unwind") fail(usageOf("dev"));
    const entry = target!;
    const scratch = mkdtempSync(join(tmpdir(), "fishc-dev-"));
    const hostFile = join(scratch, "host.fsh");
    writeFileSync(hostFile, hostSource(join(scratch, "current")));
    // What each callback takes, its own copy, since a closure owns what it captures.
    const forHost: DevBuild = { file: hostFile, out: join(scratch, "host"), locked };
    const forHandlers: DevBuild = { file: `${entry}`, out: "", locked };
    const removing = `${scratch}`;
    await develop({
      entry,
      dir: scratch,
      manifest: findManifest(dirname(resolve(entry))),
      host: () => devHost(forHost),
      handlers: (out) => devHandlers(forHandlers, out),
      done: () => {
        try {
          rmSync(removing, { recursive: true, force: true });
        } catch (_e) {
          // The scratch directory is the system's temporary one, which it clears in time.
        }
      },
    });
  }
  if (command === "build" && values.mobile !== undefined) {
    const platform = values.mobile!;
    if (file === undefined || (platform !== "ios" && platform !== "android" && platform !== "react-native") || values.addon === true || lib !== undefined || llvm || values.static === true || values.target !== undefined || values.sanitize !== undefined || values["pgo-instrument"] === true || values.pgo !== undefined || leaks || profile !== false || links.length > 0 || (values.sysroot !== undefined && platform !== "android")) fail(usageOf("build"));
    process.exit(buildMobile(sessionFor, file!, platform, values.out, release, values.debug === true, values.sysroot));
  }
  if (command === "build" && values.addon === true) {
    if (file === undefined || lib !== undefined || llvm || values.static === true || values.target !== undefined || values.sanitize !== undefined || values["pgo-instrument"] === true || values.pgo !== undefined || leaks || profile !== false || links.length > 0) fail(usageOf("build"));
    process.exit(buildAddon(sessionFor(), file!, values.out, release, values.debug === true));
  }
  if (command !== "build" || target === undefined || values.fix === true || values.json === true || values.rank === true || values.self !== undefined || values.plan !== undefined || values.compare !== undefined || fuzzFlag || (panicName !== "unwind" && panicName !== "abort") || links.some((l) => l.trim() === "") || (libName !== undefined && libName !== "static" && libName !== "shared")) {
    if (command !== undefined && command!.endsWith(".fsh")) fail(`fishc: can't find '${command!}'`);
    if (command !== undefined && commandNamed(command!) === undefined) fail(`fishc: '${command!}' isn't a command; run 'fishc help' for the list`);
    fail(command === undefined ? overview() : usageOf(command!));
  }
  // A library keeps no frames to name sites with, and its host's exit isn't the library's to report.
  if (values.timings === true && lib !== undefined) fail("fishc build: '--timings' times an executable's build; leave out '--lib' to time the program it would be built from");
  if (leaks && lib !== undefined) fail("fishc build: '--leaks' can't build a library; build the program that uses it with '--leaks' instead");
  if (profile !== false && lib !== undefined) {
    const flag = profile === "heap" ? "--heap-profile" : "--profile";
    fail(`fishc build: '${flag}' can't build a library; build the program that uses it with '${flag}' instead`);
  }
  if (values.static === true && lib !== undefined) fail("fishc build: '--static' builds an executable, not a library; leave out '--lib', or '--static'");
  if ((values.static === true || values.dockerfile === true) && llvm) fail("fishc build: '--emit-llvm' prints the IR without linking it, so '--static' and '--dockerfile' don't apply; leave them out");
  const sanitize = values.sanitize === undefined ? undefined : values.sanitize.flatMap((s) => s.split(","));
  if (sanitize !== undefined && lib !== undefined) fail("fishc build: '--sanitize' can't build a library; build the program that uses it with '--sanitize' instead");
  if (sanitize !== undefined && llvm) fail("fishc build: '--emit-llvm' prints the IR before clang instruments it, so '--sanitize' doesn't apply; leave it out");
  // An instrumented build is a release build, so its profile matches the release build that uses it.
  const instrumenting = values["pgo-instrument"] === true;
  const none: string[] = [];
  const profiles = values.pgo === undefined ? none : values.pgo.map((p) => p);
  const pgo = instrumenting ? "--pgo-instrument" : "--pgo";
  if (instrumenting && profiles.length > 0) fail("fishc build: '--pgo-instrument' writes the binary a profile is taken from, and '--pgo' builds with one; build with one of them");
  if (profiles.length > 0 && !release) fail("fishc build: '--pgo' optimizes a release build; add '--release'");
  if ((instrumenting || profiles.length > 0) && (llvm || lib !== undefined || sanitize !== undefined)) fail(`fishc build: '${pgo}' applies to an executable clang builds, so it doesn't go with '--emit-llvm', '--lib' or '--sanitize'`);
  if (values.dockerfile === true && values.static !== true) fail("fishc build: '--dockerfile' writes an image holding only the binary, which needs it built with '--static'");
  const wasm = values.target !== undefined && isWasm(values.target);
  if (wasm) {
    const what = `fishc build: a ${values.target ?? ""} build is a WebAssembly module`;
    if (lib !== undefined) fail(`${what} a WASI runtime starts, not a library; leave out '--lib'`);
    if (values.static === true) fail(`${what}, which holds everything it links already; leave out '--static'`);
    if (sanitize !== undefined) fail(`${what}, and clang has no sanitizer runtimes for wasm32; leave out '--sanitize'`);
    if (instrumenting || profiles.length > 0) fail(`${what}, and clang has no profile runtime for wasm32; leave out '${pgo}'`);
    if (profile !== false) fail(`${what}, and WASI has no signals to sample or report a profile with; leave out '${profile === "heap" ? "--heap-profile" : "--profile"}'`);
    // --panic defaults to unwind, so only one written out is refused.
    if (panicName === "unwind" && Bun.argv.some((a) => a === "--panic" || a.startsWith("--panic="))) fail(`${what}, which can't unwind, so a panic in it prints its message and exits with 101; leave out '--panic=unwind'`);
  }
  if (values.target !== undefined && isWindows(values.target)) {
    const what = `fishc build: a ${values.target} build`;
    if (lib !== undefined) fail(`${what} is an executable; libraries for Windows aren't built yet, so leave out '--lib'`);
    if (values.static === true) fail(`${what} links its C runtime and threads into the executable already; leave out '--static'`);
    if (sanitize !== undefined) fail(`${what} has no sanitizer runtime in llvm-mingw; leave out '--sanitize'`);
    if (profile !== false) fail(`${what} has no signals to sample or report a profile with; leave out '${profile === "heap" ? "--heap-profile" : "--profile"}'`);
  }
  // A module never unwinds: WASI preview 1 has no exceptions to unwind with.
  const panicking: Panic = wasm ? "abort" : panic;
  try {
    if (llvm) {
      const start = performance.now();
      let looked: string[] = [];
      const made = compiledIn(newCompilation(plain(sessionFor())), readFileSync(target!, "utf8"), target!, release, panicking, lib !== undefined, leaks, values.debug === true, looked, profile);
      reportTimings(made.checked.tables.session, [...FRONT_END, "codegen"], start);
      process.stdout.write(made.ir);
    } else {
      // FISH_SYSROOT is for building for another target, never the host's own plain builds.
      const fromEnv = process.env.FISH_SYSROOT ?? "";
      const sysroot = values.sysroot ?? (values.target !== undefined && values.target !== hostTriple() && fromEnv !== "" ? fromEnv : undefined);
      const resolved = resolveTarget(values.target, sysroot);
      const base = values.static === true ? staticTarget(resolved) : resolved;
      const sanitized = sanitize !== undefined;
      const sanitizing = sanitize !== undefined ? sanitizedTarget(base, sanitize) : base;
      const platform = instrumenting ? withFlags(sanitizing, [...PGO_INSTRUMENT]) : profiles.length > 0 ? withFlags(sanitizing, pgoUse(profiles)) : sanitizing;
      // A sanitizer's report names .fsh lines only when the program carries line tables.
      const debug = values.debug === true || sanitized;
      const lambda = isLambda(platform.triple);
      const named = out ?? `${basename(target!, ".fsh")}${wasm ? (values.target === "browser" || values.target === "edge" ? ".js" : ".wasm") : isWindows(platform.triple) ? ".exe" : lambda ? ".zip" : ""}`;
      const page = values.target === "browser" || values.target === "edge" ? browserFiles(named) : undefined;
      // A Lambda function's executable is built as bootstrap, then zipped where the build was asked to write.
      const scratch = lambda ? mkdtempSync(join(tmpdir(), "fishc-lambda-")) : undefined;
      const binary = page !== undefined ? page.module : scratch !== undefined ? join(scratch, "bootstrap") : named;
      const image = values.dockerfile === true ? dockerfilePath(binary) : undefined;
      try {
        let warnings: CompileError[] = [];
        if (lib !== undefined) warnings = buildLibrary(sessionFor(), target!, binary, lib, release, panic, [...links], copyTarget(platform), debug);
        else {
          const start = performance.now();
          let looked: string[] = [];
          let session = sessionFor();
          if (platform.cc !== undefined) session.cc = platform.cc;
          const made = built(session, target!, binary, release || instrumenting, panicking, [...links], copyTarget(platform), leaks, debug, looked, profile);
          reportTimings(made.session, [...FRONT_END, "codegen", ...NATIVE_STAGES], start);
          warnings = made.warnings;
        }
        if (page !== undefined) writeFileSync(page.loader, loader(basename(page.module), values.target === "edge"));
        if (scratch !== undefined) {
          writeFileSync(named, zipped("bootstrap", readFileSync(binary)));
          rmSync(scratch, { recursive: true, force: true });
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
