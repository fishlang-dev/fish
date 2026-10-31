import { expect, setDefaultTimeout, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse, type Expr, type Param } from "../src/parser.ts";
import { BASELINE, survey, type Baseline } from "../scripts/selfhost.ts";

setDefaultTimeout(300_000);

const SRC = join(import.meta.dir, "..", "src");

// The compiler's own source may only get closer to checking with Fish: a file that checked keeps
// checking, and the failing count never rises.
test("no compiler source file that checked with Fish stops checking", () => {
  const baseline = JSON.parse(readFileSync(BASELINE, "utf8")) as Baseline;
  const now = survey();
  const regressed = Object.keys(now).filter((f) => now[f] !== null && !(f in baseline.failing));
  expect(regressed).toEqual([]);
  const count = Object.values(now).filter((e) => e !== null).length;
  expect(count).toBeLessThanOrEqual(baseline.count);
  if (count < baseline.count) console.log(`self-hosting: ${baseline.count - count} more file(s) check; run 'bun scripts/selfhost.ts --update' to lower the baseline`);
});

// Fish takes a default's type from a number, string or boolean literal only; any other default
// in the compiler says its type, so the compiler's own source can be checked with Fish.
test("every default parameter in the compiler's source has a type Fish can read", () => {
  const literal = (e: Expr): boolean => e.kind === "int" || e.kind === "float" || e.kind === "string" || e.kind === "bool" || (e.kind === "template" && e.exprs.length === 0) || (e.kind === "unary" && e.op === "-" && literal(e.operand));
  const untyped: string[] = [];
  for (const f of readdirSync(SRC).filter((f) => f.endsWith(".ts"))) {
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) return v.forEach(walk);
      if (!v || typeof v !== "object") return;
      const p = v as Partial<Param>;
      if (p.pattern && p.default && !p.type && !literal(p.default)) untyped.push(`${f}: ${(p.pattern as { name?: string }).name}`);
      Object.values(v).forEach(walk);
    };
    walk(parse(readFileSync(join(SRC, f), "utf8")));
  }
  expect(untyped).toEqual([]);
});
