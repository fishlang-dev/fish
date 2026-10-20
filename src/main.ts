#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { parseArgs } from "node:util";
import { codegen } from "./codegen.ts";
import { CompileError, formatError } from "./diag.ts";
import { parse } from "./parser.ts";

export function compile(src: string): string {
  return codegen(parse(src));
}

// Compiles `file` to a native executable at `out`, piping the IR through clang.
export function build(file: string, out: string, release = false) {
  const ir = compile(readFileSync(file, "utf8"));
  const clang = Bun.spawnSync(["clang", "-x", "ir", "-", "-o", out, release ? "-O2" : "-O0"], {
    stdin: new TextEncoder().encode(ir),
  });
  if (clang.exitCode !== 0) throw new Error(`clang failed:\n${clang.stderr.toString()}`);
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
    if (values["emit-llvm"]) process.stdout.write(compile(readFileSync(file, "utf8")));
    else build(file, values.out ?? basename(file, ".fsh"), values.release);
  } catch (e) {
    if (e instanceof CompileError) console.error(formatError(e, file, readFileSync(file, "utf8")));
    else console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}
