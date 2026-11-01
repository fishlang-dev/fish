import type { Tables } from "./compilation.ts";
import { nextId, Rewrites, walk, type Id, type Ids } from "./nodes.ts";
import { CompileError } from "./diag.ts";
import type { Expr, Param, Stmt, TypeNode } from "./parser.ts";
import { rebuiltStmts } from "./rebuild.ts";
import type { Type, Typing } from "./typing.ts";

// Default parameter values, lowered before checking. A parameter `x: T = v` becomes an optional
// parameter under a name no source can write, and the body starts with `const x: T = <it> ?? v`,
// so the default runs in the callee each time the argument is left out, after the parameters
// before it, which it may read. The checker holds calls and defaults to `T` itself.

export function lowerDefaults(tables: Tables, program: Stmt[]) {
  const rewrites = new Rewrites();
  // Whatever has parameters and a body: functions, arrows, methods, accessors and constructors.
  walk("stmt", program, ({ node }) => {
    const f = node as { kind?: string; params?: unknown; body?: unknown };
    if (Array.isArray(f.params) && f.body !== undefined) lowered(tables, rewrites, f as Id & { kind?: string; params: Param[]; body: Expr | Stmt[] });
  });
  rebuiltStmts(program, rewrites);
}

function lowered(tables: Tables, rewrites: Rewrites, f: Id & { kind?: string; params: Param[]; body: Expr | Stmt[] }) {
  const { defaulted, fallbacks, renamed, prologues, ids } = tables;
  const firsts: Stmt[] = [];
  f.params.forEach((p, i) => {
    if (p.rest && i !== f.params.length - 1) throw new CompileError("a rest parameter has to be the last one, since it takes every argument after those before it", p.start, p.end);
    // A destructured parameter is a plain one under a hidden name, destructured as the body starts.
    if ((p.pattern.kind === "object" || p.pattern.kind === "array") && p.modifiers.length > 0) throw new CompileError("a parameter property can't be destructured; it names one field", p.start, p.end);
    if ((p.pattern.kind === "object" || p.pattern.kind === "array") && !p.default && !p.rest) {
      const at = { start: p.pattern.start, end: p.pattern.end };
      const hidden = `argument ${i}`;
      const binding: Stmt = { id: nextId(ids), kind: "let", keyword: "const", declarations: [{ id: nextId(ids), target: p.pattern, type: undefined, init: { id: nextId(ids), kind: "ident", name: hidden, ...at }, ...at }], ...at };
      prologues.add(binding);
      firsts.push(binding);
      renamed.set(p, "_");
      rewrites.replace(p, { ...p, pattern: { id: nextId(ids), kind: "ident", name: hidden, ...at } });
      return;
    }
    if (!p.default) return;
    if (p.pattern.kind !== "ident") throw new CompileError("a destructured parameter can't have a default yet; give the default to the parts, as in '{ a = 1 }: T'", p.start, p.end);
    const later = f.params.slice(i + 1).find((q) => !q.default && !q.optional && !q.rest);
    if (later) throw new CompileError("a parameter with a default has to come after the required ones, since Fish calls leave out only trailing arguments", p.start, p.end);
    if (p.optional) throw new CompileError("a parameter can't be both optional and have a default; the default already lets callers leave it out", p.start, p.end);
    if (f.kind === "set") throw new CompileError("a setter's parameter can't have a default; an assignment always gives it a value", p.start, p.end);
    if (p.modifiers.length > 0) throw new CompileError("defaults on parameter properties are not supported yet", p.start, p.end);
    if (p.rest) throw new CompileError("a rest parameter can't have a default; it is an empty array when nothing is passed", p.start, p.end);
    if (p.comptime) throw new CompileError("comptime parameters can't have defaults yet", p.start, p.end);
    const type = p.type ?? literalType(ids, p.default);
    if (!type) throw new CompileError(`parameter '${p.pattern.name}' needs a type: its default isn't a literal that says one, so write it, as in '${p.pattern.name}: T = ...'`, p.start, p.end);
    const name = p.pattern.name;
    const empty = p.default.kind === "null" || (p.default.kind === "ident" && p.default.name === "undefined");
    const at = { start: p.start, end: p.end };
    const hidden = `${name} given`;
    const given: Expr = { id: nextId(ids), kind: "ident", name: hidden, ...at };
    const init: Expr = { id: nextId(ids), kind: "binary", op: "??", left: given, right: p.default, start: p.default.start, end: p.default.end };
    fallbacks.set(init, type);
    const binding: Stmt = { id: nextId(ids), kind: "let", keyword: "const", declarations: [{ id: nextId(ids), target: { id: nextId(ids), kind: "ident", name, ...at }, type, init, ...at }], ...at };
    prologues.add(binding);
    firsts.push(binding);
    rewrites.replace(p, { ...p, pattern: { ...p.pattern, id: nextId(ids), name: hidden }, type, optional: true, default: undefined });
    defaulted.set(p, { name, empty });
  });
  if (firsts.length === 0) return;
  const value = f.body;
  const body = Array.isArray(value) ? [...firsts, ...value] : [...firsts, { id: nextId(ids), kind: "return" as const, value, start: value.start, end: value.end }];
  // Any node with parameters and a body, typed as one of them.
  rewrites.replace(f, { ...f, body } as unknown as Expr);
}

// The type a literal default says: `1` an i64, `1.5` an f64, `"a"` a string, `true` a boolean.
function literalType(ids: Ids, e: Expr): TypeNode | undefined {
  const ref = (name: string): TypeNode => ({ id: nextId(ids), kind: "ref", name, args: [], start: e.start, end: e.end });
  if (e.kind === "unary" && e.op === "-" && (e.operand.kind === "int" || e.operand.kind === "float")) return literalType(ids, e.operand);
  if (e.kind === "int") return ref("i64");
  if (e.kind === "float") return ref("f64");
  if (e.kind === "string" || (e.kind === "template" && e.exprs.length === 0)) return ref("string");
  if (e.kind === "bool") return ref("boolean");
  return undefined;
}

// A parameter's name as its source wrote it.
export function writtenName(tables: Tables, p: Param): string {
  return tables.defaulted.get(p)?.name ?? tables.renamed.get(p) ?? (p.pattern as { name: string }).name;
}

// Whether a type is `null` or an Option, which a call may pass in place of a default.
export function holdsNull({ rec }: Typing, t: Type): boolean {
  if (typeof t === "string") return t === "null";
  const r = rec(t);
  return r.kind === "union" && r.members.includes("null");
}
