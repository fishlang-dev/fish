import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "../src/parser.ts";

// The compiler's source names its numbers with Fish's types (src/integers.d.ts aliases them for
// tsc), because Fish reads `number` as `f64`, which can't index an array or mix with a length.
const SRC = join(import.meta.dir, "..", "src");

// Files still writing `number`, with how many times; a count may only fall.
const ALLOWED: Record<string, number> = {
  "bundle.ts": 5, "check.ts": 19, "codegen.ts": 72, "comments.ts": 26, "compilation.ts": 14, "comptime.ts": 27,
  "declarations.ts": 3, "dependencies.ts": 2, "deps.ts": 3, "diag.ts": 10, "doc.ts": 6, "enums.ts": 5,
  "expressions.ts": 8, "fmt.ts": 6, "generics.ts": 7, "js.ts": 2, "layout.ts": 7, "lexer.ts": 14,
  "locals.ts": 1, "lsp.ts": 7, "macros.ts": 5, "main.ts": 4, "manifest.ts": 10, "match.ts": 2,
  "mathlib.ts": 1, "migrate.ts": 35, "modules.ts": 25, "moves.ts": 22, "narrow.ts": 1, "nodes.ts": 13,
  "parser.ts": 13, "printer.ts": 15, "publish.ts": 6, "quote.ts": 13, "rank.ts": 22, "regex.ts": 57,
  "registry.ts": 1, "resolve.ts": 1, "semver.ts": 12, "split.ts": 2, "suggest.ts": 3, "survey.ts": 45,
  "tar.ts": 15, "tests.ts": 7, "typefns.ts": 3, "typing.ts": 10, "values.ts": 19, "warnings.ts": 3,
};

// Type nodes naming `number`, found by walking the parsed tree's plain objects.
function numberTypes(file: string): number {
  let count = 0;
  const seen = new Set<object>();
  const visit = (node: unknown): void => {
    if (typeof node !== "object" || node === null || seen.has(node)) return;
    seen.add(node);
    if ("kind" in node && node.kind === "ref" && "name" in node && node.name === "number") count++;
    for (const value of Object.values(node)) visit(value);
  };
  visit(parse(readFileSync(join(SRC, file), "utf8"), { last: 0 }));
  return count;
}

test("the compiler's source writes Fish's number types, not number", () => {
  const files = readdirSync(SRC).filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts")).sort();
  const over = files.map((f) => [f, numberTypes(f)] as const).filter(([f, n]) => n > (ALLOWED[f] ?? 0));
  expect(over).toEqual([]);
});
