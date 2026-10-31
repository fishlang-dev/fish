import type { Body, Instance, Local } from "./check.ts";
import { prologues } from "./defaults.ts";
import { CompileError } from "./diag.ts";
import type { Param, Pattern, Stmt } from "./parser.ts";
import { STD_BASE } from "./std.ts";

// What the compiler reports without failing the build: variables and parameters nothing reads,
// and statements control can never reach.

// The `let` statements and parameters that declare a name, as the checker meets them; every other
// node the checker's `locals` holds is a use of one.
export const declarations = new WeakSet<object>();

// The nodes a macro made, which no warning points into: their author can't change them.
export const generated = new WeakSet<object>();

export function markGenerated(node: unknown) {
  if (!node || typeof node !== "object" || generated.has(node)) return;
  generated.add(node);
  Object.values(node).forEach(markGenerated);
}

// The warnings for a checked program, in source order. `required` says whether a body's parameters
// are a signature's to decide, as an export's, an override's or an interface method's are.
export function warnings(instances: Instance[], required: (b: Body) => boolean): CompileError[] {
  const used = new Set<Local>();
  for (const i of instances) {
    for (const [node, l] of i.locals) if (!declarations.has(node)) used.add(l);
    for (const from of i.captures?.values() ?? []) if (from !== "this") used.add(from);
    for (const { env } of [...(i.envs?.values() ?? []), ...[...(i.made?.values() ?? [])].flat()]) env.forEach((l) => used.add(l));
  }
  // By where the name is written, since a generic body's instances, and a body checked again,
  // each declare it anew: it is unused only when no declaration of it is used.
  const found = new Map<number, { warning: CompileError; used: boolean }>();
  for (const i of instances) {
    if (i.body.start >= STD_BASE || generated.has(i.body)) continue;
    for (const [node, l] of i.locals) {
      if (!declarations.has(node)) continue;
      // A parameter with a default is bound by the body's first statements, under its name.
      const param = l.param || prologues.has(node as Stmt);
      if (param && required(i.body)) continue;
      const at = l.param ? (node as Param).pattern : variable(node as Stmt);
      if (!at || at.kind !== "ident" || generated.has(at) || generated.has(node) || !warnable(at.name)) continue;
      const what = param ? "parameter" : "variable";
      const entry = found.get(at.start) ?? { warning: new CompileError(`unused ${what} '${at.name}'; if it's intentional, name it '_${at.name}'`, at.start, at.start + at.name.length), used: false };
      entry.used ||= used.has(l);
      found.set(at.start, entry);
    }
  }
  const unreachable = new Map<number, CompileError>();
  for (const i of instances) {
    if (i.body.start < STD_BASE && !generated.has(i.body)) unreachableIn(i.body.body, i, unreachable);
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
function unreachableIn(stmts: Stmt[], i: Instance, out: Map<number, CompileError>) {
  for (const [k, s] of stmts.entries()) {
    for (const inner of blocks(s)) unreachableIn(inner, i, out);
    const why = leaves(s, i);
    if (!why) continue;
    const next = stmts.slice(k + 1).find((x) => !HOISTED.has(x.kind) && !(x.kind === "let" && !variable(x)) && !generated.has(x));
    if (next && next.start < STD_BASE) out.set(next.start, new CompileError(`unreachable code after ${why}`, next.start, next.end));
    return;
  }
}

// Declarations that stand anywhere in their block, as TypeScript's hoisting allows.
const HOISTED = new Set(["empty", "function", "typeAlias", "interface", "class", "enum", "declare"]);

// What leaves a statement for good: a jump, or a call typed `never`.
function leaves(s: Stmt, i: Instance): string | undefined {
  if (s.kind === "return" || s.kind === "throw" || s.kind === "break" || s.kind === "continue") return `'${s.kind}'`;
  if (s.kind === "expr" && s.expr.kind === "call" && (i.types.get(s.expr) ?? i.calls.get(s.expr)?.returns) === "never") return "a call that never returns";
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
