import { expect, setDefaultTimeout, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { shared } from "../src/compilation.ts";
import { parse, type Expr, type Param, type Stmt } from "../src/parser.ts";
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
    walk(parse(readFileSync(join(SRC, f), "utf8"), shared.ids));
  }
  expect(untyped).toEqual([]);
});

// Fish refuses a top-level `let`, and a `const` is deeply immutable, so the front end and the
// checker keep no state of their own: no top-level `let`, and no table a top-level `const` holds
// is changed after load, in its own file or in one importing it. Their callers hand them what
// they need.
const FRONT_END = ["diag.ts", "nodes.ts", "lexer.ts", "parser.ts", "expressions.ts", "types.ts", "patterns.ts", "declarations.ts", "regex.ts"];
const CHECKER = ["check.ts", "values.ts", "typing.ts", "classes.ts", "generics.ts", "resolve.ts", "typefns.ts", "operators.ts", "interfaces.ts", "flow.ts", "narrow.ts", "match.ts", "moves.ts", "comptime.ts", "unions.ts", "enums.ts", "registry.ts", "unsupported.ts", "defaults.ts", "locals.ts", "macros.ts", "quote.ts"];
const STATELESS = [...FRONT_END, ...CHECKER];
const MUTATORS = new Set(["set", "add", "delete", "clear", "push", "pop", "shift", "unshift", "splice", "sort", "reverse", "fill", "copyWithin"]);

const topLevel = (program: Stmt[]) => program.map((s) => (s.kind === "export" ? s.body : s));

// Where `program` declares a top-level `let` or `var`.
function topLevelLets(program: Stmt[]): number[] {
  return topLevel(program).flatMap((d) => (d.kind === "let" && d.keyword !== "const" ? [d.start] : []));
}

// The names of the tables `program` holds in top-level constants: maps, sets, arrays and objects.
function tablesOf(program: Stmt[]): string[] {
  return topLevel(program).flatMap((d) => (d.kind !== "let" ? [] : d.declarations.flatMap((x) => (x.target.kind === "ident" && x.init && ["new", "array", "object"].includes(x.init.kind) ? [x.target.name] : []))));
}

// Each change `program` makes to a name in `tables`, through a method or an assignment, as
// `name at offset`.
function tableChanges(program: Stmt[], tables: Set<string>): string[] {
  const found: string[] = [];
  const root = (e: Expr): string | undefined => (e.kind === "ident" ? e.name : e.kind === "member" || e.kind === "index" ? root(e.object) : undefined);
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (!v || typeof v !== "object") return;
    const e = v as Expr;
    const changed = e.kind === "call" && e.callee.kind === "member" && MUTATORS.has(e.callee.name) ? root(e.callee.object)
      : e.kind === "assign" && e.target.kind !== "ident" ? root(e.target)
      : e.kind === "update" && e.operand.kind !== "ident" ? root(e.operand)
      : undefined;
    if (changed !== undefined && tables.has(changed)) found.push(`'${changed}' at ${e.start}`);
    Object.values(v).forEach(walk);
  };
  walk(program);
  return found;
}

test("the front end and the checker keep no module state", () => {
  const programs = new Map(readdirSync(SRC).filter((f) => f.endsWith(".ts")).map((f) => [f, parse(readFileSync(join(SRC, f), "utf8"), shared.ids)] as const));
  const tables = new Map(STATELESS.map((f) => [f, new Set(tablesOf(programs.get(f)!))]));
  const found: string[] = [];
  for (const [f, program] of programs) {
    if (STATELESS.includes(f)) found.push(...topLevelLets(program).map((at) => `${f}: a top-level 'let' at ${at}`));
    // The tables of those files this one can reach: its own, and those it imports.
    const reached = new Set(tables.get(f));
    for (const s of program) {
      const from = s.kind === "import" && s.module.startsWith("./") ? tables.get(s.module.slice(2)) : undefined;
      if (s.kind === "import" && from) for (const n of s.named ?? []) if (from.has(n.name)) reached.add(n.alias ?? n.name);
    }
    found.push(...tableChanges(program, reached).map((c) => `${f}: ${c} changes a module's table`));
  }
  expect(found).toEqual([]);
});
