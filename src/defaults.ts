import { CompileError } from "./diag.ts";
import type { Expr, Param, Stmt, TypeNode } from "./parser.ts";
import type { Type } from "./typing.ts";

// Default parameter values, lowered before checking. A parameter `x: T = v` becomes an optional
// parameter under a name no source can write, and the body starts with `const x: T = <it> ?? v`,
// so the default runs in the callee each time the argument is left out, after the parameters
// before it, which it may read. The checker holds calls and defaults to `T` itself.

// Each lowered parameter: its name as written, and whether its default is `null`.
export const defaulted = new WeakMap<Param, { name: string; empty: boolean }>();
// Each `<it> ?? v` a default became, with the parameter's declared type, which `v` is checked
// against.
export const fallbacks = new WeakMap<Expr, TypeNode>();
// Each lowered parameter's declared type, resolved where the function is written.
export const declaredTypes = new WeakMap<Param, Type>();
// The statements binding defaults, which come before a derived constructor's `super(...)`.
export const prologues = new WeakSet<Stmt>();

export function lowerDefaults(node: unknown) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const x of node) lowerDefaults(x);
    return;
  }
  const f = node as { kind?: string; params?: unknown; body?: unknown };
  if (Array.isArray(f.params) && f.body !== undefined) lowered(f as { kind?: string; params: Param[]; body: Expr | Stmt[] });
  for (const value of Object.values(node)) lowerDefaults(value);
}

function lowered(f: { kind?: string; params: Param[]; body: Expr | Stmt[] }) {
  const firsts: Stmt[] = [];
  f.params.forEach((p, i) => {
    if (!p.default) return;
    const later = f.params.slice(i + 1).find((q) => !q.default && !q.optional && !q.rest);
    if (later) throw new CompileError("a parameter with a default has to come after the required ones, since Fish calls leave out only trailing arguments", p.start, p.end);
    if (p.optional) throw new CompileError("a parameter can't be both optional and have a default; the default already lets callers leave it out", p.start, p.end);
    if (f.kind === "set") throw new CompileError("a setter's parameter can't have a default; an assignment always gives it a value", p.start, p.end);
    if (p.pattern.kind !== "ident") throw new CompileError("defaults on destructured parameters are not supported yet", p.start, p.end);
    if (p.modifiers.length > 0) throw new CompileError("defaults on parameter properties are not supported yet", p.start, p.end);
    if (p.rest) throw new CompileError("a rest parameter can't have a default; it is an empty array when nothing is passed", p.start, p.end);
    if (p.comptime) throw new CompileError("comptime parameters can't have defaults yet", p.start, p.end);
    const type = p.type ?? literalType(p.default);
    if (!type) throw new CompileError(`parameter '${p.pattern.name}' needs a type: its default isn't a literal that says one, so write it, as in '${p.pattern.name}: T = ...'`, p.start, p.end);
    const name = p.pattern.name;
    const empty = p.default.kind === "null" || (p.default.kind === "ident" && p.default.name === "undefined");
    const at = { start: p.start, end: p.end };
    const hidden = `${name} given`;
    const given: Expr = { kind: "ident", name: hidden, ...at };
    const init: Expr = { kind: "binary", op: "??", left: given, right: p.default, start: p.default.start, end: p.default.end };
    fallbacks.set(init, type);
    const binding: Stmt = { kind: "let", keyword: "const", declarations: [{ target: { kind: "ident", name, ...at }, type, init, ...at }], ...at };
    prologues.add(binding);
    firsts.push(binding);
    Object.assign(p, { pattern: { ...p.pattern, name: hidden }, type, optional: true, default: undefined });
    defaulted.set(p, { name, empty });
  });
  if (firsts.length === 0) return;
  if (Array.isArray(f.body)) f.body.unshift(...firsts);
  else {
    const value = f.body;
    f.body = [...firsts, { kind: "return", value, start: value.start, end: value.end }];
  }
}

// The type a literal default says: `1` an i64, `1.5` an f64, `"a"` a string, `true` a boolean.
function literalType(e: Expr): TypeNode | undefined {
  const ref = (name: string): TypeNode => ({ kind: "ref", name, args: [], start: e.start, end: e.end });
  if (e.kind === "unary" && e.op === "-" && (e.operand.kind === "int" || e.operand.kind === "float")) return literalType(e.operand);
  if (e.kind === "int") return ref("i64");
  if (e.kind === "float") return ref("f64");
  if (e.kind === "string" || (e.kind === "template" && e.exprs.length === 0)) return ref("string");
  if (e.kind === "bool") return ref("boolean");
  return undefined;
}

// A parameter's name as its source wrote it.
export function writtenName(p: Param): string {
  return defaulted.get(p)?.name ?? (p.pattern as { name: string }).name;
}

// Whether a type is `null` or an Option, which a call may pass in place of a default.
export function holdsNull(t: Type): boolean {
  return t === "null" || (typeof t !== "string" && t.kind === "union" && t.members.includes("null"));
}
