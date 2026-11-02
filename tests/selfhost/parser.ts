import { readFileSync } from "node:fs";
import { CompileError } from "../../src/diag.ts";
import { parse } from "../../src/parser.ts";
import type { Ids } from "../../src/ids.ts";
import { dumpStmt } from "./dump.ts";

// Parses each file named on the command line through src/parser.ts and prints every tree in full.
// Run by Bun and built by fishc, the two outputs must match.

/** @throws {IoError} */
export function main(): void {
  // As in Node, the arguments start at argv[2], after the runtime and the program.
  for (const file of process.argv.slice(2)) {
    console.log(`file ${file}`);
    const src = readFileSync(file, "utf8");
    let ids: Ids = { last: 0 };
    try {
      for (const s of parse(src, ids)) dumpStmt("", "-", s);
    } catch (e) {
      const error = e as CompileError;
      console.log(`error ${error.start} ${error.end} ${error.message}`);
    }
  }
}
