// Writes `src/walk.ts` and `src/rebuild.ts` from the parser's own AST types; the generator is
// `gen/walkgen.fsh`, which the tests import.
//   fishc run scripts/walkgen.fsh
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { type CompileError } from "../tests/compiler/diag.fsh";
import { parserSource } from "./gen/dumpgen.fsh";
import { walkSources } from "./gen/walkgen.fsh";

function main(): void throws Error | CompileError | IoError {
  const both = walkSources(parserSource());
  writeFileSync(join(import.meta.dir, "..", "src", "walk.ts"), both[0]!);
  writeFileSync(join(import.meta.dir, "..", "src", "rebuild.ts"), both[1]!);
}
