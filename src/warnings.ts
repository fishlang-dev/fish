import { bodyOf, type InstanceId, type LocalId } from "./arenas.ts";
import type { Body, Instance } from "./check.ts";
import type { Tables } from "./compilation.ts";
import { CompileError } from "./diag.ts";
import { walk, type AnyNode } from "./nodes.ts";
import { nodeIdOf } from "./walk.ts";
import type { Declarator, Expr, ObjectProp, Param, Pattern, Stmt } from "./parser.ts";
import { STD_BASE } from "./std.ts";

// What the compiler reports without failing the build: variables and parameters nothing reads,
// and statements control can never reach.

// Marks every node of a tree a macro made as `generated`, which no warning points into: their
// author can't change them.
export function markGenerated(generated: Mut<Tables["generated"]>, root: AnyNode) {
  walk(root, (n) => {
    const id = nodeIdOf(n);
    if (id >= 0) generated.add({ id: id as usize });
  });
}

// The warnings for a checked program, in source order. `required` says whether a body's parameters
// are a signature's to decide, as an export's, an override's or an interface method's are.
// `declarations` are the `let` statements and parameters that declare a name, as the checker met
// them; every other node an instance's `locals` holds is a use of one.
export function warnings(tables: Ref<Tables>, compiled: Ref<InstanceId[]>, required: (b: Ref<Body>) => boolean): CompileError[] {
  let used = new Set<LocalId>();
  for (const id of compiled) {
    const i = tables.arenas.instanceOf(id);
    for (const [node, l] of i.locals) if (!tables.declarations.has(node)) used.add(l);
    if (i.captures !== undefined) for (const from of i.captures.values()) if (from !== "this") used.add(from);
    if (i.envs !== undefined) for (const e of i.envs.values()) for (const l of e.env) used.add(l);
    if (i.made !== undefined) {
      const lists = [...i.made.values()];
      for (const list of lists) for (const e of list) for (const l of e.env) used.add(l);
    }
  }
  // By where the name is written, since a generic body's instances, and a body checked again,
  // each declare it anew: it is unused only when no declaration of it is used.
  let found = new Map<usize, { warning: CompileError; used: boolean }>();
  for (const id of compiled) {
    const i = tables.arenas.instanceOf(id);
    const b = bodyOf(i);
    if (b.start >= STD_BASE || tables.generated.has(b)) continue;
    for (const [node, lid] of i.locals) {
      if (!tables.declarations.has(node)) continue;
      const l = tables.arenas.localOf(lid);
      // A parameter with a default is bound by the body's first statements, under its name.
      const param = l.param || tables.prologues.hasId(node.id);
      if (param && required(b)) continue;
      const at = l.param ? paramPattern(node) : variable(node);
      if (at === undefined || at.kind !== "ident" || tables.generated.has(at) || tables.generated.hasId(node.id) || !warnable(at.name)) continue;
      const what = param ? "parameter" : "variable";
      const seen = found.get(at.start);
      let entry = seen !== undefined ? seen : { warning: new CompileError("W0001", `unused ${what} '${at.name}'; if it's intentional, name it '_${at.name}'`, at.start, at.start + at.name.length), used: false };
      entry.used = entry.used || used.has(lid);
      found.set(at.start, entry);
    }
  }
  let unreachable = new Map<usize, CompileError>();
  for (const id of compiled) {
    const i = tables.arenas.instanceOf(id);
    const b = bodyOf(i);
    if (b.start < STD_BASE && !tables.generated.has(b)) unreachableIn(tables.generated, b.body, i, unreachable);
  }
  let all: CompileError[] = [];
  for (let entries = [...found.values()]; entries.length > 0; ) {
    const e = entries.shift()!;
    if (!e.used) all.push(e.warning);
  }
  all = all.concat([...unreachable.values()]);
  all.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  return all;
}

// A name `_` starts is meant to go unused, as in Rust and TypeScript; one that isn't an
// identifier is a variable the compiler made.
function warnable(name: string): boolean {
  return /^[A-Za-z$][\w$]*$/.test(name) && name !== "this";
}

// The pattern a parameter declares: of the nodes a name is declared by, only a parameter has no kind.
function paramPattern(node: Ref<Expr | Stmt | Param | ObjectProp>): Ref<Pattern> | undefined {
  return "kind" in node ? undefined : node.pattern;
}

// The name a `let` declares. A nested function is a `const` of the arrow it became, spanning the
// whole function, and is no variable.
function variable(s: Ref<Expr | Stmt | Param | ObjectProp>): Ref<Pattern> | undefined {
  if (!("kind" in s) || s.kind !== "let") return undefined;
  const d: Ref<Declarator> = s.declarations[0]!;
  if (d.init !== undefined && d.init.kind === "arrow" && d.init.start === d.target.start) return undefined;
  return d.target;
}

// Reports the first statement after one control never passes, once per such run, in these
// statements and the blocks inside them.
function unreachableIn(generated: Ref<Tables["generated"]>, stmts: Ref<Stmt[]>, i: Ref<Instance>, out: Mut<Map<usize, CompileError>>) {
  for (let k: usize = 0; k < stmts.length; k++) {
    const s: Ref<Stmt> = stmts[k]!;
    unreachableInBlocks(generated, s, i, out);
    const why = leaves(s, i);
    if (why === undefined) continue;
    for (let j = k + 1; j < stmts.length; j++) {
      const x: Ref<Stmt> = stmts[j]!;
      if (HOISTED.has(x.kind) || (x.kind === "let" && variable(x) === undefined) || generated.has(x)) continue;
      if (x.start < STD_BASE) out.set(x.start, new CompileError("W0002", `unreachable code after ${why}`, x.start, x.end));
      break;
    }
    return;
  }
}

// Declarations that stand anywhere in their block, as TypeScript's hoisting allows.
const HOISTED = new Set(["empty", "function", "typeAlias", "interface", "class", "enum", "declare"]);

// What leaves a statement for good: a jump, or a call typed `never`.
function leaves(s: Ref<Stmt>, i: Ref<Instance>): string | undefined {
  if (s.kind === "return" || s.kind === "throw" || s.kind === "break" || s.kind === "continue") return `'${s.kind}'`;
  if (s.kind === "expr" && s.expr.kind === "call") {
    const t = i.types.get(s.expr);
    const callee = i.tables.arenas.instanceOf(i.calls.get(s.expr));
    const returns = t !== undefined ? t : callee !== undefined ? callee.returns : undefined;
    if (returns === "never") return "a call that never returns";
  }
  return undefined;
}

// Reports unreachable code in the statement lists directly inside a statement.
function unreachableInBlocks(generated: Ref<Tables["generated"]>, s: Ref<Stmt>, i: Ref<Instance>, out: Mut<Map<usize, CompileError>>): void {
  switch (s.kind) {
    case "if":
      unreachableIn(generated, s.then, i, out);
      if (s.else !== undefined) unreachableIn(generated, s.else, i, out);
      return;
    case "block":
    case "unsafe":
    case "comptime":
    case "while":
    case "doWhile":
    case "for":
    case "forOf":
    case "forIn":
      unreachableIn(generated, s.body, i, out);
      return;
    case "labeled":
      unreachableInBlocks(generated, s.body, i, out);
      return;
    case "try":
      unreachableIn(generated, s.block, i, out);
      if (s.handler !== undefined) unreachableIn(generated, s.handler, i, out);
      if (s.finalizer !== undefined) unreachableIn(generated, s.finalizer, i, out);
      return;
    case "switch":
      for (const c of s.cases) unreachableIn(generated, c.body, i, out);
      return;
    default:
      return;
  }
}
