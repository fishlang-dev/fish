// Ports tests/selfhost.test.ts. The baseline survey waits on scripts/selfhost.ts becoming Fish. Where the Bun tests find nodes by
// reading every field, these walk the tree with the generated walker.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { walk } from "../../src/nodes.fsh";
import { parse, type Expr, type Stmt } from "../../src/parser.fsh";
import { read, root } from "./support.fsh";

function srcDir(): string {
  return join(root(), "src");
}

// src's Fish files.
function sources(): string[] {
  try {
    return readdirSync(srcDir()).filter((f) => f.endsWith(".fsh"));
  } catch (e) {
    assert(false, e.message);
    return [];
  }
}

// `f` parsed, or nothing with the failure added to `failed`.
function parsed(f: string, failed: Mut<string[]>): Stmt[] {
  try {
    return parse(read(join(srcDir(), f)), { last: 0 });
  } catch (e) {
    failed.push(`${f}: ${e.message}`);
    return [];
  }
}

function literal(e: Ref<Expr>): boolean {
  if (e.kind === "template") return e.exprs.length === 0;
  if (e.kind === "unary") return e.op === "-" && literal(e.operand);
  return e.kind === "int" || e.kind === "float" || e.kind === "string" || e.kind === "bool";
}

// Fish takes a default's type from a number, string or boolean literal only; any other default
// in the compiler says its type, so the compiler's own source can be checked with Fish.
test("every default parameter in the compiler's source has a type Fish can read", () => {
  let untyped: string[] = [];
  for (const f of sources()) {
    const program = parsed(f, untyped);
    walk({ of: "stmts", node: program }, (n) => {
      if (n.of !== "param") return;
      const p = n.node;
      if (p.default === undefined || p.type !== undefined || literal(p.default)) return;
      untyped.push(`${f}: ${p.pattern.kind === "ident" ? p.pattern.name : "undefined"}`);
    });
  }
  assert(untyped.length === 0, untyped.join("\n"));
}, { timeout: 7_200_000 });

// Fish refuses a top-level `let`, and a `const` is deeply immutable, so the compiler keeps no
// state of its own: no file has a top-level `let`, and no table a top-level `const` holds is
// changed after load, in its own file or in one importing it. A compilation, or the session or
// run that outlives it, holds what changes, and is handed to what needs it.
function mutator(name: string): boolean {
  return ["set", "add", "delete", "clear", "push", "pop", "shift", "unshift", "splice", "sort", "reverse", "fill", "copyWithin"].includes(name);
}

// A top-level declaration, seen through `export`.
function declared(s: Ref<Stmt>): Ref<Stmt> {
  return s.kind === "export" ? s.body : s;
}

// Where `program` declares a top-level `let` or `var`.
function topLevelLets(program: Ref<Stmt[]>): usize[] {
  let found: usize[] = [];
  for (const s of program) {
    const d = declared(s);
    if (d.kind === "let" && d.keyword !== "const") found.push(d.start);
  }
  return found;
}

// The names of the tables `program` holds in top-level constants: maps, sets, arrays and objects.
function tablesOf(program: Ref<Stmt[]>): Set<string> {
  let found = new Set<string>();
  for (const s of program) {
    const d = declared(s);
    if (d.kind !== "let") continue;
    for (const x of d.declarations) {
      if (x.target.kind !== "ident" || x.init === undefined) continue;
      const k = x.init.kind;
      if (k === "new" || k === "array" || k === "object") found.add(x.target.name);
    }
  }
  return found;
}

// The name an expression reaches through members and indexes, or "" for none.
function rootName(e: Ref<Expr>): string {
  if (e.kind === "ident") return e.name;
  if (e.kind === "member" || e.kind === "index") return rootName(e.object);
  return "";
}

// The name `e` changes, through a method or an assignment, or "" for none.
function changed(e: Ref<Expr>): string {
  if (e.kind === "call") return e.callee.kind === "member" && mutator(e.callee.name) ? rootName(e.callee.object) : "";
  if (e.kind === "assign") return e.target.kind !== "ident" ? rootName(e.target) : "";
  if (e.kind === "update") return e.operand.kind !== "ident" ? rootName(e.operand) : "";
  return "";
}

// Each change `program` makes to a name in `tables`, as `name at offset`.
function tableChanges(program: Ref<Stmt[]>, tables: Ref<Set<string>>): string[] {
  let found: string[] = [];
  walk({ of: "stmts", node: program }, (n) => {
    if (n.of !== "expr") return;
    const name = changed(n.node);
    if (name !== "" && tables.has(name)) found.push(`'${name}' at ${n.node.start}`);
  });
  return found;
}

test("the compiler keeps no module state", () => {
  let found: string[] = [];
  let programs = new Map<string, Stmt[]>();
  for (const f of sources()) programs.set(f, parsed(f, found));
  let tables = new Map<string, Set<string>>();
  for (const [f, program] of programs) tables.set(f, tablesOf(program));
  for (const [f, program] of programs) {
    for (const at of topLevelLets(program)) found.push(`${f}: a top-level 'let' at ${at}`);
    // The tables of those files this one can reach: its own, and those it imports.
    let reached = tables.get(f)!.clone();
    for (const s of program) {
      if (s.kind !== "import" || !s.module.startsWith("./") || s.named === undefined) continue;
      const from = s.module.slice(2);
      if (!tables.has(from)) continue;
      for (const n of s.named) {
        if (tables.get(from)!.has(n.name)) reached.add(n.alias ?? n.name);
      }
    }
    for (const c of tableChanges(program, reached)) found.push(`${f}: ${c} changes a module's table`);
  }
  assert(found.length === 0, found.join("\n"));
}, { timeout: 7_200_000 });
