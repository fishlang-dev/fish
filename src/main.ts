#!/usr/bin/env bun
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { C_KEYWORDS, check } from "./check.ts";
import { codegen } from "./codegen.ts";
import { CompileError, formatError } from "./diag.ts";
import { NATIVE } from "./native.ts";
import { parse } from "./parser.ts";
import { formatRanking, rank, readPlan } from "./rank.ts";
import { formatReport, sources, survey } from "./survey.ts";
import type { Instance } from "./check.ts";
import { INTEGERS, type Type } from "./typing.ts";

export type Panic = "unwind" | "abort";
// A library C can call: an archive to link, or a shared library to load.
export type Library = "static" | "shared";

export function compile(src: string, file: string, release = false, panic: Panic = "unwind", library = false): string {
  return codegen(check(parse(src), library), { src, file, release, panic, library });
}

// Builds `file` into a library at `out`'s directory, `lib<name>.a` or a shared one, with
// `<name>.h` declaring its exports beside it.
export function buildLibrary(file: string, out: string, kind: Library, release = false, panic: Panic = "unwind", links: string[] = []) {
  const src = readFileSync(file, "utf8");
  const checked = check(parse(src), true);
  const ir = codegen(checked, { src, file, release, panic, library: true });
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
  const { values, positionals } = parseArgs({
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
    },
  });
  const [command, file] = positionals;
  if (command === "survey") {
    const dirs = positionals.slice(1);
    const usage = "usage: fishc survey <dir> [--json]\n       fishc survey --rank <dir>... [--self <dir>] [--plan <build-plan.md>] [--json]";
    if (dirs.length === 0 || (!values.rank && (dirs.length > 1 || values.self || values.plan))) fail(usage);
    for (const dir of [...dirs, ...(values.self ? [values.self] : [])]) checkProject(dir);
    if (values.rank) {
      let plan;
      try {
        plan = values.plan ? readPlan(values.plan) : undefined;
      } catch (e) {
        fail(`fishc survey: the plan '${values.plan}' can't be read: ${e instanceof Error ? e.message : e}`);
      }
      const ranking = rank(dirs, values.self, plan);
      console.log(values.json ? JSON.stringify(ranking, null, 2) : formatRanking(ranking));
    } else {
      const report = survey(file!);
      console.log(values.json ? JSON.stringify(report, null, 2) : formatReport(report));
    }
    process.exit(0);
  }
  const panic = values.panic as Panic;
  const lib = values.lib as Library | undefined;
  if (command !== "build" || !file || values.json || values.rank || values.self || values.plan || (panic !== "unwind" && panic !== "abort") || values.link?.some((l) => l.trim() === "") || (lib !== undefined && lib !== "static" && lib !== "shared")) {
    console.error("usage: fishc build <file.fsh> [-o <out>] [--release] [--panic=unwind|abort] [--link <library>]... [--lib[=static|shared]] [--emit-llvm]\n       fishc survey <dir> [--json]\n       fishc survey --rank <dir>... [--self <dir>] [--plan <build-plan.md>] [--json]");
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
