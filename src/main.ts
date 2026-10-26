#!/usr/bin/env bun
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, sep } from "node:path";
import { parseArgs } from "node:util";
import { C_KEYWORDS, check } from "./check.ts";
import { codegen } from "./codegen.ts";
import { CompileError, formatError, type Source } from "./diag.ts";
import { flatten, load, type Loaded } from "./modules.ts";
import { expandMacros } from "./macros.ts";
import type { Stmt } from "./parser.ts";
import { bundle } from "./bundle.ts";
import { JS_NATIVE } from "./js_native.ts";
import { NATIVE } from "./native.ts";
import { formatRanking, rank, readPlan } from "./rank.ts";
import { compare, formatComparison, formatReport, readReport, sources, survey } from "./survey.ts";
import type { Instance } from "./check.ts";
import { INTEGERS, type Type } from "./typing.ts";

export type Panic = "unwind" | "abort";
// A library C can call: an archive to link, or a shared library to load.
export type Library = "static" | "shared";

// Compiles the program whose entry is `file`, with text `src`, and every file it imports.
export function compile(src: string, file: string, release = false, panic: Panic = "unwind", library = false): string {
  const loaded = load(file, src);
  return withSources(loaded.sources, () => bundled(codegen(check(expanded(loaded, library), library), { src, file, release, panic, library, sources: loaded.sources }), loaded));
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

// The program's files with their macros expanded, linked into one program.
function expanded(loaded: Loaded, library: boolean): Stmt[] {
  expandMacros(loaded, library, (macros) => check(macros, false, true));
  return flatten(loaded, library);
}

// Runs `run`, giving a compile error it throws the program's other files to render against.
function withSources<T>(sources: Source[], run: () => T): T {
  try {
    return run();
  } catch (e) {
    if (e instanceof CompileError) e.sources = sources;
    throw e;
  }
}

// Builds `file` into a library at `out`'s directory, `lib<name>.a` or a shared one, with
// `<name>.h` declaring its exports beside it.
export function buildLibrary(file: string, out: string, kind: Library, release = false, panic: Panic = "unwind", links: string[] = []) {
  const src = readFileSync(file, "utf8");
  const loaded = load(file, src);
  const checked = withSources(loaded.sources, () => check(expanded(loaded, true), true));
  const ir = withSources(loaded.sources, () => bundled(codegen(checked, { src, file, release, panic, library: true, sources: loaded.sources }), loaded));
  if (!existsSync(dirname(out))) throw new Error(`can't write the library: the directory '${dirname(out)}' doesn't exist`);
  const name = basename(out).replace(/^lib/, "").replace(/\.(a|so|dylib)$/, "");
  const at = (f: string) => join(dirname(out), f);
  const dir = mkdtempSync(join(tmpdir(), "fishc-"));
  const [native, fish, runtime] = [join(dir, "native.c"), join(dir, "fish.o"), join(dir, "native.o")];
  const js = callsEngine(ir);
  writeFileSync(native, js ? `${NATIVE}\n${JS_NATIVE}` : NATIVE);
  const engine = js ? ENGINE_SOURCES : [];
  const optimize = release ? "-O2" : "-O0";
  const run = (args: string[], stdin?: string) => {
    const done = Bun.spawnSync(args, stdin === undefined ? {} : { stdin: new TextEncoder().encode(stdin) });
    if (done.exitCode !== 0) throw new Error(`${args[0]} failed:\n${done.stderr.toString()}`);
  };
  try {
    if (kind === "shared") {
      const extension = process.platform === "darwin" ? "dylib" : "so";
      run(["clang", "-shared", "-fPIC", "-pthread", "-x", "ir", "-", "-x", "c", native, ...(js ? ["-I", ENGINE, ...engine] : []), "-funwind-tables", "-o", at(`lib${name}.${extension}`), optimize, "-lm", ...links.map((l) => `-l${l}`)], ir);
    } else {
      run(["clang", "-c", "-fPIC", "-x", "ir", "-", "-o", fish, optimize], ir);
      run(["clang", "-c", "-fPIC", "-pthread", "-funwind-tables", ...(js ? ["-I", ENGINE] : []), native, "-o", runtime, optimize]);
      const objects = engine.map((source, i) => join(dir, `engine${i}.o`));
      engine.forEach((source, i) => run(["clang", "-c", "-fPIC", "-I", ENGINE, source, "-o", objects[i]!, optimize]));
      run(["ar", "rcs", at(`lib${name}.a`), fish, runtime, ...objects]);
    }
    writeFileSync(at(`${name}.h`), header(name, checked.instances.filter((i) => i.body.exported)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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

// Compiles `file` to a native executable at `out`, piping the IR through clang along with the
// C half of the runtime, which is built with unwind tables so a panic can unwind through it.
// `links` names the C libraries the program's declared functions come from.
export function build(file: string, out: string, release = false, panic: Panic = "unwind", links: string[] = []) {
  const ir = compile(readFileSync(file, "utf8"), file, release, panic);
  const dir = mkdtempSync(join(tmpdir(), "fishc-"));
  try {
    const clang = Bun.spawnSync(clangArgs(dir, out, release, links, ir), { stdin: new TextEncoder().encode(ir) });
    if (clang.exitCode !== 0) throw new Error(`clang failed:\n${clang.stderr.toString()}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// `build`, with clang run without blocking, so several builds can go at once.
export async function buildAsync(file: string, out: string, release = false, panic: Panic = "unwind", links: string[] = []) {
  const ir = compile(readFileSync(file, "utf8"), file, release, panic);
  const dir = mkdtempSync(join(tmpdir(), "fishc-"));
  try {
    const clang = Bun.spawn(clangArgs(dir, out, release, links, ir), { stdin: new TextEncoder().encode(ir), stderr: "pipe" });
    const [code, stderr] = await Promise.all([clang.exited, new Response(clang.stderr).text()]);
    if (code !== 0) throw new Error(`clang failed:\n${stderr}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// The vendored JS engine, compiled into a program only when it calls the engine.
export const ENGINE = join(import.meta.dir, "..", "vendor", "quickjs-ng");
export const ENGINE_SOURCES = ["quickjs.c", "libregexp.c", "libunicode.c", "dtoa.c"].map((f) => join(ENGINE, f));

// Whether the IR calls into the JS engine: an instruction, not a declaration or a string's bytes.
export const callsEngine = (ir: string) => /^\s+(?:%\S+ = )?(?:call|invoke) [^"\n]*@fsh_rt_js_/m.test(ir);

// Clang's command line for a program read from stdin, with the runtime's source written to `dir`,
// the engine's glue and sources with it when the program's IR calls the engine.
function clangArgs(dir: string, out: string, release: boolean, links: string[], ir: string): string[] {
  const native = join(dir, "native.c");
  const js = callsEngine(ir);
  writeFileSync(native, js ? `${NATIVE}\n${JS_NATIVE}` : NATIVE);
  const engine = js ? ["-I", ENGINE, ...ENGINE_SOURCES] : [];
  return ["clang", "-x", "ir", "-", "-x", "c", native, ...engine, "-funwind-tables", "-pthread", "-o", out, release ? "-O2" : "-O0", "-lm", ...links.map((l) => `-l${l}`)];
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

if (import.meta.main) {
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
          json: { type: "boolean" },
          rank: { type: "boolean" },
          self: { type: "string" },
          plan: { type: "string" },
          compare: { type: "string" },
        },
      });
    } catch (e) {
      return fail(`fishc: ${e instanceof Error ? e.message : e}`);
    }
  })();
  const [command, file] = positionals;
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
  const panic = values.panic as Panic;
  const lib = values.lib as Library | undefined;
  if (command !== "build" || !file || values.json || values.rank || values.self !== undefined || values.plan !== undefined || values.compare !== undefined || (panic !== "unwind" && panic !== "abort") || values.link?.some((l) => l.trim() === "") || (lib !== undefined && lib !== "static" && lib !== "shared")) {
    console.error("usage: fishc build <file.fsh> [-o <out>] [--release] [--panic=unwind|abort] [--link <library>]... [--lib[=static|shared]] [--emit-llvm]\n       fishc survey <dir> [--compare <old.json>] [--json]\n       fishc survey --rank <dir>... [--self <dir>] [--plan <build-plan.md>] [--json]");
    process.exit(2);
  }
  try {
    if (values["emit-llvm"]) process.stdout.write(compile(readFileSync(file, "utf8"), file, values.release, panic, lib !== undefined));
    else if (lib) buildLibrary(file, values.out ?? basename(file, ".fsh"), lib, values.release, panic, values.link ?? []);
    else build(file, values.out ?? basename(file, ".fsh"), values.release, panic, values.link ?? []);
  } catch (e) {
    if (e instanceof CompileError) console.error(formatError(e, file, readFileSync(file, "utf8")));
    else console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}
