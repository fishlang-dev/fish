import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AST } from "../src/ast.ts";
import { astDeclarations } from "../src/astgen.ts";

test("the Ast declarations match the parser's AST types; run 'bun src/astgen.ts' when they don't", () => {
  expect(AST.trimStart()).toBe(astDeclarations(readFileSync(join(import.meta.dir, "..", "src", "parser.ts"), "utf8")));
});

test("every kind the parser makes has an Ast type", () => {
  const kinds = new Set([...readFileSync(join(import.meta.dir, "..", "src", "parser.ts"), "utf8").matchAll(/kind: "(\w+)"/g)].map((m) => m[1]));
  for (const kind of kinds) expect(AST).toContain(`kind: "${kind}"`);
});
