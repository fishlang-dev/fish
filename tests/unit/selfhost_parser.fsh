// The tree-printer comparison from tests/selfhost_parser.test.ts, which left it once dumpgen was
// Fish. Its parser-corpus test compares a fishc-built driver with the same driver under Bun, so it
// stays a Bun test.
import { join } from "node:path";
import { dumperSource, parserSource } from "../../scripts/gen/dumpgen.fsh";
import { read, root, same } from "./support.fsh";

test("the tree printer is generated from the parser's current AST types; run 'fishc run scripts/dumpgen.fsh' when it isn't", () => {
  try {
    same(read(join(root(), "tests", "selfhost", "dump.ts")), dumperSource(parserSource()), "tests/selfhost/dump.ts");
  } catch (e) {
    assert(false, e.message);
  }
});
