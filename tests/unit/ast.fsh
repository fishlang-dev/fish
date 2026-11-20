import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AST } from "../../src/ast.fsh";
import { astDeclarations } from "../../src/astgen.fsh";

// A test that can't read the parser's source fails there.
function parserSource(): string {
  try {
    return readFileSync(join(import.meta.dir, "..", "..", "src", "parser.fsh"), "utf8");
  } catch (e) {
    assert(false, `can't read src/parser.fsh: ${e.message}`);
    return "";
  }
}

test("the Ast declarations match the parser's AST types; run 'bun src/astgen.fsh' when they don't", () => {
  let generated = "";
  try {
    generated = astDeclarations(parserSource());
  } catch (e) {
    assert(false, `astgen failed: ${e.message}`);
  }
  assert(AST.trimStart() === generated, "src/ast.fsh is out of date with src/parser.fsh");
});

test("every kind the parser makes has an Ast type", () => {
  for (const m of parserSource().matchAll(/kind: "(\w+)"/g)) {
    const kind = m[1]!;
    assert(AST.includes(`kind: "${kind}"`), `no Ast type has kind: "${kind}"`);
  }
});
