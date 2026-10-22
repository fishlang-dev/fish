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

export type Panic = "unwind" | "abort";

export function compile(src: string, file: string, release = false, panic: Panic = "unwind"): string {
  return codegen(check(parse(src)), { src, file, release, panic });
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
    const clang = Bun.spawnSync(["clang", "-x", "ir", "-", "-x", "c", native, "-funwind-tables", "-o", out, release ? "-O2" : "-O0", "-lm", ...links.map((l) => `-l${l}`)], {
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
      panic: { type: "string", default: "unwind" },
      link: { type: "string", multiple: true },
    },
  });
  const [command, file] = positionals;
  const panic = values.panic as Panic;
  if (command !== "build" || !file || (panic !== "unwind" && panic !== "abort")) {
    console.error("usage: fishc build <file.fsh> [-o <out>] [--release] [--panic=unwind|abort] [--link <library>]... [--emit-llvm]");
    process.exit(2);
  }
  try {
    if (values["emit-llvm"]) process.stdout.write(compile(readFileSync(file, "utf8"), file, values.release, panic));
    else build(file, values.out ?? basename(file, ".fsh"), values.release, panic, values.link ?? []);
  } catch (e) {
    if (e instanceof CompileError) console.error(formatError(e, file, readFileSync(file, "utf8")));
    else console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}
