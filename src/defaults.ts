import { CompileError } from "./diag.ts";
import type { Expr, Param, Stmt, TypeNode } from "./parser.ts";

// Default parameter values, lowered before checking. A parameter `x: T = v` becomes an optional
// parameter under a name no source can write, and the body starts with `const x: T = <it> ?? v`,
// so the default runs in the callee each time the argument is left out, after the parameters
// before it, which it may read.

// Each lowered parameter, with its declared type, for calls that pass it `null`.
export const defaulted = new WeakMap<Param, TypeNode>();
// Each `<it> ?? v` a default became, whose `v` is checked against the parameter's own type.
export const fallbacks = new WeakSet<Expr>();

export function lowerDefaults(node: unknown) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const x of node) lowerDefaults(x);
    return;
  }
  const f = node as { params?: unknown; body?: unknown };
  if (Array.isArray(f.params) && f.body !== undefined) lowered(f as { params: Param[]; body: Expr | Stmt[] });
  for (const value of Object.values(node)) lowerDefaults(value);
}

function lowered(f: { params: Param[]; body: Expr | Stmt[] }) {
  const firsts: Stmt[] = [];
  f.params.forEach((p, i) => {
    if (!p.default) return;
    const later = f.params.slice(i + 1).find((q) => !q.default && !q.optional && !q.rest);
    if (later) throw new CompileError("a parameter with a default has to come after the required ones, since Fish calls leave out only trailing arguments", p.start, p.end);
    if (p.pattern.kind !== "ident") throw new CompileError("defaults on destructured parameters are not supported yet", p.start, p.end);
    if (p.modifiers.length > 0) throw new CompileError("defaults on parameter properties are not supported yet", p.start, p.end);
    if (p.rest) throw new CompileError("a rest parameter can't have a default; it is an empty array when nothing is passed", p.start, p.end);
    if (p.comptime) throw new CompileError("comptime parameters can't have defaults yet", p.start, p.end);
    const type = p.type ?? literalType(p.default);
    if (!type) throw new CompileError(`parameter '${p.pattern.name}' needs a type: its default isn't a literal that says one, so write it, as in '${p.pattern.name}: T = ...'`, p.start, p.end);
    const name = p.pattern.name;
    // A missing argument and a passed `null` would look the same, which TypeScript tells apart.
    const empty = (p.default.kind === "null" || (p.default.kind === "ident" && p.default.name === "undefined"));
    if (admitsNull(type) && !empty) throw new CompileError(`a parameter that may be null can have only 'null' as its default so far, since a passed null and a missing argument would look the same; write '${name}?: ...' and give the default in the body`, p.start, p.end);
    const at = { start: p.start, end: p.end };
    const hidden = `${name} given`;
    const given: Expr = { kind: "ident", name: hidden, ...at };
    // A `null` default is what a left-out optional parameter holds already.
    const direct = empty && admitsNull(type);
    const init: Expr = direct ? given : { kind: "binary", op: "??", left: given, right: p.default, start: p.default.start, end: p.default.end };
    if (!direct) fallbacks.add(init);
    firsts.push({ kind: "let", keyword: "const", declarations: [{ target: { kind: "ident", name, ...at }, type, init, ...at }], ...at });
    Object.assign(p, { pattern: { ...p.pattern, name: hidden }, type, optional: true, default: undefined });
    defaulted.set(p, type);
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

// Whether a written type holds `null` or `undefined`, so a call may pass it to a defaulted
// parameter rather than leave the argument out.
export function admitsNull(t: TypeNode): boolean {
  if (t.kind === "ref") return t.name === "null" || t.name === "undefined";
  return t.kind === "union" && t.types.some(admitsNull);
}
