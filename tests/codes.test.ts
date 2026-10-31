import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CODES } from "../src/codes.ts";
import { parse, type Expr } from "../src/parser.ts";

const SRC = join(import.meta.dir, "..", "src");

// The code each `new CompileError` in the compiler's source gives, as written: a code literal, a
// choice between code literals, or another error's `.code` passed on.
function codesGiven(): { site: string; codes: string[] | undefined }[] {
  const found: { site: string; codes: string[] | undefined }[] = [];
  const codesOf = (e: Expr | undefined): string[] | undefined =>
    e?.kind === "string" ? [e.value] : e?.kind === "conditional" ? [codesOf(e.then), codesOf(e.else)].every((c) => c) ? [...codesOf(e.then)!, ...codesOf(e.else)!] : undefined : e?.kind === "member" && e.name === "code" ? [] : undefined;
  for (const f of readdirSync(SRC).filter((f) => f.endsWith(".ts"))) {
    const text = readFileSync(join(SRC, f), "utf8");
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) return v.forEach(walk);
      if (!v || typeof v !== "object") return;
      const e = v as Expr;
      if (e.kind === "new" && e.callee.kind === "ident" && e.callee.name === "CompileError") {
        found.push({ site: `${f}:${text.slice(0, e.start).split("\n").length}`, codes: codesOf(e.args?.[0]) });
      }
      Object.values(v).forEach(walk);
    };
    walk(parse(text, { last: 0 }));
  }
  return found;
}

test("every CompileError the compiler makes names a code the table has", () => {
  const sites = codesGiven();
  expect(sites.length).toBeGreaterThan(1000);
  expect(sites.filter((s) => s.codes === undefined || s.codes.some((c) => !(c in CODES))).map((s) => s.site)).toEqual([]);
});

test("every code in the table is given somewhere, and is numbered in its area", () => {
  const used = new Set(codesGiven().flatMap((s) => s.codes ?? []));
  expect(Object.keys(CODES).filter((c) => !used.has(c))).toEqual([]);
  expect(Object.keys(CODES).filter((c) => !/^(E(0\d|1[01])\d\d|W0\d\d\d)$/.test(c))).toEqual([]);
  expect(Object.values(CODES).filter((c) => c.title === "" || c.title.endsWith("."))).toEqual([]);
});
