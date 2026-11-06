import type { Tables } from "./compilation.ts";
import { nextId, Rewrites, walk, type Ids } from "./nodes.ts";
import { CompileError } from "./diag.ts";
import type { Expr, Param, Stmt, TypeNode } from "./parser.ts";
import { cloneExpr, cloneParam, clonePattern, cloneStmt, cloneTypeNode, rebuiltStmts } from "./rebuild.ts";
import type { Type, Typing } from "./typing.ts";

// Default parameter values, lowered before checking. A parameter `x: T = v` becomes an optional
// parameter under a name no source can write, and the body starts with `let x: T = <it> ?? v`,
// so the default runs in the callee each time the argument is left out, after the parameters
// before it, which it may read. The checker holds calls and defaults to `T` itself.

/** @throws {CompileError} */
export function lowerDefaults(tables: Mut<Tables>, program: Mut<Stmt[]>) {
  let rewrites = new Rewrites();
  let failure: CompileError | undefined = undefined;
  // Whatever has parameters and a body: functions, arrows, methods, accessors and constructors.
  walk({ of: "stmts", node: program }, (n) => {
    if (failure !== undefined) return;
    try {
      if (n.of === "stmt" && n.node.kind === "function" && n.node.body !== undefined) {
        const body = lowered(tables, rewrites, "function", n.node.params, n.node.body);
        if (body !== undefined) rewrites.replaceStmt(n.node, { ...n.node, body });
      } else if (n.of === "func" && n.node.body !== undefined) {
        const body = lowered(tables, rewrites, "function", n.node.params, n.node.body);
        if (body !== undefined) rewrites.replaceFunc(n.node, { ...n.node, body });
      } else if (n.of === "classMember") {
        const m = n.node;
        if (m.kind === "method" && m.body !== undefined) {
          const body = lowered(tables, rewrites, m.kind, m.params, m.body);
          if (body !== undefined) rewrites.replaceClassMember(m, { ...m, body });
        } else if (m.kind === "constructor" && m.body !== undefined) {
          const body = lowered(tables, rewrites, m.kind, m.params, m.body);
          if (body !== undefined) rewrites.replaceClassMember(m, { ...m, body });
        } else if ((m.kind === "get" || m.kind === "set") && m.body !== undefined) {
          const body = lowered(tables, rewrites, m.kind, m.params, m.body);
          if (body !== undefined) rewrites.replaceClassMember(m, { ...m, body });
        }
      } else if (n.of === "objectProp") {
        const p = n.node;
        if (p.kind === "method") {
          const body = lowered(tables, rewrites, p.kind, p.params, p.body);
          if (body !== undefined) rewrites.replaceObjectProp(p, { ...p, body });
        } else if (p.kind === "get" || p.kind === "set") {
          const body = lowered(tables, rewrites, p.kind, p.params, p.body);
          if (body !== undefined) rewrites.replaceObjectProp(p, { ...p, body });
        }
      } else if (n.of === "expr") {
        const e = n.node;
        if (e.kind === "arrow") {
          const body = lowered(tables, rewrites, e.kind, e.params, e.body);
          if (body !== undefined) rewrites.replace(e, { ...e, body });
        } else if (e.kind === "function") {
          const body = lowered(tables, rewrites, e.kind, e.params, e.body);
          if (body !== undefined) rewrites.replace(e, { ...e, body });
        }
      }
    } catch (e) {
      if (e instanceof CompileError) failure = e;
    }
  });
  if (failure !== undefined) throw failure!;
  rebuiltStmts(program, rewrites);
}

