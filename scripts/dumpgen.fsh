// Writes `tests/selfhost/dump.ts`, which prints a parsed tree in full, from the parser's own AST
// types; the generator is `gen/dumpgen.fsh`, which the other generators and the tests import.
//   fishc run scripts/dumpgen.fsh
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { type CompileError } from "../src/diag.fsh";
import { dumperSource, parserSource } from "./gen/dumpgen.fsh";

function main(): void throws Error | CompileError | IoError {
  writeFileSync(join(import.meta.dir, "..", "tests", "selfhost", "dump.ts"), dumperSource(parserSource()));
}
