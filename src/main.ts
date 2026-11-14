#!/usr/bin/env bun
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { constants, tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import { bodyOf, type Arenas } from "./arenas.ts";
import { C_KEYWORDS, check } from "./check.ts";
import { codegenChecked, compiledOf, symbolIn, symbolNames, type Options } from "./codegen.ts";
import { formatTimings, FRONT_END, NATIVE_STAGES, newCompilation, newSession, newTimings, objectsNote, stageEnd, stageStart, type Compilation, type Session, type Tables } from "./compilation.ts";
import { expanded, sourced } from "./analysis.ts";
import { cachedSession } from "./stdcache.ts";
import { CompileError, copyNames, formatError, type Source } from "./diag.ts";
import { load, type Loaded, type RustCrate } from "./modules.ts";
import { resolvePackages } from "./dependencies.ts";
import { pack, prepare, submit, unsafeDependencies } from "./publish.ts";
import { openIndex, registryUrl } from "./registry_index.ts";
import { formatVersion, parseRange, maxSatisfying } from "./semver.ts";
import { createPackage, type Edition, fieldError, findManifest, loadManifest, MANIFEST, NAME_RULE, readManifest, vacant, validName, withDependency } from "./manifest.ts";
import { parse, parseWithComments, type Stmt } from "./parser.ts";
import { bundle } from "./bundle.ts";
import { JS_NATIVE } from "./js_native.ts";
import { NATIVE, TLS_NATIVE, tlsStub, ZLIB_NATIVE } from "./native.ts";
import { cachedObject, files, MATH_RUNTIME, mathObjects, mathObjectsAsync, objectAsync, objectPath, type BuildSession, type Unit } from "./mathlib.ts";
import { RUNTIME } from "./runtime.ts";
import { copyTarget, dockerfile, dockerfilePath, findOpenSsl, hostTarget, hostTriple, instrumented, resolveTarget, sanitizedTarget, staticTarget, type Target } from "./target.ts";
import { fishFiles, formatPaths, formatStdin, rewrite } from "./fmt.ts";
import { serveLsp } from "./lsp.ts";
import { directive, fix, migrations, REJECTS, type Imported } from "./migrate.ts";
import { hideMains, harnessImports, harnessMain, liftTests, runTests, stopTests, type Test } from "./tests.ts";
import { formatRanking, rank, readPlan, type Plan } from "./rank.ts";
import { compare, formatComparison, formatReport, readReport, sources, survey, type Report as SurveyReport } from "./survey.ts";
import { explain } from "./codes.ts";
import type { Checked, Instance } from "./check.ts";
import type { Type, Typing } from "./typing.ts";
import { rustShim, type Shim } from "./rustshim.ts";
import { split } from "./split.ts";
import { withDebugInfo } from "./debuginfo.ts";
import { watchProgram } from "./watch.ts";
import { STD_BASE } from "./std.ts";

export type Panic = "unwind" | "abort";

// `formatError` for stderr, painted on a terminal unless NO_COLOR is set, or whenever FORCE_COLOR is.
function painted(e: CompileError, path: string, program: string, kind = "error"): string {
  const forced = process.env.FORCE_COLOR;
  const colour = forced !== undefined && forced !== "0" ? true : process.stderr.isTTY === true && (process.env.NO_COLOR ?? "") === "";
  return formatError(e, path, program, kind, colour);
}
// A library C can call: an archive to link, or a shared library to load.
export type Library = "static" | "shared";

export { analyze } from "./analysis.ts";

// What compiling a program gives: its IR, the checked program, and the Rust crates its calls go to.
type Compiled = { ir: string; checked: Checked; rust: RustCrate[] };

// A build session apart: what a compilation takes, and the caches only building objects reads.
type Caches = { clang?: string; digests: Map<string, string>; mathUnits?: Unit[] };

function apart(session: BuildSession): { core: Session; caches: Caches } {
  return { core: { locking: session.locking, engineHook: session.engineHook, std: session.std, timings: session.timings, failed: session.failed }, caches: { clang: session.clang, digests: session.digests, mathUnits: session.mathUnits } };
}

function together(core: Session, caches: Caches): BuildSession {
  return { locking: core.locking, engineHook: core.engineHook, std: core.std, timings: core.timings, failed: core.failed, clang: caches.clang, digests: caches.digests, mathUnits: caches.mathUnits };
}

// Compiles the program whose entry is `file`, with text `src`, and every file it imports.
/** @throws {CompileError | Error | IoError | JsonError} */
export function compile(session: Session, src: string, file: string, release = false, panic: Panic = "unwind", library = false, leaks = false, debug = false): string {
  return compiledIn(newCompilation(session), src, file, release, panic, library, leaks, debug).ir;
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
  const { checked } = checkedSource(newCompilation(session), file, readFileSync(file, "utf8"), false);
  return { warnings: checked.warnings, session: checked.tables.session };
}

// The program whose entry is `file`, with text `src`, loaded and checked, with each warning given
// its files. `loaded` is given the files it read or looked for, whether or not they load.
/** @throws {CompileError | Error | IoError} */
function checkedSource(compilation: Compilation, file: string, src: string, library: boolean, loaded?: (files: string[]) => void): { checked: Checked; loaded: Loaded } {
  let program = compilation;
  let modules = loadedFrom(program, file, src, loaded);
  let statements: Stmt[] = [];
  try {
    statements = expanded(program, modules, library);
  } catch (e) {
    if (e instanceof CompileError) throw sourced(e, copyNames(program.names), modules.sources);
    throw e;
  }
  let checked = checkedProgram(program, statements, library, modules.sources);
  for (let i: usize = 0; i < checked.warnings.length; i++) checked.warnings[i]!.sources = [...modules.sources];
  return { checked, loaded: modules };
}

// The program's files loaded, timed as the parse stage.
/** @throws {CompileError | Error | IoError} */
function loadedFrom(compilation: Mut<Compilation>, file: string, src: string, loaded?: (files: string[]) => void): Loaded {
  const started = stageStart(compilation.session);
  try {
    return load(compilation, file, src);
  } finally {
    stageEnd(compilation.session, "parse", started);
    if (loaded !== undefined) loaded([...compilation.looked]);
  }
}

// `check` of a whole program, timed as the check stage, its errors given the program's files.
/** @throws {CompileError} */
function checkedProgram(compilation: Compilation, program: Stmt[], library: boolean, sources: Ref<Source[]>): Checked {
  const started = stageStart(compilation.session);
  let checked: Checked | undefined = undefined;
  try {
    checked = check(compilation, program, library ? runtimeNames() : false);
  } catch (e) {
    if (e instanceof CompileError) throw sourced(e, undefined, sources);
    throw e;
  }
  let done: Checked = checked!;
  stageEnd(done.tables.session, "check", started);
  return done;
}

// The program checked and turned into IR, timed as the codegen stage, its packages bundled in and,
// in a debug build, its debug info added.
/** @throws {CompileError | Error | IoError | JsonError} */
function compiledIn(compilation: Compilation, src: string, file: string, release: boolean, panic: Panic, library: boolean, leaks: boolean, debug: boolean, loaded?: (files: string[]) => void): Compiled {
  let program = compilation;
  // What a build's codegen fails on is collected in the session's list, when it has one.
  const failed = program.session.failed;
  program.session.failed = undefined;
  let made = checkedSource(program, file, src, library, loaded);
  const sources = [...made.loaded.sources];
  return generated(made.checked, made.loaded, { src, file, release, panic, library, sources, leaks, debug, failed });
}

// The IR of a checked program, timed as the codegen stage, with its packages bundled in and, in a
// debug build, its debug info added.
/** @throws {CompileError | Error | IoError | JsonError} */
function generated(checked: Checked, loaded: Loaded, options: Options): Compiled {
  const names = copyNames(checked.tables.names);
  const { src, file, release } = options;
  const debug = options.debug === true;
  const started = stageStart(checked.tables.session);
  let made: { ir: string; checked: Checked } | undefined = undefined;
  try {
    made = codegenChecked(checked, options);
  } catch (e) {
    if (e instanceof CompileError) throw sourced(e, names, loaded.sources);
    throw e;
  }
  let done = made!;
  let ir = bundled(done.ir, loaded);
  if (debug) ir = withDebugInfo(ir, src, file, loaded.sources, release);
  stageEnd(done.checked.tables.session, "codegen", started);
  return { ir, checked: done.checked, rust: loaded.rust };
}

// The IR with the program's packages bundled into it, those its code reaches, when it reaches any.
/** @throws {CompileError | Error | IoError | JsonError} */
function bundled(ir: string, loaded: Ref<Loaded>): string {
  const calls = /^\s+(?:%\S+ = )?(?:call|invoke) ptr @fsh_rt_js_export\(ptr @fsh\.js\.bundle, i64 (\d+)/gm;
  let seen = new Set<usize>();
  for (const m of ir.matchAll(calls)) seen.add((Number(m[1]!) ?? 0) as usize);
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
export function buildLibrary(session: BuildSession, file: string, out: string, kind: Library, release = false, panic: Panic = "unwind", links: string[] = [], target: Target = hostTarget(), debug = false): CompileError[] {
  const src = readFileSync(file, "utf8");
  let { core, caches } = apart(session);
  const made = compiledIn(newCompilation(core), src, file, release, panic, true, false, debug);
  const ir = made.ir;
  const checked: Ref<Checked> = made.checked;
  const shim = rustShim(made.rust, checked);
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
    for (const u of runtimeUnits(ir, release, true, copyTarget(target))) objects.push(cachedObject(building, u));
    for (const o of mathObjects(building, [...target.compile])) objects.push(o);
    if (kind === "shared") {
      const darwin = target.triple === "" ? process.platform === "darwin" : target.triple.includes("-apple-");
      const extension = darwin ? "dylib" : "so";
      run(["clang", ...target.compile, ...target.link, "-shared", "-fPIC", "-pthread", "-x", "ir", "-", "-x", "none", ...objects, "-funwind-tables", "-o", join(dirname(out), `lib${name}.${extension}`), optimize, ...g, "-lm", ...links.map((l) => `-l${l}`), ...runtimeLinks(ir, target), ...(shim !== undefined ? [shim.lib, ...shim.links] : none)], ir);
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
    const pointer = typeof r.to !== "string" && typing.rec(r.to).kind === "pointer";
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
// program reports at exit what it never freed, by where it was allocated. `loaded` is given the
// files the program was read from, or looked for, even when it doesn't build. Gives the warnings.
/** @throws {CompileError | Error | IoError | JsonError} */
export function build(session: BuildSession, file: string, out: string, release = false, panic: Panic = "unwind", links: string[] = [], target: Target = hostTarget(), leaks = false, debug = false, loaded?: (files: string[]) => void): CompileError[] {
  return built(session, file, out, release, panic, links, target, leaks, debug, loaded).warnings;
}

// `build`, giving the session back, with its caches and the build's timings.
/** @throws {CompileError | Error | IoError | JsonError} */
function built(session: BuildSession, file: string, out: string, release: boolean, panic: Panic, links: string[], target: Target, leaks: boolean, debug: boolean, loaded?: (files: string[]) => void): { warnings: CompileError[]; session: BuildSession } {
  let { core, caches } = apart(session);
  let made = compiledIn(newCompilation(core), readFileSync(file, "utf8"), file, release, panic, false, leaks, debug, loaded);
  const ir = instrumented(made.ir, target);
  const shim = rustShim(made.rust, made.checked);
  if (shim !== undefined) refuseForeignRust(target);
  const split = parts(ir, made.checked, release, target);
  let building = together(made.checked.tables.session, caches);
  linked(building, ir, split, out, release, links, shim, target, leaks, debug);
  return { warnings: made.checked.warnings, session: building };
}

// Cargo isn't told the target yet, so a crate would be built for the host.
/** @throws {Error} */
function refuseForeignRust(target: Ref<Target>) {
  if (target.compile.includes("-target")) throw new Error(`fishc build: Rust crates can't be built for ${target.triple} yet; build on a ${target.triple} machine, or without --target`);
}

// A build's IR as clang is given it: a release build's as one module, so `-O2` inlines across std
// and the program, and a dev build's as the program's part, with std's part a unit of its own that
// the cache keeps between builds.
function parts(ir: string, checked: Ref<Checked>, release: boolean, target: Ref<Target>): { std: Unit[]; program: string } {
  if (release) return { std: [], program: ir };
  const arenas: Ref<Arenas> = checked.tables.arenas;
  const names = symbolNames(arenas);
  let std: string[] = [];
  let own: string[] = [];
  for (const i of compiledOf(checked)) {
    const body = bodyOf(arenas, i);
    if (body.foreign === true || body.rust !== undefined) continue;
    if (body.start >= STD_BASE) std.push(symbolIn(arenas, i, names));
    else own.push(symbolIn(arenas, i, names));
  }
  const halves = split(ir, std, own);
  return { std: [{ name: "std", args: [...target.compile, "-x", "ir", "-", optimization(false, target), "-funwind-tables"], stdin: halves.std, inputs: [] }], program: halves.program };
}

// Builds the program's IR, split into `halves`, into the executable `out`.
/** @throws {Error | IoError} */
function linked(session: Mut<BuildSession>, ir: string, halves: Ref<{ std: Unit[]; program: string }>, out: string, release: boolean, links: string[], shim: Shim | undefined, target: Ref<Target>, leaks: boolean, debug: boolean) {
  const started = stageStart(session);
  let objects: string[] = [];
  for (const u of runtimeUnits(ir, release, false, copyTarget(target), leaks)) objects.push(cachedObject(session, u));
  for (const u of halves.std) objects.push(cachedObject(session, u));
  for (const o of mathObjects(session, [...target.compile])) objects.push(o);
  stageEnd(session, "runtime", started);
  const none: string[] = [];
  const g = debug ? ["-g"] : none;
  const tls = runtimeLinks(ir, target);
  if (session.timings === undefined) {
    clang([...clangArgs(out, release, links, objects, shim, copyTarget(target)), ...tls, ...g], halves.program);
    return;
  }
  // Timed, the program is compiled and linked by two clang calls, so each is measured on its own.
  const note = objectsNote(session.timings);
  session.timings.notes.set("runtime", note);
  const dir = mkdtempSync(join(tmpdir(), "fishc-"));
  try {
    const object = join(dir, "program.o");
    const compiling = stageStart(session);
    clang(["clang", ...target.compile, "-c", "-x", "ir", "-", "-o", object, "-funwind-tables", optimization(release, target), ...g], halves.program);
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
  let made = compiledIn(newCompilation(core), readFileSync(file, "utf8"), file, release, panic, false, false, false);
  const host = hostTarget();
  const halves = parts(made.ir, made.checked, release, host);
  const shim = rustShim(made.rust, made.checked);
  let building = together(made.checked.tables.session, caches);
  // ponytail: each object in turn, as Fish can't map to promises yet; Promise.all over them once it can.
  let objects: string[] = [];
  for (const u of runtimeUnits(made.ir, release)) {
    const object = await objectAsync(u, objectPath(building, u));
    objects.push(object);
  }
  for (const u of halves.std) {
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
export function buildTests(session: BuildSession, dir: string, out: string): Test[] {
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
  const checked = checkedProgram(compilation, program, false, loaded.sources);
  const sources = [...loaded.sources];
  const made = generated(checked, loaded, { src, file: entry, release: false, panic: "unwind", sources, harness: true });
  const shim = rustShim(made.rust, made.checked);
  const host = hostTarget();
  const halves = parts(made.ir, made.checked, false, host);
  let building = together(made.checked.tables.session, caches);
  linked(building, made.ir, halves, out, false, [], shim, host, false, false);
  return tests;
}

// Runs the tests of the package at `dir` whose name holds `filter`, each in a process of its own.
// Gives the exit code.
/** @throws {Error | IoError | JsonError} */
async function testPackage(session: BuildSession, dir: string, filter: string | undefined): Promise<i64> {
  const out = join(mkdtempSync(join(tmpdir(), "fishc-test-")), "tests");
  let code: i64 = 1;
  try {
    code = await testsIn(session, dir, out, filter);
  } catch (e) {
    rmSync(dirname(out), { recursive: true, force: true });
    throw e;
  }
  rmSync(dirname(out), { recursive: true, force: true });
  return code;
}

// `testPackage`'s build and run, the build at `out`.
/** @throws {Error | IoError | JsonError} */
async function testsIn(session: BuildSession, dir: string, out: string, filter: string | undefined): Promise<i64> {
  let running = new Set<i32>();
  try {
    const tests = buildTests(session, dir, out);
    if (tests.length === 0) {
      console.log("no tests found");
      return 0;
    }
    const chosen = filter === undefined ? tests : tests.filter((t) => t.name.includes(filter));
    if (chosen.length > 0) {
      const code = await Promise.race([runTests(running, out, chosen, dir), signalled("SIGINT", 130), signalled("SIGTERM", 143)]);
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
      // A relative `.ts` import is renamed when its `.fsh` file will be there, or is and the `.ts`
      // file isn't; with both there, which is meant is for a person to say.
      const fsh: Imported = (specifier): "rename" | "ambiguous" | undefined => {
        const target = resolve(dirname(path), specifier);
        if (settled.has(target)) return "rename";
        if (!existsSync(`${target.slice(0, -3)}.fsh`)) return undefined;
        return existsSync(target) ? "ambiguous" : "rename";
      };
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
      parse(src, { last: 0 });
      if (fixing) {
        const to = typescript ? `${path.slice(0, -3)}.fsh` : undefined;
        if (to !== undefined && existsSync(to)) {
          problem(`fishc lint: '${shown}' isn't fixed, since '${fromHere(to)}', its Fish name, already exists`);
          continue;
        }
        const { text, fixed } = fixedText(src, shown, fsh);
        if (text === undefined) {
          code = 1;
          continue;
        }
        if (text !== src || to !== undefined) {
          const failed = rewrite(path, text, Buffer.from(src), to);
          if (failed !== undefined) {
            const target = resolve(path);
            settled.delete(target);
            const pointing = importers.get(target) ?? noFiles;
            const stranded = pointing.length > 0 ? `; ${pointing.map((p) => `'${p}'`).join(", ")} already import${pointing.length === 1 ? "s" : ""} its '.fsh' name, which isn't there` : "";
            problem(`fishc lint: can't write '${shown}': ${failed}${stranded}`);
            continue;
          }
        }
        for (const target of settledImports(path, src, settled)) importers.set(target, [...(importers.get(target) ?? noFiles), to !== undefined ? fromHere(to) : shown]);
        if (fixed > 0) console.log(`fixed ${fixed} in ${shown}`);
        if (to !== undefined) {
          at = to;
          shown = fromHere(to);
          console.log(`renamed ${fromHere(path)} to ${shown}`);
        }
        src = text;
      }
      const found = migrations(parseWithComments(src, { last: 0 }), src, fsh).sort((a, b) => a.start - b.start || a.end - b.end);
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
  return hits > 0 ? 1 : code;
}

// The files of `settled` that the file at `path`, with text `src`, imports by a relative path,
// whose imports its fixes rename.
/** @throws {CompileError} */
function settledImports(path: string, src: string, settled: Ref<Set<string>>): string[] {
  let found: string[] = [];
  for (const s of parse(src, { last: 0 })) {
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
export const ENGINE = join(import.meta.dir, "..", "vendor", "quickjs-ng");
export const ENGINE_SOURCES = ["quickjs.c", "libregexp.c", "libunicode.c", "dtoa.c"].map((f) => join(ENGINE, f));

// Whether the IR calls into the JS engine: an instruction, not a declaration or a string's bytes.
export const callsEngine = (ir: string) => /^\s+(?:%\S+ = )?(?:call|invoke) [^"\n]*@fsh_rt_js_/m.test(ir);

// Whether the IR calls into the OpenSSL half of the runtime, as fetch, serve and the tls module do
// for TLS, and the postgres module and WebSocket handshakes for hashes. A function std declares
// itself is called by its quoted name.
export const callsTls = (ir: string) => /^\s+(?:%\S+ = )?(?:call|invoke) [^"\n]*@"?fsh_rt_(?:tls|crypto)_/m.test(ir);

// Whether the IR calls into the zlib half of the runtime, as the zlib module does.
export const callsZlib = (ir: string) => /^\s+(?:%\S+ = )?(?:call|invoke) [^"\n]*@"?fsh_rt_zlib_/m.test(ir);

// What links OpenSSL into a program calling the TLS runtime, when it was found, without which the
// runtime's TLS calls say how to install it, and zlib into one calling the zlib runtime.
export function runtimeLinks(ir: string, target: Ref<Target>): string[] {
  const zlib: string[] = callsZlib(ir) ? ["-lz"] : [];
  if (!callsTls(ir)) return zlib;
  const openssl = findOpenSsl(target);
  const none: string[] = [];
  return [...("link" in openssl ? openssl.link : none), ...zlib];
}

// The C half of the runtime as cached objects, with the engine's glue and sources when the
// program's IR calls the engine, and the TLS and zlib halves when it calls those. They are built with unwind tables so a panic can unwind through
// them, and position-independent when `pic`, for a library. A `--leaks` build's runtime records
// each block's site, so it is an object of its own.
/** @throws {IoError} */
export function runtimeUnits(ir: string, release: boolean, pic = false, target: Target = hostTarget(), leaks = false): Unit[] {
  const js = callsEngine(ir);
  const openssl = callsTls(ir) ? findOpenSsl(target) : undefined;
  const none: string[] = [];
  const flags = [...target.compile, "-funwind-tables", "-pthread", optimization(release, target), ...(pic ? ["-fPIC"] : none), ...(js ? ["-I", ENGINE] : none)];
  const tls = openssl === undefined ? "" : "missing" in openssl ? "-tls-missing" : "-tls";
  const name = `${js ? "runtime-js" : "runtime"}${tls}${leaks ? "-leaks" : ""}`;
  const source = [NATIVE, ...(js ? [JS_NATIVE] : none), ...(openssl === undefined ? none : ["missing" in openssl ? tlsStub(openssl.missing) : TLS_NATIVE])].join("\n");
  const tlsFlags = openssl !== undefined && "compile" in openssl ? openssl.compile : [...none];
  const runtime: Unit = { name, args: ["-x", "c", "-", ...flags, ...tlsFlags, ...(leaks ? ["-DFSH_LEAK_SITES"] : none)], stdin: source, inputs: js ? files(ENGINE) : none };
  const engine: Unit[] = js ? ENGINE_SOURCES.map((source): Unit => ({ name: basename(source, ".c"), args: ["-x", "c", source, ...flags], inputs: files(ENGINE) })) : [];
  const zlib: Unit[] = callsZlib(ir) ? [{ name: "zlib", args: ["-x", "c", "-", ...flags], stdin: ZLIB_NATIVE, inputs: [] }] : [];
  return [runtime, ...engine, ...zlib];
}

// A build's optimization level. A sanitized dev build is optimized a little, as clang advises for
// its sanitizers: at -O0, clang for AArch64 misreads large aggregates passed by value to an
// address-sanitized function, so the program would quietly do something else.
function optimization(release: boolean, target: Ref<Target>): string {
  return release ? "-O2" : target.sanitize !== undefined ? "-O1" : "-O0";
}

// Clang's command line for a program, its IR read from stdin unless `program` names it compiled
// already, linked with `objects`.
function clangArgs(out: string, release: boolean, links: string[], objects: string[], shim?: Shim, target: Target = hostTarget(), program: string[] = ["-x", "ir", "-"]): string[] {
  const none: string[] = [];
  return ["clang", ...target.compile, ...target.link, ...program, "-x", "none", ...objects, "-funwind-tables", "-pthread", "-o", out, optimization(release, target), "-lm", ...links.map((l) => `-l${l}`), ...(shim !== undefined ? [shim.lib, ...shim.links] : none)];
}

function fail(message: string): never {
  console.error(message);
  return process.exit(2);
}

// The time each of a build's `stages` took, printed when the build was timed.
function reportTimings(session: Ref<Session>, stages: string[], start: f64) {
  if (session.timings !== undefined) process.stderr.write(formatTimings(session.timings, stages, performance.now() - start));
}

// A directory `fishc survey` can read, holding TypeScript.
/** @throws {IoError} */
function checkProject(dir: string) {
  if (!existsSync(dir)) fail(`fishc survey: '${dir}' doesn't exist`);
  if (!statSync(dir).isDirectory()) fail(`fishc survey: '${dir}' is a file; give the directory of a TypeScript project`);
  try {
    readdirSync(dir);
  } catch (e) {
    fail(`fishc survey: '${dir}' can't be read: ${(e as { message: string }).message}`);
  }
  if (sources(dir).length === 0) fail(`fishc survey: '${dir}' holds no TypeScript files (.ts, .tsx or .mts, outside node_modules)`);
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
          sanitize: { type: "string", multiple: true },
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
  // Each build compiles within a session of its own, since a check uses up the one it is given.
  const sessionFor = (): BuildSession => {
    let made = cachedSession();
    made.locking.locked = values.locked === true;
    if (values.timings === true) made.timings = newTimings();
    return made;
  };
  // `fishc run` and `fishc watch` take the program's arguments after the file, or all of them with no file.
  const command = positionals.length > 0 ? positionals[0] : undefined;
  const named = positionals.length > 1 ? positionals[1] : undefined;
  const file = (command === "run" || command === "watch") && named !== undefined && !named.endsWith(".fsh") ? undefined : named;
  const programArgs = positionals.slice(file === undefined ? 1 : 2);
  if (command === "explain") {
    if (positionals.length !== 2 || flags.some((k) => k !== "panic")) fail("usage: fishc explain <code>");
    const text = explain(named!);
    if (text === undefined) fail(`fishc explain: '${named ?? ""}' isn't an error code; a code looks like E0201 or W0001, as an error shows it`);
    console.log(text);
    process.exit(0);
  }
  if (command === "survey") {
    const dirs = positionals.slice(1);
    const usage = "usage: fishc survey <dir> [--compare <old.json>] [--json]\n       fishc survey --rank <dir>... [--self <dir>] [--plan <build-plan.md>] [--json]";
    const extra = values.self !== undefined || values.plan !== undefined;
    if (dirs.length === 0 || (values.rank !== true && (dirs.length > 1 || extra))) fail(usage);
    if (values.rank === true && values.compare !== undefined) fail("fishc survey: --compare compares one project's survey; rankings can't be compared yet");
    for (const dir of dirs) checkProject(dir);
    if (values.self !== undefined) checkProject(values.self);
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
      const ranking = rank(dirs, values.self, plan);
      console.log(values.json === true ? indented(JSON.stringify(ranking)) : formatRanking(ranking, plan !== undefined));
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
    const paths = positionals.slice(1);
    if (flags.some((k) => k !== "check" && k !== "panic") || (paths.includes("-") && paths.length > 1)) fail(usage);
    const check = values.check === true;
    if (paths[0] === "-") process.exit(formatStdin(check));
    if (paths.length === 0) {
      const found = findManifest(process.cwd());
      if (found === undefined) fail(`fishc fmt: no ${MANIFEST} here or in any directory above; name the files to format, or run it inside a package`);
      paths.push(dirname(found));
    }
    process.exit(formatPaths(paths, check));
  }
  if (command === "lint") {
    const paths = positionals.slice(1);
    if (flags.some((k) => k !== "panic" && k !== "fix") || values.panic !== "unwind") fail("usage: fishc lint [<path>...] [--fix]");
    if (paths.length === 0) {
      const found = findManifest(process.cwd());
      if (found === undefined) fail(`fishc lint: no ${MANIFEST} here or in any directory above; name the files to lint, or run it inside a package`);
      paths.push(dirname(found));
    }
    process.exit(lintPaths(paths, values.fix === true));
  }
  if (command === "test") {
    // Tests are built to unwind, so `--panic=abort` is refused rather than ignored.
    if (positionals.length > 2 || flags.some((k) => k !== "panic") || values.panic !== "unwind") fail("usage: fishc test [<filter>]");
    const found = findManifest(process.cwd());
    if (found === undefined) fail(`fishc test: no ${MANIFEST} here or in any directory above; tests run inside a package`);
    process.exit(await testPackage(sessionFor(), dirname(found!), file));
  }
  if (command === "publish") {
    const usage = "usage: fishc publish [--dry-run] [--allow-dirty] [--submit [--fork <url>] [--yes]]";
    const allowed = new Set(["panic", "dry-run", "allow-dirty", "submit", "fork", "yes"]);
    const submitting = values.submit === true;
    if (positionals.length > 1 || flags.some((k) => !allowed.has(k)) || ((values.fork !== undefined || values.yes === true) && !submitting) || (submitting && values["dry-run"] === true)) fail(usage);
    const found = findManifest(process.cwd());
    if (found === undefined) fail(`fishc publish: no ${MANIFEST} here or in any directory above; publish runs inside a package`);
    try {
      const packed = pack(found, values["allow-dirty"] === true);
      console.log(`packed ${packed.manifest.name} ${packed.manifest.version}: ${packed.files.length} files, ${Math.ceil(packed.bytes.length / 1024)} KiB, sha256 ${packed.sha256}`);
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
    const found = findManifest(process.cwd());
    if (found === undefined) fail(`fishc ${command}: no ${MANIFEST} here or in any directory above; make a package with 'fishc new <name>' or 'fishc init'`);
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
        const latest = maxSatisfying(released.map((e) => e.version), parseRange(range ?? "*")!);
        if (latest === undefined) fail(`fishc add: no version of '${name}' in the registry fits '${range ?? "*"}'`);
        const written = range ?? `^${formatVersion(latest!)}`;
        const edited = withDependency(readFileSync(found, "utf8"), `${name} = { version = "${written}" }`);
        // Written only once the result still reads as the manifest with the new dependency.
        if (!readManifest(edited, manifest.dir).dependencies.some((d) => d.name === name)) fail(`fishc add: couldn't add '${name}' to ${MANIFEST}; add it by hand`);
        writeFileSync(found, edited);
        console.log(`added ${name} ${written}`);
        const chosen = released.find((e) => e.version === latest);
        if (chosen?.unsafe) console.error(`note: '${name}' ${chosen.text} uses unsafe`);
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
      fail(`fishc ${command}: ${(e as { message: string }).message}`);
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
      fail(command === "init" && file === undefined ? `fishc init: this directory's name '${name}' isn't a package name: ${NAME_RULE}; give one, as in 'fishc init my-app'` : `fishc ${command}: '${name}' isn't a package name: ${NAME_RULE}`);
    }
    if (command === "new" && !vacant(dir)) fail(`fishc new: '${file ?? ""}' already exists and isn't empty; choose another name, or run 'fishc init' inside it`);
    if (command === "init" && existsSync(join(dir, MANIFEST))) fail(`fishc init: there is already a ${MANIFEST} here`);
    createPackage(dir, name);
    console.log(`created the package '${name}'${command === "new" ? ` in ${file ?? ""}/` : ""}`);
    process.exit(0);
  }
  const panicName = values.panic ?? "unwind";
  const panic: Panic = panicName === "abort" ? "abort" : "unwind";
  const libName = values.lib;
  const lib: Library | undefined = libName === undefined ? undefined : libName === "shared" ? "shared" : "static";
  const release = values.release === true;
  const leaks = values.leaks === true;
  if (values.sanitize !== undefined && command !== "build") fail(`fishc ${command}: '--sanitize' instruments a build; build with 'fishc build --sanitize address|thread', then run the binary it writes`);
  let target = file;
  let out = values.out;
  // With no file, the package around the working directory is built, as cargo builds one.
  if ((command === "build" || command === "check" || command === "run" || command === "watch") && file === undefined && lib === undefined) {
    const found = findManifest(process.cwd());
    if (found === undefined) fail(`fishc ${command}: no ${MANIFEST} here or in any directory above; give a file to build, or make a package with 'fishc new <name>' or 'fishc init'`);
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
  if (command === "run" && target !== undefined && values.out === undefined && !llvm && lib === undefined) {
    // A lone file's program is built where nothing else looks, and removed once it has run.
    const scratch = out === undefined ? mkdtempSync(join(tmpdir(), "fishc-run-")) : undefined;
    const binary = out ?? join(scratch!, basename(target, ".fsh"));
    let code = 1;
    try {
      const start = performance.now();
      const made = built(sessionFor(), target, binary, release, panic, links, hostTarget(), leaks, values.debug === true);
      reportTimings(made.session, [...FRONT_END, "codegen", ...NATIVE_STAGES], start);
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
    await watchProgram({
      entry,
      binary,
      args: programArgs,
      manifest: findManifest(dirname(resolve(entry))),
      build: () => {
        let loaded: string[] = [];
        try {
          const start = performance.now();
          const made = built(sessionFor(), entry, binary, release, panic, [...links], hostTarget(), leaks, values.debug === true, (files) => {
            loaded = files;
          });
          reportTimings(made.session, [...FRONT_END, "codegen", ...NATIVE_STAGES], start);
          for (const w of made.warnings) console.error(painted(w, entry, readFileSync(entry, "utf8"), "warning"));
          return { built: true, loaded };
        } catch (e) {
          if (e instanceof CompileError) console.error(painted(e, entry, readFileSync(entry, "utf8")));
          else console.error(`fishc: ${(e as { message: string }).message}`);
          return { built: false, loaded };
        }
      },
      done: () => {
        if (scratch !== undefined) rmSync(scratch, { recursive: true, force: true });
      },
    });
  }
  if (command !== "build" || target === undefined || values.fix === true || values.json === true || values.rank === true || values.self !== undefined || values.plan !== undefined || values.compare !== undefined || (panicName !== "unwind" && panicName !== "abort") || links.some((l) => l.trim() === "") || (libName !== undefined && libName !== "static" && libName !== "shared")) {
    console.error("usage: fishc build [<file.fsh>] [-o <out>] [--release] [-g] [--locked] [--panic=unwind|abort] [--link <library>]... [--lib[=static|shared]] [--target <triple>] [--sysroot <dir>] [--static [--dockerfile]] [--leaks] [--timings] [--emit-llvm] [--sanitize address|thread]\n       fishc check [<file.fsh>] [--timings]\n       fishc run [<file.fsh>] [--release] [-g] [--leaks] [--timings] [-- <args>...]\n       fishc watch [<file.fsh>] [--release] [-g] [--leaks] [--timings] [-- <args>...]\n       fishc new <name>\n       fishc init [<name>]\n       fishc add <name>[@<range>]\n       fishc update [<name>]\n       fishc publish [--dry-run] [--allow-dirty] [--submit [--fork <url>] [--yes]]\n       fishc fmt [<path>...] [--check]\n       fishc fmt - [--check]\n       fishc test [<filter>]\n       fishc lint [<path>...] [--fix]\n       fishc survey <dir> [--compare <old.json>] [--json]\n       fishc survey --rank <dir>... [--self <dir>] [--plan <build-plan.md>] [--json]\n       fishc explain <code>\n       fishc lsp");
    process.exit(2);
  }
  // A library keeps no frames to name sites with, and its host's exit isn't the library's to report.
  if (values.timings === true && lib !== undefined) fail("fishc build: '--timings' times an executable's build; leave out '--lib' to time the program it would be built from");
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
      const made = compiledIn(newCompilation(sessionFor()), readFileSync(target!, "utf8"), target!, release, panic, lib !== undefined, leaks, values.debug === true);
      reportTimings(made.checked.tables.session, [...FRONT_END, "codegen"], start);
      process.stdout.write(made.ir);
    } else {
      // FISH_SYSROOT is for building for another target, never the host's own plain builds.
      const fromEnv = process.env.FISH_SYSROOT ?? "";
      const sysroot = values.sysroot ?? (values.target !== undefined && values.target !== hostTriple() && fromEnv !== "" ? fromEnv : undefined);
      const resolved = resolveTarget(values.target, sysroot);
      const base = values.static === true ? staticTarget(resolved) : resolved;
      const platform = sanitize !== undefined ? sanitizedTarget(base, sanitize) : base;
      // A sanitizer's report names .fsh lines only when the program carries line tables.
      const debug = values.debug === true || sanitize !== undefined;
      const binary = out ?? basename(target!, ".fsh");
      const image = values.dockerfile === true ? dockerfilePath(binary) : undefined;
      try {
        let warnings: CompileError[] = [];
        if (lib !== undefined) warnings = buildLibrary(sessionFor(), target!, binary, lib, release, panic, links, platform, debug);
        else {
          const start = performance.now();
          const made = built(sessionFor(), target!, binary, release, panic, links, platform, leaks, debug);
          reportTimings(made.session, [...FRONT_END, "codegen", ...NATIVE_STAGES], start);
          warnings = made.warnings;
        }
        if (image !== undefined) writeFileSync(image, dockerfile(binary));
        for (const w of warnings) console.error(painted(w, target!, readFileSync(target!, "utf8"), "warning"));
      } catch (e) {
        // A missing header or library for another target is most often a missing or partial sysroot.
        if (e instanceof Error && platform.compile.includes("-target") && e.message.startsWith("clang failed")) e.message += `\nfishc build: building for ${platform.triple} needs its headers and libraries; check that --sysroot or FISH_SYSROOT names a complete sysroot for it`;
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
