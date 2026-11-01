import { bodyOf, type InstanceId, type LocalId } from "./arenas.ts";
import type { Body, Instance } from "./check.ts";
import type { Tables } from "./compilation.ts";
import { CompileError } from "./diag.ts";
import type { Id } from "./nodes.ts";
import type { Param, Pattern, Stmt } from "./parser.ts";
import { STD_BASE } from "./std.ts";

// What the compiler reports without failing the build: variables and parameters nothing reads,
// and statements control can never reach.

// Marks every node of a tree a macro made as `generated`, which no warning points into: their
// author can't change them.
export function markGenerated(generated: Tables["generated"], node: unknown, seen: Set<unknown> = new Set<unknown>()) {
  if (!node || typeof node !== "object" || seen.has(node)) return;
  seen.add(node);
  if (typeof (node as { id?: unknown }).id === "number") generated.add(node as Id);
  Object.values(node).forEach((v) => markGenerated(generated, v, seen));
}

// The warnings for a checked program, in source order. `required` says whether a body's parameters
// are a signature's to decide, as an export's, an override's or an interface method's are.
// `declarations` are the `let` statements and parameters that declare a name, as the checker met
// them; every other node an instance's `locals` holds is a use of one.
export function warnings({ arenas, declarations, generated, prologues }: Tables, compiled: InstanceId[], required: (b: Body) => boolean): CompileError[] {
  const instances = compiled.map((i) => arenas.instanceOf(i));
  const used = new Set<LocalId>();
  for (const i of instances) {
    for (const [node, l] of i.locals) if (!declarations.has(node)) used.add(l);
    for (const from of i.captures?.values() ?? []) if (from !== "this") used.add(from);
    for (const { env } of [...(i.envs?.values() ?? []), ...[...(i.made?.values() ?? [])].flat()]) env.forEach((l) => used.add(l));
  }
  // By where the name is written, since a generic body's instances, and a body checked again,
  // each declare it anew: it is unused only when no declaration of it is used.
  const found = new Map<usize, { warning: CompileError; used: boolean }>();
  for (const i of instances) {
    if (bodyOf(i).start >= STD_BASE || generated.has(bodyOf(i))) continue;
    for (const [node, id] of i.locals) {
      if (!declarations.has(node)) continue;
      const l = arenas.localOf(id);
      // A parameter with a default is bound by the body's first statements, under its name.
      const param = l.param || prologues.has(node as Stmt);
      if (param && required(bodyOf(i))) continue;
      const at = l.param ? (node as Param).pattern : variable(node as Stmt);
      if (!at || at.kind !== "ident" || generated.has(at) || generated.has(node) || !warnable(at.name)) continue;
      const what = param ? "parameter" : "variable";
      const entry = found.get(at.start) ?? { warning: new CompileError("W0001", `unused ${what} '${at.name}'; if it's intentional, name it '_${at.name}'`, at.start, at.start + at.name.length), used: false };
      entry.used ||= used.has(id);
      found.set(at.start, entry);
    }
  }
  const unreachable = new Map<usize, CompileError>();
  for (const i of instances) {
    if (bodyOf(i).start < STD_BASE && !generated.has(bodyOf(i))) unreachableIn(generated, bodyOf(i).body, i, unreachable);
  }
  const all = [...[...found.values()].filter((e) => !e.used).map((e) => e.warning), ...unreachable.values()];
  return all.sort((a, b) => a.start - b.start);
}

// A name `_` starts is meant to go unused, as in Rust and TypeScript; one that isn't an
// identifier is a variable the compiler made.
const warnable = (name: string) => /^[A-Za-z$][\w$]*$/.test(name) && name !== "this";

// The name a `let` declares. A nested function is a `const` of the arrow it became, spanning the
// whole function, and is no variable.
function variable(s: Stmt): Pattern | undefined {
  if (s.kind !== "let") return undefined;
  const d = s.declarations[0]!;
  if (d.init?.kind === "arrow" && d.init.start === d.target.start) return undefined;
  return d.target;
}

// Reports the first statement after one control never passes, once per such run, in these
// statements and the blocks inside them.
function unreachableIn(generated: Tables["generated"], stmts: Stmt[], i: Instance, out: Map<usize, CompileError>) {
  for (const [k, s] of stmts.entries()) {
    for (const inner of blocks(s)) unreachableIn(generated, inner, i, out);
    const why = leaves(s, i);
    if (!why) continue;
    const next = stmts.slice(k + 1).find((x) => !HOISTED.has(x.kind) && !(x.kind === "let" && !variable(x)) && !generated.has(x));
    if (next && next.start < STD_BASE) out.set(next.start, new CompileError("W0002", `unreachable code after ${why}`, next.start, next.end));
    return;
  }
}

// Declarations that stand anywhere in their block, as TypeScript's hoisting allows.
const HOISTED = new Set(["empty", "function", "typeAlias", "interface", "class", "enum", "declare"]);

// What leaves a statement for good: a jump, or a call typed `never`.
function leaves(s: Stmt, i: Instance): string | undefined {
  if (s.kind === "return" || s.kind === "throw" || s.kind === "break" || s.kind === "continue") return `'${s.kind}'`;
  if (s.kind === "expr" && s.expr.kind === "call" && (i.types.get(s.expr) ?? i.tables.arenas.instanceOf(i.calls.get(s.expr))?.returns) === "never") return "a call that never returns";
  return undefined;
}

// The statement lists directly inside a statement.
function blocks(s: Stmt): Stmt[][] {
  switch (s.kind) {
    case "if":
      return s.else ? [s.then, s.else] : [s.then];
    case "block":
    case "unsafe":
    case "comptime":
    case "while":
    case "doWhile":
    case "for":
    case "forOf":
    case "forIn":
      return [s.body];
    case "labeled":
      return [[s.body]];
    case "try":
      return [s.block, ...(s.handler ? [s.handler] : []), ...(s.finalizer ? [s.finalizer] : [])];
    case "switch":
      return s.cases.map((c) => c.body);
    default:
      return [];
  }
}
