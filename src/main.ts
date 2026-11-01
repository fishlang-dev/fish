#!/usr/bin/env bun
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { constants, tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import { C_KEYWORDS, check } from "./check.ts";
import { codegen, symbol } from "./codegen.ts";
import { newCompilation, newSession, type Compilation, type Session } from "./compilation.ts";
import { CompileError, formatError, named, type Source } from "./diag.ts";
import { flatten, load, type Loaded } from "./modules.ts";
import { resolvePackages } from "./dependencies.ts";
import { pack, prepare, submit, unsafeDependencies } from "./publish.ts";
import { openIndex, registryUrl } from "./registry_index.ts";
import { formatVersion, parseRange, maxSatisfying } from "./semver.ts";
import { createPackage, type Edition, fieldError, findManifest, loadManifest, MANIFEST, NAME_RULE, readManifest, vacant, validName, withDependency } from "./manifest.ts";
import { expandMacros } from "./macros.ts";
import { parse, parseWithComments, type Stmt } from "./parser.ts";
import { bundle } from "./bundle.ts";
import { JS_NATIVE } from "./js_native.ts";
import { NATIVE } from "./native.ts";
import { cachedObject, cachedObjectAsync, files, mathObjects, mathObjectsAsync, type Unit } from "./mathlib.ts";
import { dockerfile, dockerfilePath, HOST_TARGET, hostTriple, resolveTarget, staticTarget, type Target } from "./target.ts";
import { fishFiles, formatPaths, formatStdin, rewrite } from "./fmt.ts";
import { serveLsp } from "./lsp.ts";
import { directive, fix, migrations, REJECTS, type Imported } from "./migrate.ts";
import { hideMains, harnessImports, harnessMain, liftTests, runTests, stopTests, stripTests, type Test } from "./tests.ts";
import { formatRanking, rank, readPlan } from "./rank.ts";
import { compare, formatComparison, formatReport, readReport, sources, survey } from "./survey.ts";
import { explain } from "./codes.ts";
import type { Checked, Instance } from "./check.ts";
import { INTEGERS, type Type } from "./typing.ts";
import { rustShim, type Shim } from "./rust.ts";
import { split } from "./split.ts";
import { withDebugInfo } from "./debuginfo.ts";
import { watchProgram } from "./watch.ts";
import { STD_BASE } from "./std.ts";
import { formatTimings, FRONT_END, NATIVE_STAGES, newTimings, timed } from "./timings.ts";

export type Panic = "unwind" | "abort";

// `formatError` for stderr, painted on a terminal unless NO_COLOR is set, or whenever FORCE_COLOR is.
function painted(e: CompileError, path: string, program: string, kind = "error"): string {
  const forced = process.env.FORCE_COLOR;
  const colour = forced !== undefined && forced !== "0" ? true : process.stderr.isTTY === true && !process.env.NO_COLOR;
  return formatError(e, path, program, kind, colour);
}
// A library C can call: an archive to link, or a shared library to load.
export type Library = "static" | "shared";

// Checks the program whose entry is `file`, with text `src`, without building it, its package's
// tests included. The file may be one another imports, so it needs no `main`. `read` reads the
// files it imports. Each of these entry points compiles within a `session`, whose caches it uses.
export function analyze(session: Session, src: string, file: string, read?: (path: string) => string): { checked: Checked; sources: Source[] } {
  const compilation = newCompilation(session);
  const loaded = load(compilation, file, src, read);
  return withSources(compilation, loaded.sources, () => {
    liftTests(compilation, loaded.modules.filter((m) => m.pkg === loaded.modules[0]!.pkg && !m.path.startsWith("std:")));
    return { checked: check(compilation, expanded(compilation, loaded, false), false, false, true), sources: loaded.sources };
  });
}

// Compiles the program whose entry is `file`, with text `src`, and every file it imports.
export function compile(session: Session, src: string, file: string, release = false, panic: Panic = "unwind", library = false, leaks = false, debug = false): string {
  return compiled(session, src, file, release, panic, library, leaks, debug).ir;
}

// Checks the program whose entry is `file` as `compile` would, generating nothing, or a library
// with no main; throws its first CompileError. Gives the warnings.
export function checkProgram(session: Session, file: string, library = false): CompileError[] {
  const compilation = newCompilation(session);
  const loaded = timed(session.timings, "parse", () => load(compilation, file, readFileSync(file, "utf8")));
  const checked = withSources(compilation, loaded.sources, () => checkedProgram(compilation, expanded(compilation, loaded, library), library));
  for (const w of checked.warnings) w.sources = loaded.sources;
  return checked.warnings;
}

// `compile`, with the Rust shim the program's calls need, built when asked for.
// `loaded` is given the files it read or looked for, whether or not it compiles.
function compiled(session: Session, src: string, file: string, release: boolean, panic: Panic, library: boolean, leaks = false, debug = false, loaded?: (files: string[]) => void): { ir: string; instances: Instance[]; shim: () => Shim | undefined; warnings: CompileError[] } {
  const compilation = newCompilation(session);
  try {
    return compiledIn(compilation, src, file, release, panic, library, leaks, debug);
  } finally {
    loaded?.(compilation.looked);
  }
}

function compiledIn(compilation: Compilation, src: string, file: string, release: boolean, panic: Panic, library: boolean, leaks: boolean, debug: boolean): { ir: string; instances: Instance[]; shim: () => Shim | undefined; warnings: CompileError[] } {
  const { timings } = compilation.session;
  const loaded = timed(timings, "parse", () => load(compilation, file, src));
  return withSources(compilation, loaded.sources, () => {
    const checked = checkedProgram(compilation, expanded(compilation, loaded, library), library);
    for (const w of checked.warnings) w.sources = loaded.sources;
    const ir = timed(timings, "codegen", () => {
      const ir = bundled(codegen(checked, { src, file, release, panic, library, sources: loaded.sources, leaks, debug }), loaded);
      return debug ? withDebugInfo(ir, src, file, loaded.sources, release) : ir;
    });
    return { ir, instances: checked.instances, shim: () => rustShim(loaded.rust, checked.instances), warnings: checked.warnings };
  });
}

// The IR with the program's packages bundled into it, those its code reaches, when it reaches any.
function bundled(ir: string, loaded: Loaded): string {
  const calls = /^\s+(?:%\S+ = )?(?:call|invoke) ptr @fsh_rt_js_export\(ptr @fsh\.js\.bundle, i64 (\d+)/gm;
  const used = [...new Set([...ir.matchAll(calls)].map((m) => Number(m[1])))].sort((a, b) => a - b);
  if (used.length === 0) return ir;
  const bytes = new TextEncoder().encode(bundle(loaded.packages, used));
  const text = [...bytes].map((c) => (c >= 0x20 && c < 0x7f && c !== 0x22 && c !== 0x5c ? String.fromCharCode(c) : `\\${c.toString(16).padStart(2, "0").toUpperCase()}`)).join("");
  return `${ir}\n@fsh.js.bundle = private unnamed_addr constant [${bytes.length + 1} x i8] c"${text}\\00"\n`;
}

// The program's files with their macros expanded, linked into one program. Tests not lifted
// already are left out.
function expanded(compilation: Compilation, loaded: Loaded, library: boolean): Stmt[] {
  const { timings } = compilation.session;
  timed(timings, "macros", () => {
    stripTests(loaded);
    expandMacros(compilation, loaded, library, (macros) => check(compilation, macros, false, true));
  });
  return timed(timings, "check", () => flatten(compilation, loaded, library));
}

// `check` of a whole program, timed as the check stage.
function checkedProgram(compilation: Compilation, program: Stmt[], library: boolean): Checked {
  return timed(compilation.session.timings, "check", () => check(compilation, program, library));
}

// Runs `run`, giving a compile error it throws the program's other files to render against, and
// the names it made up.
function withSources<T>({ names }: Compilation, sources: Source[], run: () => T): T {
  try {
    return run();
  } catch (e) {
    if (e instanceof CompileError) named(e, names).sources = sources;
    throw e;
  }
}

// Builds `file` into a library at `out`'s directory, `lib<name>.a` or a shared one, with
// `<name>.h` declaring its exports beside it. Gives the warnings.
export function buildLibrary(session: Session, file: string, out: string, kind: Library, release = false, panic: Panic = "unwind", links: string[] = [], target: Target = HOST_TARGET, debug = false): CompileError[] {
  const src = readFileSync(file, "utf8");
  const compilation = newCompilation(session);
  const loaded = load(compilation, file, src);
  const checked = withSources(compilation, loaded.sources, () => check(compilation, expanded(compilation, loaded, true), true));
  const made = withSources(compilation, loaded.sources, () => bundled(codegen(checked, { src, file, release, panic, library: true, sources: loaded.sources, debug }), loaded));
  const ir = debug ? withDebugInfo(made, src, file, loaded.sources, release) : made;
  const shim = rustShim(loaded.rust, checked.instances);
  if (shim) refuseForeignRust(target);
  if (!existsSync(dirname(out))) throw new Error(`can't write the library: the directory '${dirname(out)}' doesn't exist`);
  const name = basename(out).replace(/^lib/, "").replace(/\.(a|so|dylib)$/, "");
  const at = (f: string) => join(dirname(out), f);
  const dir = mkdtempSync(join(tmpdir(), "fishc-"));
  const fish = join(dir, "fish.o");
  const optimize = release ? "-O2" : "-O0";
  const g = debug ? ["-g"] : [];
  const run = (args: string[], stdin?: string) => {
    const done = Bun.spawnSync(args, stdin === undefined ? {} : { stdin: new TextEncoder().encode(stdin) });
    if (done.exitCode !== 0) throw new Error(`${args[0]} failed:\n${done.stderr.toString()}`);
  };
  try {
    const objects = [...runtimeUnits(ir, release, true, target).map((u) => cachedObject(session, u)), ...mathObjects(session, target.compile)];
    if (kind === "shared") {
      const darwin = target.triple === "" ? process.platform === "darwin" : target.triple.includes("-apple-");
      const extension = darwin ? "dylib" : "so";
      run(["clang", ...target.compile, ...target.link, "-shared", "-fPIC", "-pthread", "-x", "ir", "-", "-x", "none", ...objects, "-funwind-tables", "-o", at(`lib${name}.${extension}`), optimize, ...g, "-lm", ...links.map((l) => `-l${l}`), ...(shim ? [shim.lib, ...shim.links] : [])], ir);
    } else {
      run(["clang", ...target.compile, "-c", "-fPIC", "-x", "ir", "-", "-o", fish, optimize, ...g], ir);
      const archive = shim ? join(dir, "fish.a") : at(`lib${name}.a`);
      if (target.ar !== "ar" && !Bun.which(target.ar)) throw new Error(`fishc build: a static library for ${target.triple} is archived with llvm-ar, which isn't on PATH; install LLVM and put its bin directory on PATH, or build with --lib=shared`);
      run([target.ar, "rcs", archive, fish, ...objects]);
      // The shim's archive is merged in, so the library is still one file to link.
      if (shim && process.platform === "darwin") run(["libtool", "-static", "-o", at(`lib${name}.a`), archive, shim.lib]);
      else if (shim) run(["ar", "-M"], `CREATE ${at(`lib${name}.a`)}\nADDLIB ${archive}\nADDLIB ${shim.lib}\nSAVE\nEND\n`);
    }
    writeFileSync(at(`${name}.h`), header(name, checked.instances.filter((i) => i.body.exported)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  for (const w of checked.warnings) w.sources = loaded.sources;
  return checked.warnings;
}

// A C header declaring a library's exports, usable from C and C++. A parameter named like a C
// keyword is left unnamed, as C allows.
function header(name: string, exports: Instance[]): string {
  const guard = `${/^[A-Za-z]/.test(name) ? "" : "FISH_"}${name.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_H`;
  const lines = exports.map((i) => {
    const params = i.body.params.map((p) => {
      const { type, name } = i.locals.get(p)!;
      const c = cType(type);
      const named = /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && !C_KEYWORDS.has(name);
      return named ? `${c}${c.endsWith("*") ? "" : " "}${name}` : c;
    });
    return `${cType(i.returns)} ${i.body.name}(${params.length > 0 ? params.join(", ") : "void"});`;
  });
  return [`#ifndef ${guard}`, `#define ${guard}`, "", "#include <stdbool.h>", "#include <stddef.h>", "#include <stdint.h>", "", "#ifdef __cplusplus", 'extern "C" {', "#endif", "", ...lines, "", "#ifdef __cplusplus", "}", "#endif", "", `#endif`, ""].join("\n");
}

// How C names a type that crosses to it. A raw pointer's target is `const` unless it is a
// `MutPtr`, after the `*` when the target is itself a pointer; a target C has no name for is
// `void`.
function cType(t: Type): string {
  if (typeof t !== "string") {
    if (t.kind !== "pointer") return "void";
    const to = cType(t.to);
    const pointer = typeof t.to !== "string" && t.to.kind === "pointer";
    const target = t.mutable ? to : pointer ? `${to}const` : `const ${to}`;
    return `${target}${target.endsWith("*") ? "" : " "}*`;
  }
  const names: Record<string, string> = { boolean: "bool", f32: "float", f64: "double", usize: "size_t", isize: "ptrdiff_t" };
  if (names[t]) return names[t];
  if (t in INTEGERS) return t.startsWith("u") ? `uint${t.slice(1)}_t` : `int${t.slice(1)}_t`;
  return "void";
}

// Compiles `file` to a native executable at `out`, piping the IR through clang and linking the
// cached runtime objects.
// `links` names the C libraries the program's declared functions come from. With `leaks`, the
// program reports at exit what it never freed, by where it was allocated. `loaded` is given the
// files the program was read from, or looked for, even when it doesn't build. Gives the warnings.
export function build(session: Session, file: string, out: string, release = false, panic: Panic = "unwind", links: string[] = [], target: Target = HOST_TARGET, leaks = false, debug = false, loaded?: (files: string[]) => void): CompileError[] {
  const { ir, instances, shim, warnings } = compiled(session, readFileSync(file, "utf8"), file, release, panic, false, leaks, debug, loaded);
  const rust = shim();
  if (rust) refuseForeignRust(target);
  linked(session, ir, instances, out, release, links, rust, target, leaks, debug);
  return warnings;
}

// Cargo isn't told the target yet, so a crate would be built for the host.
function refuseForeignRust(target: Target) {
  if (target.compile.includes("-target")) throw new Error(`fishc build: Rust crates can't be built for ${target.triple} yet; build on a ${target.triple} machine, or without --target`);
}

// A build's IR as clang is given it: a release build's as one module, so `-O2` inlines across std
// and the program, and a dev build's as the program's part, with std's part a unit of its own that
// the cache keeps between builds.
function parts(ir: string, instances: Instance[], release: boolean, target: Target = HOST_TARGET): { std: Unit[]; program: string } {
  if (release) return { std: [], program: ir };
  const bodies = instances.filter((i) => !i.body.foreign && !i.body.rust);
  const named = (std: boolean) => bodies.filter((i) => i.body.start >= STD_BASE === std).map(symbol);
  const { std, program } = split(ir, named(true), named(false));
  return { std: [{ name: "std", args: [...target.compile, "-x", "ir", "-", "-O0", "-funwind-tables"], stdin: std, inputs: [] }], program };
}

// Builds the IR `ir`, of `instances`, into the executable `out`.
function linked(session: Session, ir: string, instances: Instance[], out: string, release = false, links: string[] = [], shim?: Shim, target: Target = HOST_TARGET, leaks = false, debug = false) {
  const { std, program } = parts(ir, instances, release, target);
  const objects = [...[...runtimeUnits(ir, release, false, target, leaks), ...std].map((u) => cachedObject(session, u)), ...mathObjects(session, target.compile)];
  const clang = Bun.spawnSync([...clangArgs(out, release, links, objects, shim, target), ...(debug ? ["-g"] : [])], { stdin: new TextEncoder().encode(program) });
  if (clang.exitCode !== 0) throw new Error(`clang failed:\n${clang.stderr.toString()}`);
}

// `build`, with clang run without blocking, so several builds can go at once.
export async function buildAsync(session: Session, file: string, out: string, release = false, panic: Panic = "unwind", links: string[] = []): Promise<CompileError[]> {
  const { ir, instances, shim, warnings } = compiled(session, readFileSync(file, "utf8"), file, release, panic, false);
  const { std, program } = parts(ir, instances, release);
  const objects = (await Promise.all([...[...runtimeUnits(ir, release), ...std].map((u) => cachedObjectAsync(session, u)), mathObjectsAsync(session)])).flat();
  const clang = Bun.spawn(clangArgs(out, release, links, objects, shim()), { stdin: new TextEncoder().encode(program), stderr: "pipe" });
  const [code, stderr] = await Promise.all([clang.exited, new Response(clang.stderr).text()]);
  if (code !== 0) throw new Error(`clang failed:\n${stderr}`);
  return warnings;
}

// Builds the tests of the package at `dir` into one program at `out`, unless it has none, and gives
// them in declaration order. Every `.fsh` file of the package is loaded through a generated entry,
// the harness, whose `main` runs one test by its index.
export function buildTests(session: Session, dir: string, out: string): Test[] {
  const files = fishFiles(dir, (message) => console.error(message.replace(/^fishc fmt/, "fishc test")));
  // The harness is read as the manifest's path, which every package has and no `.fsh` file is, so
  // the files' names are written from the package's directory.
  const entry = join(dir, MANIFEST);
  const src = harnessImports(dir, files);
  const compilation = newCompilation(session);
  const loaded = load(compilation, entry, src);
  return withSources(compilation, loaded.sources, () => {
    const tests = liftTests(compilation, files.map((f) => loaded.modules.find((m) => m.path === realpathSync(f))!));
    if (tests.length === 0) return tests;
    hideMains(compilation, loaded.modules.slice(1).filter((m) => !m.path.startsWith("std:")));
    loaded.modules[0]!.statements.push(...harnessMain(compilation.ids, tests, loaded.modules));
    const checked = check(compilation, expanded(compilation, loaded, false));
    linked(session, bundled(codegen(checked, { src, file: entry, release: false, panic: "unwind", sources: loaded.sources, harness: true }), loaded), checked.instances, out, false, [], rustShim(loaded.rust, checked.instances));
    return tests;
  });
}

// Runs the tests of the package at `dir` whose name holds `filter`, each in a process of its own.
// Gives the exit code.
async function testPackage(session: Session, dir: string, filter: string | undefined): Promise<number> {
  const out = join(mkdtempSync(join(tmpdir(), "fishc-test-")), "tests");
  const running = new Set<number>();
  // Interrupted, the tests running and what they started end, and the build is removed.
  for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143]] as const) {
    process.on(signal, () => {
      stopTests(running);
      rmSync(dirname(out), { recursive: true, force: true });
      process.exit(code);
    });
  }
  try {
    const tests = buildTests(session, dir, out);
    if (tests.length === 0) {
      console.log("no tests found");
      return 0;
    }
    const chosen = filter === undefined ? tests : tests.filter((t) => t.name.includes(filter));
    if (chosen.length > 0) return await runTests(running, out, chosen, dir);
    console.error(`fishc test: no test's name contains '${filter}'`);
    return 1;
  } catch (e) {
    if (!(e instanceof CompileError)) throw e;
    // The harness's own text is generated, and an error in it would be the compiler's.
    console.error(painted(e, relative(process.cwd(), join(dir, MANIFEST)), ""));
    return 1;
  } finally {
    rmSync(dirname(out), { recursive: true, force: true });
  }
}

// Lints the TS-compat files among `paths`, a directory standing for its `.fsh` files as for
// `fishc fmt`, and a `.ts` file named itself being TS-compat: each rule's hit is printed as an
// error is, then the count. A file named itself that is native is said to have nothing to lint.
// With `fixing`, each file's auto fixes are written first, a `.ts` file moving to its `.fsh` name,
// and what is left is reported. Gives the exit code: 1 when anything is to change or couldn't be
// read or written, else 0.
function lintPaths(paths: string[], fixing: boolean): number {
  let code = 0;
  const problem = (message: string) => {
    console.error(message.replace(/^fishc fmt/, "fishc lint"));
    code = 1;
  };
  const files: { path: string; named: boolean }[] = [];
  for (const path of paths) {
    if (!existsSync(path)) problem(`fishc lint: can't find '${path}'`);
    else if (statSync(path).isDirectory()) files.push(...fishFiles(path, problem).map((f) => ({ path: f, named: false })));
    else files.push({ path, named: true });
  }
  // A manifest that can't be read is reported once, as "broken", and its files are skipped.
  const editions = new Map<string, Edition | "broken">();
  const packaged = (file: string) => {
    const manifest = findManifest(dirname(file));
    if (!manifest) return undefined;
    if (!editions.has(manifest)) {
      try {
        editions.set(manifest, loadManifest(manifest).edition);
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
  const settled = new Set(files.filter((f) => f.named && f.path.endsWith(".ts") && !f.path.endsWith(".d.ts") && !existsSync(`${f.path.slice(0, -3)}.fsh`) && fixes(f.path)).map((f) => resolve(f.path)));
  // The files written with an import of each settled file's `.fsh` name.
  const importers = new Map<string, string[]>();
  let [hits, changed] = [0, 0];
  for (const { path, named } of files) {
    let [at, shown, src] = [path, relative(process.cwd(), path) || path, ""];
    try {
      if (named && path.endsWith(".d.ts")) {
        console.log(`fishc lint: '${shown}' is a declaration file, which describes JavaScript rather than holding code to port, so it isn't linted`);
        continue;
      }
      src = readFileSync(path, "utf8");
      const typescript = named && path.endsWith(".ts");
      // A relative `.ts` import is renamed when its `.fsh` file will be there, or is and the `.ts`
      // file isn't; with both there, which is meant is for a person to say.
      const pointed = new Set<string>();
      const fsh: Imported = (specifier) => {
        const target = resolve(dirname(path), specifier);
        if (settled.has(target)) {
          pointed.add(target);
          return "rename";
        }
        if (!existsSync(`${target.slice(0, -3)}.fsh`)) return undefined;
        return existsSync(target) ? "ambiguous" : "rename";
      };
      const edition = typescript ? "ts-compat" : (directive(src)?.edition ?? packaged(path) ?? "native");
      if (edition === "broken") continue;
      if (edition === "native") {
        if (named) console.log(`fishc lint: '${shown}' is in the native edition, so there's nothing to lint`);
        continue;
      }
      parse(src, { last: 0 });
      if (fixing) {
        const to = typescript ? `${path.slice(0, -3)}.fsh` : undefined;
        if (to && existsSync(to)) {
          problem(`fishc lint: '${shown}' isn't fixed, since '${relative(process.cwd(), to) || to}', its Fish name, already exists`);
          continue;
        }
        const { text, fixed } = fixedText(src, shown, fsh);
        if (text === undefined) {
          code = 1;
          continue;
        }
        if (text !== src || to) {
          const failed = rewrite(path, text, Buffer.from(src), to);
          if (failed) {
            const target = resolve(path);
            settled.delete(target);
            const pointing = importers.get(target) ?? [];
            const stranded = pointing.length > 0 ? `; ${pointing.map((p) => `'${p}'`).join(", ")} already import${pointing.length === 1 ? "s" : ""} its '.fsh' name, which isn't there` : "";
            problem(`fishc lint: can't write '${shown}': ${failed}${stranded}`);
            continue;
          }
        }
        for (const target of pointed) importers.set(target, [...(importers.get(target) ?? []), to ? relative(process.cwd(), to) || to : shown]);
        if (fixed > 0) console.log(`fixed ${fixed} in ${shown}`);
        if (to) {
          [at, shown] = [to, relative(process.cwd(), to) || to];
          console.log(`renamed ${relative(process.cwd(), path) || path} to ${shown}`);
        }
        src = text;
      }
      const found = migrations(parseWithComments(src, { last: 0 }), src, fsh).sort((a, b) => a.start - b.start || a.end - b.end);
      if (at.endsWith(".ts")) found.unshift({ rule: "A10", action: "auto", start: 0, end: 0, message: `the file becomes '${basename(at, ".ts")}.fsh', its Fish name; 'fishc lint --fix' renames it` });
      for (const hit of found) console.log(formatError(new CompileError("E0802", hit.message ?? REJECTS[hit.rule]!, hit.start, hit.end), shown, src, `${hit.action} ${hit.rule}`));
      hits += found.length;
      if (found.length > 0) changed++;
    } catch (e) {
      if (!(e instanceof CompileError)) problem(`fishc lint: can't read '${shown}': ${e instanceof Error ? e.message : e}`);
      // A manifest's error carries its own source; any other is in this file.
      else problem(formatError(e, shown, src));
    }
  }
  console.log(`${hits} to change in ${changed} file${changed === 1 ? "" : "s"}`);
  return hits > 0 ? 1 : code;
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
function fixedText(src: string, shown: string, fsh: Imported): { text?: string; fixed: number } {
  try {
    return fix(src, fsh);
  } catch (e) {
    if (!(e instanceof CompileError)) throw e;
    console.error(`fishc lint: '${shown}' was left as it was, because a fix gave text that doesn't parse (${e.message}); please report it`);
    return { fixed: 0 };
  }
}

// The vendored JS engine, compiled into a program only when it calls the engine.
export const ENGINE = join(import.meta.dir, "..", "vendor", "quickjs-ng");
export const ENGINE_SOURCES = ["quickjs.c", "libregexp.c", "libunicode.c", "dtoa.c"].map((f) => join(ENGINE, f));

// Whether the IR calls into the JS engine: an instruction, not a declaration or a string's bytes.
export const callsEngine = (ir: string) => /^\s+(?:%\S+ = )?(?:call|invoke) [^"\n]*@fsh_rt_js_/m.test(ir);

// The C half of the runtime as cached objects, with the engine's glue and sources when the
// program's IR calls the engine. They are built with unwind tables so a panic can unwind through
// them, and position-independent when `pic`, for a library. A `--leaks` build's runtime records
// each block's site, so it is an object of its own.
export function runtimeUnits(ir: string, release: boolean, pic = false, target: Target = HOST_TARGET, leaks = false): Unit[] {
  const js = callsEngine(ir);
  const flags = [...target.compile, "-funwind-tables", "-pthread", release ? "-O2" : "-O0", ...(pic ? ["-fPIC"] : []), ...(js ? ["-I", ENGINE] : [])];
  const name = `${js ? "runtime-js" : "runtime"}${leaks ? "-leaks" : ""}`;
  const runtime: Unit = { name, args: ["-x", "c", "-", ...flags, ...(leaks ? ["-DFSH_LEAK_SITES"] : [])], stdin: js ? `${NATIVE}\n${JS_NATIVE}` : NATIVE, inputs: js ? files(ENGINE) : [] };
  const engine = js ? ENGINE_SOURCES.map((source): Unit => ({ name: basename(source, ".c"), args: ["-x", "c", source, ...flags], inputs: files(ENGINE) })) : [];
  return [runtime, ...engine];
}

// Clang's command line for a program read from stdin, linked with `objects`.
function clangArgs(out: string, release: boolean, links: string[], objects: string[], shim?: Shim, target: Target = HOST_TARGET): string[] {
  return ["clang", ...target.compile, ...target.link, "-x", "ir", "-", "-x", "none", ...objects, "-funwind-tables", "-pthread", "-o", out, release ? "-O2" : "-O0", "-lm", ...links.map((l) => `-l${l}`), ...(shim ? [shim.lib, ...shim.links] : [])];
}

function fail(message: string): never {
  console.error(message);
  process.exit(2);
}

// A directory `fishc survey` can read, holding TypeScript.
function checkProject(dir: string) {
  if (!existsSync(dir)) fail(`fishc survey: '${dir}' doesn't exist`);
  if (!statSync(dir).isDirectory()) fail(`fishc survey: '${dir}' is a file; give the directory of a TypeScript project`);
  try {
    readdirSync(dir);
  } catch (e) {
    fail(`fishc survey: '${dir}' can't be read: ${e instanceof Error ? e.message : e}`);
  }
  if (sources(dir).length === 0) fail(`fishc survey: '${dir}' holds no TypeScript files (.ts, .tsx or .mts, outside node_modules)`);
}

if (import.meta.main && Bun.argv.length === 3 && Bun.argv[2] === "lsp") serveLsp();
else if (import.meta.main) {
  const session = newSession();
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
        },
      });
    } catch (e) {
      return fail(`fishc: ${e instanceof Error ? e.message : e}`);
    }
  })();
  // `fishc run` and `fishc watch` take the program's arguments after the file, or all of them with no file.
  const [command, named] = positionals;
  const file = (command === "run" || command === "watch") && named !== undefined && !named.endsWith(".fsh") ? undefined : named;
  const programArgs = positionals.slice(file === undefined ? 1 : 2);
  if (command === "explain") {
    if (positionals.length !== 2 || Object.keys(values).some((k) => k !== "panic")) fail("usage: fishc explain <code>");
    const text = explain(named!);
    if (text === undefined) fail(`fishc explain: '${named}' isn't an error code; a code looks like E0201 or W0001, as an error shows it`);
    console.log(text);
    process.exit(0);
  }
  if (command === "survey") {
    const dirs = positionals.slice(1);
    const usage = "usage: fishc survey <dir> [--compare <old.json>] [--json]\n       fishc survey --rank <dir>... [--self <dir>] [--plan <build-plan.md>] [--json]";
    const extra = values.self !== undefined || values.plan !== undefined;
    if (dirs.length === 0 || (!values.rank && (dirs.length > 1 || extra))) fail(usage);
    if (values.rank && values.compare !== undefined) fail("fishc survey: --compare compares one project's survey; rankings can't be compared yet");
    for (const dir of [...dirs, ...(values.self !== undefined ? [values.self] : [])]) checkProject(dir);
    // A directory given twice, or inside another given, would count its files twice.
    const real = dirs.map((d) => realpathSync(d));
    const nested = real.findIndex((d, k) => real.some((e, l) => l !== k && (d === e ? l < k : d.startsWith(e + sep))));
    if (nested >= 0) fail(`fishc survey: '${dirs[nested]}' is already surveyed as part of another directory given`);
    if (values.rank) {
      let plan;
      try {
        plan = values.plan !== undefined ? readPlan(values.plan) : undefined;
      } catch (e) {
        fail(`fishc survey: the plan '${values.plan}' can't be read: ${e instanceof Error ? e.message : e}`);
      }
      const ranking = rank(dirs, values.self, plan);
      console.log(values.json ? JSON.stringify(ranking, null, 2) : formatRanking(ranking));
    } else if (values.compare !== undefined) {
      let then;
      try {
        if (!existsSync(values.compare)) throw new Error("it doesn't exist");
        if (!statSync(values.compare).isFile()) throw new Error("it isn't a file");
        // A saved report is kilobytes; anything far larger isn't one.
        if (statSync(values.compare).size > 64 * 1024 * 1024) throw new Error("it is too large to be a saved survey");
        then = readReport(readFileSync(values.compare, "utf8"));
      } catch (e) {
        fail(`fishc survey: the baseline '${values.compare}' can't be compared: ${e instanceof Error ? e.message : e}`);
      }
      const c = compare(then, survey(file!));
      console.log(values.json ? JSON.stringify(c, null, 2) : formatComparison(c));
    } else {
      const report = survey(file!);
      console.log(values.json ? JSON.stringify(report, null, 2) : formatReport(report));
    }
    process.exit(0);
  }
  if (command === "fmt") {
    const usage = "usage: fishc fmt [<path>...] [--check]\n       fishc fmt - [--check]";
    const paths = positionals.slice(1);
    if (Object.keys(values).some((k) => k !== "check" && k !== "panic") || (paths.includes("-") && paths.length > 1)) fail(usage);
    const check = values.check === true;
    if (paths[0] === "-") process.exit(formatStdin(check));
    if (paths.length === 0) {
      const found = findManifest(process.cwd());
      if (!found) fail(`fishc fmt: no ${MANIFEST} here or in any directory above; name the files to format, or run it inside a package`);
      paths.push(dirname(found));
    }
    process.exit(formatPaths(paths, check));
  }
  if (command === "lint") {
    const paths = positionals.slice(1);
    if (Object.keys(values).some((k) => k !== "panic" && k !== "fix") || values.panic !== "unwind") fail("usage: fishc lint [<path>...] [--fix]");
    if (paths.length === 0) {
      const found = findManifest(process.cwd());
      if (!found) fail(`fishc lint: no ${MANIFEST} here or in any directory above; name the files to lint, or run it inside a package`);
      paths.push(dirname(found));
    }
    process.exit(lintPaths(paths, values.fix === true));
  }
  if (command === "test") {
    // Tests are built to unwind, so `--panic=abort` is refused rather than ignored.
    if (positionals.length > 2 || Object.keys(values).some((k) => k !== "panic") || values.panic !== "unwind") fail("usage: fishc test [<filter>]");
    const found = findManifest(process.cwd());
    if (!found) fail(`fishc test: no ${MANIFEST} here or in any directory above; tests run inside a package`);
    process.exit(await testPackage(session, dirname(found), file));
  }
  if (command === "publish") {
    const usage = "usage: fishc publish [--dry-run] [--allow-dirty] [--submit [--fork <url>] [--yes]]";
    const allowed = new Set(["panic", "dry-run", "allow-dirty", "submit", "fork", "yes"]);
    if (positionals.length > 1 || Object.keys(values).some((k) => !allowed.has(k)) || ((values.fork !== undefined || values.yes) && !values.submit) || (values.submit && values["dry-run"])) fail(usage);
    const found = findManifest(process.cwd());
    if (!found) fail(`fishc publish: no ${MANIFEST} here or in any directory above; publish runs inside a package`);
    try {
      const packed = pack(found, values["allow-dirty"] === true);
      console.log(`packed ${packed.manifest.name} ${packed.manifest.version}: ${packed.files.length} files, ${Math.ceil(packed.bytes.length / 1024)} KiB, sha256 ${packed.sha256}`);
      for (const f of packed.files) console.log(`  ${f}`);
      console.log(`wrote ${relative(process.cwd(), packed.file)}`);
      const deps = unsafeDependencies(packed.manifest);
      if (packed.unsafe.length === 0 && deps.length === 0) console.log(`no unsafe in ${packed.manifest.name} or its dependencies`);
      for (const u of packed.unsafe) console.log(`unsafe: ${u.file}:${u.line}:${u.col} ${u.what}`);
      for (const d of deps) console.log(`unsafe: the dependency '${d.name}' ${d.text} uses unsafe`);
      if (!values["dry-run"]) {
        const prepared = prepare(packed);
        console.log(`prepared ${prepared.branch} in ${prepared.clone}: ${prepared.archive} and its index line`);
        if (!values.submit) console.log(`run 'fishc publish --submit' to push it to your fork and open a pull request`);
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
      fail(`fishc publish: ${e instanceof Error ? e.message : e}`);
    }
    process.exit(0);
  }
  if (command === "add" || command === "update") {
    const usage = "usage: fishc add <name>[@<range>]\n       fishc update [<name>]";
    if (positionals.length > 2 || (command === "add" && !file) || Object.keys(values).some((k) => k !== "panic")) fail(usage);
    const found = findManifest(process.cwd());
    if (!found) fail(`fishc ${command}: no ${MANIFEST} here or in any directory above; make a package with 'fishc new <name>' or 'fishc init'`);
    try {
      const manifest = loadManifest(found);
      if (command === "add") {
        const [name, range] = file!.includes("@") ? [file!.slice(0, file!.indexOf("@")), file!.slice(file!.indexOf("@") + 1)] : [file!, undefined];
        if (!validName(name)) fail(`fishc add: '${name}' isn't a package name: ${NAME_RULE}`);
        if (manifest.dependencies.some((d) => d.name === name)) fail(`fishc add: '${name}' is already a dependency in ${MANIFEST}`);
        if (range !== undefined && (range.trim() === "" || /[\n\r"\\]/.test(range) || !parseRange(range))) fail(`fishc add: '${range}' isn't a version range; write one as package.json does, as in ^1.2.0`);
        const released = openIndex(registryUrl(manifest), true).versions(name).filter((e) => !e.yanked);
        const latest = maxSatisfying(released.map((e) => e.version), parseRange(range ?? "*")!);
        if (!latest) fail(`fishc add: no version of '${name}' in the registry fits '${range ?? "*"}'`);
        const written = range ?? `^${formatVersion(latest)}`;
        const edited = withDependency(readFileSync(found, "utf8"), `${name} = { version = "${written}" }`);
        // Written only once the result still reads as the manifest with the new dependency.
        if (!readManifest(edited, manifest.dir).dependencies.some((d) => d.name === name)) fail(`fishc add: couldn't add '${name}' to ${MANIFEST}; add it by hand`);
        writeFileSync(found, edited);
        console.log(`added ${name} ${written}`);
        const chosen = released.find((e) => e.version === latest);
        if (chosen?.unsafe) console.error(`note: '${name}' ${chosen.text} uses unsafe`);
      } else {
        if (file && !manifest.dependencies.some((d) => d.name === file && "version" in d)) fail(`fishc update: '${file}' isn't a dependency from the registry in ${MANIFEST}`);
        session.locking.update = file ? new Set([file]) : "all";
        resolvePackages(join(manifest.dir, manifest.entry), session.locking);
        console.log(`updated ${relative(process.cwd(), join(manifest.dir, "fish.lock")) || "fish.lock"}`);
      }
    } catch (e) {
      if (e instanceof CompileError) {
        console.error(painted(e, relative(process.cwd(), found), readFileSync(found, "utf8")));
        process.exit(1);
      }
      fail(`fishc ${command}: ${e instanceof Error ? e.message : e}`);
    }
    process.exit(0);
  }
  if (command === "new" || command === "init") {
    const usage = "usage: fishc new <name>\n       fishc init [<name>]";
    const flags = Object.keys(values).some((k) => k !== "panic");
    if (positionals.length > 2 || flags || (command === "new" && !file)) fail(usage);
    const dir = command === "new" ? join(process.cwd(), file!) : process.cwd();
    const name = file ?? basename(dir);
    if (!validName(name)) {
      fail(command === "init" && !file ? `fishc init: this directory's name '${name}' isn't a package name: ${NAME_RULE}; give one, as in 'fishc init my-app'` : `fishc ${command}: '${name}' isn't a package name: ${NAME_RULE}`);
    }
    if (command === "new" && !vacant(dir)) fail(`fishc new: '${file}' already exists and isn't empty; choose another name, or run 'fishc init' inside it`);
    if (command === "init" && existsSync(join(dir, MANIFEST))) fail(`fishc init: there is already a ${MANIFEST} here`);
    createPackage(dir, name);
    console.log(`created the package '${name}'${command === "new" ? ` in ${file}/` : ""}`);
    process.exit(0);
  }
  const panic = values.panic as Panic;
  const lib = values.lib as Library | undefined;
  // Runs one build, then prints how long its `stages` took when asked; a failed build prints none.
  const timing = <T>(stages: string[], run: () => T): T => {
    if (!values.timings) return run();
    const timings = (session.timings = newTimings());
    const start = performance.now();
    const result = run();
    process.stderr.write(formatTimings(timings, stages, performance.now() - start));
    return result;
  };
  session.locking.locked = values.locked === true;
  let target = file;
  let out = values.out;
  // With no file, the package around the working directory is built, as cargo builds one.
  if ((command === "build" || command === "check" || command === "run" || command === "watch") && !file && lib === undefined) {
    const found = findManifest(process.cwd());
    if (!found) fail(`fishc ${command}: no ${MANIFEST} here or in any directory above; give a file to build, or make a package with 'fishc new <name>' or 'fishc init'`);
    try {
      const manifest = loadManifest(found, "entry");
      // An entry inside a package nested here would build as that package's program.
      const holder = findManifest(dirname(realpathSync(join(manifest.dir, manifest.entry))));
      if (holder && realpathSync(holder) !== realpathSync(found)) throw fieldError(found, "entry", `the entry '${manifest.entry}' is a file inside the package '${loadManifest(holder).name}'; a package's entry is one of its own files`);
      target = relative(process.cwd(), join(manifest.dir, manifest.entry));
      out ??= join(manifest.dir, "target", values.release ? "release" : "debug", manifest.name);
      if (!values["emit-llvm"] && command !== "check") mkdirSync(dirname(out), { recursive: true });
    } catch (e) {
      if (!(e instanceof CompileError)) throw e;
      console.error(painted(e, relative(process.cwd(), found), readFileSync(found, "utf8")));
      process.exit(1);
    }
  }
  if (command === "check" && target && !values.out && !values.release && !values["emit-llvm"] && lib === undefined) {
    try {
      for (const w of timing(FRONT_END, () => checkProgram(session, target))) console.error(painted(w, target, readFileSync(target, "utf8"), "warning"));
    } catch (e) {
      if (e instanceof CompileError) console.error(painted(e, target, readFileSync(target, "utf8")));
      else console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    }
    process.exit(0);
  }
  if (command === "run" && target && !values.out && !values["emit-llvm"] && lib === undefined) {
    // A lone file's program is built where nothing else looks, and removed once it has run.
    const scratch = out === undefined ? mkdtempSync(join(tmpdir(), "fishc-run-")) : undefined;
    const binary = out ?? join(scratch!, basename(target, ".fsh"));
    let code = 1;
    try {
      for (const w of build(session, target, binary, values.release, panic, values.link ?? [], HOST_TARGET, values.leaks, values.debug)) console.error(painted(w, target, readFileSync(target, "utf8"), "warning"));
      const ran = Bun.spawnSync([binary, ...programArgs], { stdin: "inherit", stdout: "inherit", stderr: "inherit" });
      // A signal ends it with 128 plus the signal's number, as a shell reports it.
      code = ran.exitCode ?? 128 + (ran.signalCode ? constants.signals[ran.signalCode as NodeJS.Signals] : 0);
    } catch (e) {
      if (e instanceof CompileError) console.error(painted(e, target, readFileSync(target, "utf8")));
      else console.error(e instanceof Error ? e.message : e);
    } finally {
      if (scratch) rmSync(scratch, { recursive: true, force: true });
    }
    process.exit(code);
  }
  if (command === "watch" && target && !values.out && !values["emit-llvm"] && lib === undefined) {
    const entry = target;
    const scratch = out === undefined ? mkdtempSync(join(tmpdir(), "fishc-watch-")) : undefined;
    const binary = out ?? join(scratch!, basename(entry, ".fsh"));
    await watchProgram({
      entry,
      binary,
      args: programArgs,
      manifest: findManifest(dirname(resolve(entry))),
      build: (loaded) => {
        try {
          for (const w of build(session, entry, binary, values.release, panic, values.link ?? [], HOST_TARGET, values.leaks, values.debug, loaded)) console.error(painted(w, entry, readFileSync(entry, "utf8"), "warning"));
          return true;
        } catch (e) {
          if (e instanceof CompileError) console.error(painted(e, entry, readFileSync(entry, "utf8")));
          else console.error(`fishc: ${e instanceof Error ? e.message : e}`);
          return false;
        }
      },
      done: () => {
        if (scratch) rmSync(scratch, { recursive: true, force: true });
      },
    });
  }
  if (command !== "build" || !target || values.fix || values.json || values.rank || values.self !== undefined || values.plan !== undefined || values.compare !== undefined || (panic !== "unwind" && panic !== "abort") || values.link?.some((l) => l.trim() === "") || (lib !== undefined && lib !== "static" && lib !== "shared")) {
    console.error("usage: fishc build [<file.fsh>] [-o <out>] [--release] [-g] [--locked] [--panic=unwind|abort] [--link <library>]... [--lib[=static|shared]] [--target <triple>] [--sysroot <dir>] [--static [--dockerfile]] [--leaks] [--emit-llvm]\n       fishc check [<file.fsh>]\n       fishc run [<file.fsh>] [--release] [-g] [--leaks] [-- <args>...]\n       fishc watch [<file.fsh>] [--release] [-g] [--leaks] [-- <args>...]\n       fishc new <name>\n       fishc init [<name>]\n       fishc add <name>[@<range>]\n       fishc update [<name>]\n       fishc publish [--dry-run] [--allow-dirty] [--submit [--fork <url>] [--yes]]\n       fishc fmt [<path>...] [--check]\n       fishc fmt - [--check]\n       fishc test [<filter>]\n       fishc lint [<path>...] [--fix]\n       fishc survey <dir> [--compare <old.json>] [--json]\n       fishc survey --rank <dir>... [--self <dir>] [--plan <build-plan.md>] [--json]\n       fishc explain <code>\n       fishc lsp");
    process.exit(2);
  }
  // A library keeps no frames to name sites with, and its host's exit isn't the library's to report.
  if (values.leaks && lib !== undefined) fail("fishc build: '--leaks' can't build a library; build the program that uses it with '--leaks' instead");
  if (values.static && lib !== undefined) fail("fishc build: '--static' builds an executable, not a library; leave out '--lib', or '--static'");
  if ((values.static || values.dockerfile) && values["emit-llvm"]) fail("fishc build: '--emit-llvm' prints the IR without linking it, so '--static' and '--dockerfile' don't apply; leave them out");
  if (values.dockerfile && !values.static) fail("fishc build: '--dockerfile' writes an image holding only the binary, which needs it built with '--static'");
  try {
    if (values["emit-llvm"]) process.stdout.write(timing([...FRONT_END, "codegen"], () => compile(session, readFileSync(target, "utf8"), target, values.release, panic, lib !== undefined, values.leaks, values.debug)));
    else {
      // FISH_SYSROOT is for building for another target, never the host's own plain builds.
      const sysroot = values.sysroot ?? (values.target !== undefined && values.target !== hostTriple() ? process.env.FISH_SYSROOT || undefined : undefined);
      const resolved = resolveTarget(values.target, sysroot);
      const platform = values.static ? staticTarget(resolved) : resolved;
      const binary = out ?? basename(target, ".fsh");
      const image = values.dockerfile ? dockerfilePath(binary) : undefined;
      try {
        const warnings = lib ? buildLibrary(session, target, binary, lib, values.release, panic, values.link ?? [], platform, values.debug) : build(session, target, binary, values.release, panic, values.link ?? [], platform, values.leaks, values.debug);
        if (image) writeFileSync(image, dockerfile(binary));
        for (const w of warnings) console.error(painted(w, target, readFileSync(target, "utf8"), "warning"));
      } catch (e) {
        // A missing header or library for another target is most often a missing or partial sysroot.
        if (e instanceof Error && platform.compile.includes("-target") && e.message.startsWith("clang failed")) e.message += `\nfishc build: building for ${platform.triple} needs its headers and libraries; check that --sysroot or FISH_SYSROOT names a complete sysroot for it`;
        throw e;
      }
    }
  } catch (e) {
    if (e instanceof CompileError) console.error(painted(e, target, readFileSync(target, "utf8")));
    else console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}