// The body a function starts with its defaults and destructured parameters bound, or undefined
// when it has neither. `kind` is the node's: a setter's parameter can't have a default.
/** @throws {CompileError} */
function lowered(tables: Mut<Tables>, rewrites: Mut<Rewrites>, kind: string, params: Ref<Param[]>, value: Ref<Expr | Stmt[]>): Stmt[] | undefined {
  let firsts: Stmt[] = [];
  for (let i: usize = 0; i < params.length; i++) {
    const p: Ref<Param> = params[i]!;
    if (p.rest && i !== params.length - 1) throw new CompileError("E0408", "a rest parameter has to be the last one, since it takes every argument after those before it", p.start, p.end);
    // A destructured parameter is a plain one under a hidden name, destructured as the body starts.
    if ((p.pattern.kind === "object" || p.pattern.kind === "array") && p.modifiers.length > 0) throw new CompileError("E0408", "a parameter property can't be destructured; it names one field", p.start, p.end);
    if ((p.pattern.kind === "object" || p.pattern.kind === "array") && p.default === undefined && !p.rest) {
      const at = { start: p.pattern.start, end: p.pattern.end };
      const hidden = `argument ${i}`;
      const binding: Stmt = { id: nextId(tables.ids), kind: "let", keyword: "let", declarations: [{ id: nextId(tables.ids), target: clonePattern(p.pattern), type: undefined, init: { id: nextId(tables.ids), kind: "ident", name: hidden, ...at }, ...at }], ...at };
      tables.prologues.add(cloneStmt(binding));
      firsts.push(binding);
      tables.renamed.set(cloneParam(p), "_");
      rewrites.replaceParam(p, { ...p, pattern: { id: nextId(tables.ids), kind: "ident", name: hidden, ...at } });
      continue;
    }
    if (p.default === undefined) continue;
    if (p.pattern.kind !== "ident") throw new CompileError("E0801", "a destructured parameter can't have a default yet; give the default to the parts, as in '{ a = 1 }: T'", p.start, p.end);
    for (let j = i + 1; j < params.length; j++) {
      const q: Ref<Param> = params[j]!;
      if (q.default === undefined && !q.optional && !q.rest) throw new CompileError("E0408", "a parameter with a default has to come after the required ones, since Fish calls leave out only trailing arguments", p.start, p.end);
    }
    if (p.optional) throw new CompileError("E0408", "a parameter can't be both optional and have a default; the default already lets callers leave it out", p.start, p.end);
    if (kind === "set") throw new CompileError("E0408", "a setter's parameter can't have a default; an assignment always gives it a value", p.start, p.end);
    if (p.modifiers.length > 0) throw new CompileError("E0801", "defaults on parameter properties are not supported yet", p.start, p.end);
    if (p.rest) throw new CompileError("E0408", "a rest parameter can't have a default; it is an empty array when nothing is passed", p.start, p.end);
    if (p.comptime) throw new CompileError("E0801", "comptime parameters can't have defaults yet", p.start, p.end);
    const type = p.type !== undefined ? cloneTypeNode(p.type) : literalType(tables.ids, p.default);
    const name = p.pattern.name;
    if (type === undefined) throw new CompileError("E0408", `parameter '${name}' needs a type: its default isn't a literal that says one, so write it, as in '${name}: T = ...'`, p.start, p.end);
    const empty = p.default.kind === "null" || (p.default.kind === "ident" && p.default.name === "undefined");
    const at = { start: p.start, end: p.end };
    const hidden = `${name} given`;
    const given: Expr = { id: nextId(tables.ids), kind: "ident", name: hidden, ...at };
    const init: Expr = { id: nextId(tables.ids), kind: "binary", op: "??", left: given, right: cloneExpr(p.default), start: p.default.start, end: p.default.end };
    tables.fallbacks.set(cloneExpr(init), cloneTypeNode(type));
    const binding: Stmt = { id: nextId(tables.ids), kind: "let", keyword: "let", declarations: [{ id: nextId(tables.ids), target: { id: nextId(tables.ids), kind: "ident", name, ...at }, type: cloneTypeNode(type), init, ...at }], ...at };
    tables.prologues.add(cloneStmt(binding));
    firsts.push(binding);
    rewrites.replaceParam(p, { ...p, pattern: { ...p.pattern, id: nextId(tables.ids), name: hidden }, type, optional: true, default: undefined });
    tables.defaulted.set(cloneParam(p), { name, empty });
  }
  if (firsts.length === 0) return undefined;
  if (Array.isArray(value)) {
    for (const s of value) firsts.push(cloneStmt(s));
  } else {
    firsts.push({ id: nextId(tables.ids), kind: "return", value: cloneExpr(value), start: value.start, end: value.end });
  }
  return firsts;
}

// The type a literal default says: `1` an i64, `1.5` an f64, `"a"` a string, `true` a boolean.
function literalType(ids: Mut<Ids>, e: Ref<Expr>): TypeNode | undefined {
  const x: Ref<Expr> = e.kind === "unary" && e.op === "-" && (e.operand.kind === "int" || e.operand.kind === "float") ? e.operand : e;
  const name = x.kind === "int" ? "i64" : x.kind === "float" ? "f64" : x.kind === "string" || (x.kind === "template" && x.exprs.length === 0) ? "string" : x.kind === "bool" ? "boolean" : undefined;
  return name === undefined ? undefined : { id: nextId(ids), kind: "ref", name, args: [], start: e.start, end: e.end };
}

// A parameter's name as its source wrote it.
export function writtenName(tables: Ref<Tables>, p: Ref<Param>): string {
  const defaulted = tables.defaulted.get(p);
  if (defaulted !== undefined) return defaulted.name;
  const renamed = tables.renamed.get(p);
  if (renamed !== undefined) return renamed;
  return p.pattern.kind === "ident" ? p.pattern.name : "";
}

// Whether a type is `null` or an Option, which a call may pass in place of a default.
export function holdsNull(typing: Typing, t: Type): boolean {
  if (typeof t === "string") return t === "null";
  const r = typing.rec(t);
  return r.kind === "union" && r.members.includes("null");
}
