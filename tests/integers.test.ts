import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "../src/parser.ts";

// The compiler's source names its numbers with Fish's types (src/fish.d.ts aliases them for
// tsc), because Fish reads `number` as `f64`, which can't index an array or mix with a length.
const SRC = join(import.meta.dir, "..", "src");

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
  expect(files.map((f) => [f, numberTypes(f)] as const).filter(([, n]) => n > 0)).toEqual([]);
});
