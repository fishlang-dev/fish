import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CODES, explain } from "../src/codes.ts";
import { newSession } from "../src/compilation.ts";
import { CompileError } from "../src/diag.ts";
import { analyze } from "../src/main.ts";
import { parse, type Expr } from "../src/parser.ts";

const SRC = join(import.meta.dir, "..", "src");
const dir = mkdtempSync(join(tmpdir(), "fish-codes-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

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

// The codes `src` is refused with, or warned with, when checked as a program.
function codesOf(name: string, src: string): { error?: string; warnings: string[] } {
  const file = join(dir, `${name}.fsh`);
  writeFileSync(file, src);
  try {
    return { warnings: analyze(newSession(), src, file).checked.warnings.map((w) => w.code) };
  } catch (e) {
    if (!(e instanceof CompileError)) throw e;
    return { error: e.code, warnings: [] };
  }
}

test("each explanation's example fails with its code, and its fixed program compiles without it", () => {
  const explained = Object.entries(CODES).filter(([, c]) => c.long);
  expect(explained.length).toBeGreaterThanOrEqual(20);
  const seen = explained.map(([code, { long }]) => {
    const example = codesOf(`${code}-example`, long!.example);
    const fixed = codesOf(`${code}-fixed`, long!.fixed);
    return [code, code.startsWith("W") ? example.warnings.find((w) => w === code) : example.error, fixed.error ?? fixed.warnings.find((w) => w === code)];
  });
  expect(seen).toEqual(explained.map(([code]) => [code, code, undefined]));
});

test("explain gives a code's explanation, its title alone when it has none, and nothing for an unknown code", () => {
  expect(explain("e0201")!.split("\n")[0]).toBe("E0201: use of a moved value");
  expect(explain("E0201")).toContain("\nFor example, this fails:\n\n    function main() {\n");
  expect(explain("W0001")).toContain("For example, this warns:");
  expect(explain("E0110")).toBe("E0110: a number that doesn't fit its type\n\nThis code has no longer explanation yet; its message says what went wrong and what to change.");
  expect(explain("E9999")).toBeUndefined();
});
