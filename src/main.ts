#!/usr/bin/env bun
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { parseArgs } from "node:util";
import { check } from "./check.ts";
import { codegen } from "./codegen.ts";
import { CompileError, formatError } from "./diag.ts";
import { NATIVE } from "./native.ts";
import { parse } from "./parser.ts";

export function compile(src: string, file: string, release = false): string {
  return codegen(check(parse(src)), { src, file, release });
}

// Compiles `file` to a native executable at `out`, piping the IR through clang along with the
// C half of the runtime.
export function build(file: string, out: string, release = false) {
  const ir = compile(readFileSync(file, "utf8"), file, release);
  const dir = mkdtempSync(join(tmpdir(), "fishc-"));
  const native = join(dir, "native.c");
  writeFileSync(native, NATIVE);
  try {
    const clang = Bun.spawnSync(["clang", "-x", "ir", "-", "-x", "c", native, "-o", out, release ? "-O2" : "-O0", "-lm"], {
      stdin: new TextEncoder().encode(ir),
    });
    if (clang.exitCode !== 0) throw new Error(`clang failed:\n${clang.stderr.toString()}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      out: { type: "string", short: "o" },
      "emit-llvm": { type: "boolean" },
      release: { type: "boolean" },
    },
  });
  const [command, file] = positionals;
  if (command !== "build" || !file) {
    console.error("usage: fishc build <file.fsh> [-o <out>] [--release] [--emit-llvm]");
    process.exit(2);
  }
  try {
    if (values["emit-llvm"]) process.stdout.write(compile(readFileSync(file, "utf8"), file, values.release));
    else build(file, values.out ?? basename(file, ".fsh"), values.release);
  } catch (e) {
    if (e instanceof CompileError) console.error(formatError(e, file, readFileSync(file, "utf8")));
    else console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}
