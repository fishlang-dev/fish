import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatReport, survey } from "../src/survey.ts";

const sample = join(import.meta.dir, "survey", "sample");
const count = (id: string) => survey(sample).rules.find((r) => r.id === id)?.count ?? 0;

test("survey reads TypeScript files, skipping dependencies and declarations", () => {
  const r = survey(sample);
  expect(r.files).toBe(3);
  expect(r.rules.flatMap((x) => x.examples.map((e) => e.file)).every((f) => f.startsWith("src/") && !f.includes(".d.ts"))).toBe(true);
});

test("each rule counts what the sample shows", () => {
  const expected: Record<string, number> = {
    parse: 1, R1: 1, R2: 1, R3: 1, modules: 2, destructuring: 1, defaults: 1, declarators: 1, tuples: 1,
    spread: 1, arrayMethods: 3, collections: 1, regex: 1, forIn: 1, decorators: 1, genericMethods: 1,
    classForms: 1, math: 1, process: 1, fetch: 1, timers: 1, stderr: 1, json: 1, nestedFunctions: 1,
    G1: 3, G4: 1, G5: 1, G6: 1, G7: 1, G8: 1, G10: 1, A1: 1, A2: 1, A3: 1, A4: 1, A8: 1, A9: 1,
  };
  const got = Object.fromEntries(Object.keys(expected).map((id) => [id, count(id)]));
  expect(got).toEqual(expected);
});

test("the score weighs blockers over guided rewrites, and auto-fixes not at all", () => {
  const r = survey(sample);
  const weighted = 10 * (r.counts.reject + r.counts.unsupported) + 3 * r.counts.guided;
  expect(r.score).toBe(Math.round((weighted * 1000) / r.lines * 10) / 10);
  expect(r.grade).toBe("F");
  expect(r.rules[0]!.action === "reject" || r.rules[0]!.action === "unsupported").toBe(true);
});

test("a project with nothing to port grades A", () => {
  const dir = mkdtempSync(join(tmpdir(), "survey-"));
  try {
    writeFileSync(join(dir, "main.ts"), "function main(): void {\n  const x: number = 1;\n  console.log(x + 1);\n}\n");
    const r = survey(dir);
    expect(r.grade).toBe("A");
    expect(formatReport(r)).toContain("grade A (score 0 per 1000 lines)");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
