#!/usr/bin/env bun
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, sep } from "node:path";
import { parseArgs } from "node:util";
import { C_KEYWORDS, check } from "./check.ts";
import { codegen } from "./codegen.ts";
import { CompileError, formatError, type Source } from "./diag.ts";
import { flatten, load } from "./modules.ts";
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
  const loaded = withSources([], () => load(file, src));
  return withSources(loaded.sources, () => codegen(check(flatten(loaded), library), { src, file, release, panic, library, sources: loaded.sources }));
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
  const loaded = withSources([], () => load(file, src));
  const checked = withSources(loaded.sources, () => check(flatten(loaded), true));
  const ir = codegen(checked, { src, file, release, panic, library: true, sources: loaded.sources });
  if (!existsSync(dirname(out))) throw new Error(`can't write the library: the directory '${dirname(out)}' doesn't exist`);
  const name = basename(out).replace(/^lib/, "").replace(/\.(a|so|dylib)$/, "");
  const at = (f: string) => join(dirname(out), f);
  const dir = mkdtempSync(join(tmpdir(), "fishc-"));
  const [native, fish, runtime] = [join(dir, "native.c"), join(dir, "fish.o"), join(dir, "native.o")];
  writeFileSync(native, NATIVE);
  const optimize = release ? "-O2" : "-O0";
  const run = (args: string[], stdin?: string) => {
    const done = Bun.spawnSync(args, stdin === undefined ? {} : { stdin: new TextEncoder().encode(stdin) });
    if (done.exitCode !== 0) throw new Error(`${args[0]} failed:\n${done.stderr.toString()}`);
  };
  try {
    if (kind === "shared") {
      const extension = process.platform === "darwin" ? "dylib" : "so";
      run(["clang", "-shared", "-fPIC", "-pthread", "-x", "ir", "-", "-x", "c", native, "-funwind-tables", "-o", at(`lib${name}.${extension}`), optimize, "-lm", ...links.map((l) => `-l${l}`)], ir);
    } else {
      run(["clang", "-c", "-fPIC", "-x", "ir", "-", "-o", fish, optimize], ir);
      run(["clang", "-c", "-fPIC", "-pthread", "-funwind-tables", native, "-o", runtime, optimize]);
      run(["ar", "rcs", at(`lib${name}.a`), fish, runtime]);
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
  const native = join(dir, "native.c");
  writeFileSync(native, NATIVE);
  try {
    const clang = Bun.spawnSync(["clang", "-x", "ir", "-", "-x", "c", native, "-funwind-tables", "-pthread", "-o", out, release ? "-O2" : "-O0", "-lm", ...links.map((l) => `-l${l}`)], {
      stdin: new TextEncoder().encode(ir),
    });
    if (clang.exitCode !== 0) throw new Error(`clang failed:\n${clang.stderr.toString()}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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
