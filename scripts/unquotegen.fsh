// Writes `src/unquote.fsh` from the parser's own AST types; the generator is `gen/unquotegen.fsh`,
// which the tests import.
//   fishc run scripts/unquotegen.fsh
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { type CompileError } from "../src/diag.fsh";
import { parserSource } from "./gen/dumpgen.fsh";
import { unquoteSource } from "./gen/unquotegen.fsh";

function main(): void throws Error | CompileError | IoError {
  writeFileSync(join(import.meta.dir, "..", "src", "unquote.fsh"), unquoteSource(parserSource()));
}
