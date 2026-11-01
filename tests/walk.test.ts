import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { walkerSource, WALK } from "../scripts/walkgen.ts";
import { Rewrites } from "../src/ids.ts";
import { childrenOf, walk } from "../src/nodes.ts";
import { parse, parseExpression, type Expr } from "../src/parser.ts";
import { rebuiltExpr } from "../src/walk.ts";

const ROOT = join(import.meta.dir, "..");

test("the walkers are generated from the parser's current AST types; run 'bun scripts/walkgen.ts' when they aren't", () => {
  expect(readFileSync(WALK, "utf8")).toBe(walkerSource(readFileSync(join(ROOT, "src", "parser.ts"), "utf8")));
});

// Every object with an id under `roots`, found by reading every field, as a walk once did.
function everyNode(roots: unknown[]): Set<object> {
  const found = new Set<object>();
  const seen = new Set<unknown>();
  const visit = (v: unknown): void => {
    if (typeof v !== "object" || v === null || seen.has(v)) return;
    seen.add(v);
    if (!Array.isArray(v) && typeof (v as { id?: unknown }).id === "number") found.add(v);
    Object.values(v).forEach(visit);
  };
  roots.forEach(visit);
  return found;
}

// A field the types leave out would hide what it holds from every walk.
test("a walk reaches every node of every test program and compiler source file", () => {
  const programs = readdirSync(join(ROOT, "tests", "programs"), { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith(".fsh")).map((f) => join(ROOT, "tests", "programs", f));
  const sources = readdirSync(join(ROOT, "src")).filter((f) => f.endsWith(".ts")).map((f) => join(ROOT, "src", f));
  let parsed = 0;
  for (const file of [...programs, ...sources]) {
    let program;
    try {
      program = parse(readFileSync(file, "utf8"), { last: 0 });
    } catch {
      continue;
    }
    parsed++;
    const reached = new Set<object>();
    walk("stmt", program, ({ node }) => void reached.add(node));
    const missed = [...everyNode(program)].filter((n) => !reached.has(n)).map((n) => `${file}: a ${(n as { kind?: string }).kind ?? "node"} at ${(n as { start: number }).start}`);
    expect(missed.slice(0, 5)).toEqual([]);
  }
  expect(parsed).toBeGreaterThan(300);
});

test("children come in the order their type lists the fields, each list of statements whole", () => {
  const e = parseExpression("f<T>(a, () => { g(); })", { last: 0 });
  expect(childrenOf({ of: "expr", node: e }).map((c) => (c.of === "stmts" ? "stmts" : `${c.of} ${(c.node as { kind: string }).kind}`))).toEqual(["expr ident", "typeNode ref", "expr ident", "expr arrow"]);
  const arrow = e.kind === "call" ? e.args[1]! : e;
  expect(childrenOf({ of: "expr", node: arrow }).map((c) => c.of)).toEqual(["stmts"]);
  // A walk goes through a list without handing it over, and skips what is under a node it refuses.
  const kinds: string[] = [];
  walk("expr", e, ({ node }) => {
    kinds.push((node as { kind: string }).kind);
    return (node as { kind: string }).kind !== "arrow";
  });
  expect(kinds).toEqual(["call", "ident", "ref", "ident", "arrow"]);
});

test("a rebuild puts each replacement where its node was, under that node's id, replacements within replacements too", () => {
  const ids = { last: 0 };
  const e = parseExpression("f(a, g(b))", ids);
  if (e.kind !== "call") throw new Error("not a call");
  const [a, inner] = e.args as [Expr, Expr];
  if (inner.kind !== "call") throw new Error("not a call");
  const r = new Rewrites();
  const by = r.replace(inner, { ...inner, id: 0, args: [...inner.args] });
  const c = r.replace(inner.args[0]!, { id: 0, kind: "ident" as const, name: "c", start: 0, end: 0 });
  expect(r.current(inner)).toBe(by);
  expect(rebuiltExpr(e, r)).toBe(e);
  expect(e.args).toEqual([a, by]);
  expect(by.id).toBe(inner.id);
  expect((by as typeof inner).args[0]).toBe(c);
});
