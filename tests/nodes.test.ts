import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { check } from "../src/check.ts";
import { CompileError } from "../src/diag.ts";
import { expandMacros } from "../src/macros.ts";
import { flatten, load } from "../src/modules.ts";
import { NodeMap, NodeSet, WeakNodeMap, WeakNodeSet } from "../src/nodes.ts";
import { parse, type Stmt } from "../src/parser.ts";
import { stdFor } from "../src/std.ts";
import { stripTests } from "../src/tests.ts";

const src = join(import.meta.dir, "..", "src");
const programs = join(import.meta.dir, "programs");

// Every node reachable from `roots`, an object with a span, has an id, and no two objects share
// one. `ids` is shared between calls, since ids are unique in the whole process.
function audit(roots: unknown, ids: Map<number, object>, where: string): string[] {
  const problems: string[] = [];
  const visited = new Set<object>();
  const visit = (v: unknown) => {
    if (typeof v !== "object" || v === null || visited.has(v)) return;
    visited.add(v);
    if (Array.isArray(v)) return v.forEach(visit);
    const n = v as Record<string, unknown>;
    if (typeof n.start === "number" && typeof n.end === "number") {
      const at = `${where}: a ${String(n.kind ?? "node")} at ${n.start}`;
      if (typeof n.id !== "number") problems.push(`${at} has no id`);
      else if (ids.has(n.id) && ids.get(n.id) !== n) problems.push(`${at} shares id ${n.id} with another node`);
      else ids.set(n.id, n);
    }
    Object.values(n).forEach(visit);
  };
  visit(roots);
  return problems;
}

// Each program of tests/programs, a case of a file written out on its own as the test runner
// writes it.
function corpus(): { name: string; file: string; src: string }[] {
  const cases = mkdtempSync(join(tmpdir(), "fish-nodes-"));
  const found: { name: string; file: string; src: string }[] = [];
  for (const entry of readdirSync(programs).sort()) {
    const file = entry.endsWith(".fsh") ? join(programs, entry) : join(programs, entry, "main.fsh");
    if (!existsSync(file)) continue;
    const text = readFileSync(file, "utf8");
    if (!entry.endsWith(".fsh") || !/^\/\/ case: /m.test(text)) {
      found.push({ name: entry, file, src: text });
      continue;
    }
    for (const part of text.split(/^\/\/ case: /m).slice(1)) {
      const [name, ...lines] = part.split("\n");
      const file = join(cases, `${name!.trim()}.fsh`);
      writeFileSync(file, lines.join("\n"));
      found.push({ name: `${entry} > ${name!.trim()}`, file, src: lines.join("\n") });
    }
  }
  return found;
}

test("every node of the compiler's own source has an id of its own", () => {
  const ids = new Map<number, object>();
  const problems = readdirSync(src).filter((f) => f.endsWith(".ts")).flatMap((f) => audit(parse(readFileSync(join(src, f), "utf8")), ids, f));
  expect(problems).toEqual([]);
});

test("every node of the test programs, parsed, expanded and checked, has an id of its own", () => {
  const ids = new Map<number, object>();
  const problems: string[] = [];
  for (const p of corpus()) {
    let written: Stmt[] = [];
    try {
      if (p.src.includes("// mode: parse")) {
        problems.push(...audit(parse(p.src), ids, p.name));
        continue;
      }
      const loaded = load(p.file, p.src);
      stripTests(loaded);
      expandMacros(loaded, false, (macros) => check(macros, false, true));
      written = flatten(loaded, false);
      problems.push(...audit([written, stdFor(written)], ids, p.name));
      check(written);
    } catch (e) {
      if (!(e instanceof CompileError)) throw new Error(`${p.name}: ${e instanceof Error ? e.message : e}`);
    }
    // Checking rewrites parts of the tree in place, and those parts need ids too.
    problems.push(...audit(written, ids, `${p.name}, checked`));
  }
  expect(problems.slice(0, 20)).toEqual([]);
}, 120_000);

test("a node table refuses a second node with an id already in use", () => {
  const a = { id: 1, kind: "a" };
  const b = { id: 1, kind: "b" };
  const map = new NodeMap<{ id: number }, string>().set(a, "a");
  expect(map.get(a)).toBe("a");
  expect(() => map.get(b)).toThrow("internal error: two nodes share id 1");
  const set = new NodeSet<{ id: number }>([a]);
  expect(() => set.add(b)).toThrow("internal error: two nodes share id 1");
  expect(() => set.has({ kind: "c" } as unknown as { id: number })).toThrow("has no id");
  const weak = new WeakNodeMap<{ id: number }, string>().set(a, "a");
  expect(weak.get(a)).toBe("a");
  expect(() => weak.has(b)).toThrow("internal error: two nodes share id 1");
  expect(() => new WeakNodeSet<{ id: number }>().add(a).add(b)).toThrow("internal error: two nodes share id 1");
});

// The AST types a table may not be keyed by: every type in src/parser.ts carrying `Id`, and any
// alias a file gives one, as `type Arrow = Extract<Expr, ...>`, `type Decl = Stmt & ...` or
// `Func as Declared`. Tables
// keyed by `object` or `unknown` are left out: they key reflective walks over any value, arrays
// and non-node objects included.
test("no Map, WeakMap, Set or WeakSet in src is keyed by an AST node", () => {
  const parser = readFileSync(join(src, "parser.ts"), "utf8");
  const nodes = [...parser.matchAll(/^export type (\w+) = Span & Id\b/gm)].map((m) => m[1]!);
  expect(nodes).toContain("Expr");
  const offenders: string[] = [];
  for (const f of readdirSync(src).filter((f) => f.endsWith(".ts"))) {
    const text = readFileSync(join(src, f), "utf8");
    const names = [...nodes];
    const alias = new RegExp(`\\b(?:type (\\w+) = (?:(?:Extract|Exclude)<(?:${names.join("|")}),|(?:${names.join("|")}) [&|;])|(?:${names.join("|")}) as (\\w+))`, "g");
    for (const m of text.matchAll(alias)) names.push(m[1] ?? m[2]!);
    const keyed = new RegExp(`\\b(?:Weak)?(?:Map|Set)<\\s*(?:(?:Extract|Exclude)<\\s*)?(?:${names.join("|")}|Span)\\b(?!\\[)`, "g");
    for (const m of text.matchAll(keyed)) offenders.push(`${f}: ${m[0]}`);
  }
  expect(offenders).toEqual([]);
});
