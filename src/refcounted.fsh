import { CompileError } from "./diag.fsh";
import { forEachChild, nextId, reborrowNode, renumberExpr, Rewrites, walk, type AnyNode, type Ids } from "./nodes.fsh";
import type { AssignOp, ClassMember, Expr, Param, Pattern, Stmt, TypeNode } from "./parser.fsh";
import { cloneExpr, cloneParam, cloneTypeNode, rebuiltStmts, withIdExpr } from "./rebuild.fsh";

// The reference-counted edition, `// @fish-edition rc`: a file whose classes and object types are
// shared as TypeScript shares objects. It is lowered to ownership Fish before anything else reads
// it: each of the file's own classes and object type aliases is held in an `Rc` wherever the file
// names it, `new C()` and an object literal of such a type make one, reading one into another
// place shares it with `clone()`, `===` compares identity, and a write or a changing method call
// through one runs inside its `update`. So no borrow error comes from these objects. Objects in a
// cycle are never freed, and a field that can lead back to its own type is warned about. A value
// passed to a function another file imports, from a file in the ownership edition, is cloned out
// of its `Rc`, since that file takes it by value.

// What the file declares a value of: an `Rc` of one of its types (`rc:Name`), a plain value of one
// (`plain:Name`, `this` in a class), an array (`[]` before what it holds, `?` for anything else),
// or a `Map` or `Set` (`collection`).
type Ty = string;
const COLLECTION = "collection";

type Field = { type: TypeNode; start: usize; end: usize };
type Method = { returns: TypeNode | undefined; mutating: boolean; written: boolean };
type Shape = { fields: Map<string, Field>; methods: Map<string, Method>; ctor: Param[]; isClass: boolean };
type Fn = { params: Param[]; returns: TypeNode | undefined };

// `mutating`: each method, as `Class.method`, found to change its object.
type Lowering = { shapes: Map<string, Shape>; fns: Map<string, Fn>; crossing: Set<string>; mutating: Set<string>; rewrites: Rewrites; skip: Set<usize>; count: usize };

// Where a body's values come from: the names it binds, what `this` is, and what it returns.
type Scope = { names: Map<string, Ty>; self: string | undefined; returns: Ty | undefined };

const ARRAY_CHANGES = new Set(["push", "pop", "shift", "unshift", "sort", "reverse", "splice", "fill", "copyWithin"]);
const COLLECTION_CHANGES = new Set(["set", "delete", "add", "clear"]);

// Lowers a file in the reference-counted edition in place, giving its warnings. `crossing` names
// the functions it imports from files in the ownership edition.
export function lowerRcEdition(ids: Mut<Ids>, statements: Mut<Stmt[]>, crossing: Ref<Set<string>>): CompileError[] {
  let cx: Lowering = { shapes: new Map<string, Shape>(), fns: new Map<string, Fn>(), crossing: new Set<string>([...crossing]), mutating: new Set<string>(), rewrites: new Rewrites(), skip: new Set<usize>(), count: 0 };
  for (const s of statements) declared(s, cx);
  settleMutating(statements, cx);
  if (cx.shapes.size === 0 && cx.crossing.size === 0) return [];
  walk({ of: "stmts", node: statements }, (n) => skipped(n, cx));
  walk({ of: "stmts", node: statements }, (n) => retyped(n, cx, ids));
  const top: Scope = { names: scopeNames(statements, cx, new Map<string, Ty>(), undefined), self: undefined, returns: undefined };
  for (const s of statements) lowered({ of: "stmt", node: s }, top, cx, ids);
  const warnings = cycles(cx);
  rebuiltStmts(statements, cx.rewrites);
  return warnings;
}

function declared(s: Ref<Stmt>, cx: Mut<Lowering>): void {
  if (s.kind === "export") {
    declared(s.body, cx);
    return;
  }
  if (s.kind === "function" && s.body !== undefined) {
    let params: Param[] = [];
    for (const p of s.params) params.push(cloneParam(p));
    cx.fns.set(s.name, { params, returns: s.returnType !== undefined ? cloneTypeNode(s.returnType!) : undefined });
    return;
  }
  if (s.kind === "typeAlias" && s.typeParams.length === 0 && s.type.kind === "object") {
    let fields = new Map<string, Field>();
    for (const m of s.type.members) {
      if (m.kind !== "property") return;
      if (typeof m.name === "string" && m.type !== undefined) fields.set(m.name, { type: cloneTypeNode(m.type!), start: m.start, end: m.end });
    }
    cx.shapes.set(s.name, { fields, methods: new Map<string, Method>(), ctor: [], isClass: false });
    return;
  }
  if (s.kind === "class" && s.name !== undefined && s.typeParams.length === 0) {
    let shape: Shape = { fields: new Map<string, Field>(), methods: new Map<string, Method>(), ctor: [], isClass: true };
    for (const m of s.members) member(m, shape);
    cx.shapes.set(s.name!, shape);
  }
}

function member(m: Ref<ClassMember>, shape: Mut<Shape>): void {
  if (m.modifiers.includes("static")) return;
  if (m.kind === "field" && typeof m.name === "string" && m.type !== undefined) shape.fields.set(m.name, { type: cloneTypeNode(m.type!), start: m.start, end: m.end });
  if (m.kind === "method" && typeof m.name === "string") {
    const mode = selfMode(m.params);
    shape.methods.set(m.name, { returns: m.returnType !== undefined ? cloneTypeNode(m.returnType!) : undefined, mutating: mode === "mut", written: mode !== "none" });
  }
  if (m.kind === "constructor") {
    for (const p of m.params) {
      shape.ctor.push(cloneParam(p));
      if (p.modifiers.length > 0 && p.pattern.kind === "ident" && p.type !== undefined) shape.fields.set(p.pattern.name, { type: cloneTypeNode(p.type!), start: p.start, end: p.end });
    }
  }
}

// How a method's written `this` parameter takes its object: "none" when it writes none.
function selfMode(params: Ref<Param[]>): string {
  if (params.length === 0) return "none";
  const p: Ref<Param> = params[0]!;
  if (p.pattern.kind !== "ident" || p.pattern.name !== "this") return "none";
  const t: Ref<TypeNode | undefined> = p.type;
  return t !== undefined && t.kind === "ref" && t.name === "Mut" ? "mut" : "shared";
}

// A method changes its object when it writes into `this` other than through a shared field, or
// calls a method that does; one that writes `this` itself is left to say so.
function settleMutating(statements: Ref<Stmt[]>, cx: Mut<Lowering>): void {
  let changed = true;
  while (changed) {
    changed = false;
    for (const s of statements) {
      const c: Ref<Stmt> = s.kind === "export" ? s.body : s;
      if (c.kind !== "class" || c.name === undefined || !cx.shapes.has(c.name!)) continue;
      for (const m of c.members) {
        if (m.kind !== "method" || typeof m.name !== "string" || m.body === undefined) continue;
        const key = `${c.name!}.${m.name}`;
        if (cx.mutating.has(key) || writtenSelf(cx, c.name!, m.name)) continue;
        const self: Scope = { names: new Map<string, Ty>(), self: c.name, returns: undefined };
        if (!changesThis(m.body!, self, cx)) continue;
        changed = true;
        cx.mutating.add(key);
      }
    }
  }
}

type Seen = { hit: boolean };

function changesThis(body: Ref<Stmt[]>, scope: Ref<Scope>, cx: Ref<Lowering>): boolean {
  let seen: Seen = { hit: false };
  walk({ of: "stmts", node: body }, (n) => {
    if (n.of !== "expr" || seen.hit) return;
    const e = n.node;
    if (e.kind === "assign" && rootIsThis(e.target) && prefixId(e.target, scope, cx) === undefined) seen.hit = true;
    if (e.kind === "update" && rootIsThis(e.operand) && prefixId(e.operand, scope, cx) === undefined) seen.hit = true;
    if (e.kind === "call" && e.callee.kind === "member" && rootIsThis(e.callee.object)) {
      const receiver = tyOf(e.callee.object, scope, cx);
      if (receiver !== undefined && receiver === `plain:${scope.self ?? ""}` && changing(receiver, e.callee.name, cx)) seen.hit = true;
      else if (receiver !== undefined && changes(receiver, e.callee.name) && prefixOfObject(e.callee.object, scope, cx) === undefined) seen.hit = true;
    }
  });
  return seen.hit;
}

// Whether a method writes its own `this` parameter.
function writtenSelf(cx: Ref<Lowering>, owner: string, name: string): boolean {
  const shape = cx.shapes.get(owner);
  const m = shape !== undefined ? shape.methods.get(name) : undefined;
  return m === undefined || m.written;
}

function rootIsThis(e: Ref<Expr>): boolean {
  if (e.kind === "this") return true;
  if (e.kind === "member" || e.kind === "index") return rootIsThis(e.object);
  if (e.kind === "nonNull") return rootIsThis(e.expr);
  return false;
}

// Whether calling `name` on a value of `ty` changes it: a method that changes its object.
function changing(ty: Ty, name: string, cx: Ref<Lowering>): boolean {
  const owner = ty.slice(ty.indexOf(":") + 1);
  const shape = cx.shapes.get(owner);
  const m = shape !== undefined ? shape.methods.get(name) : undefined;
  return m !== undefined && (m.mutating || cx.mutating.has(`${owner}.${name}`));
}

// Whether calling `name` changes an array or a collection.
function changes(ty: Ty, name: string): boolean {
  return (ty.startsWith("[]") && ARRAY_CHANGES.has(name)) || (ty === COLLECTION && COLLECTION_CHANGES.has(name));
}

// What a written type holds, as a `Ty`.
function typed(t: Ref<TypeNode | undefined>, cx: Ref<Lowering>): Ty | undefined {
  if (t === undefined) return undefined;
  if (t.kind === "ref" && t.args.length === 0 && cx.shapes.has(t.name)) return `rc:${t.name}`;
  if (t.kind === "ref" && t.name === "Rc" && t.args.length === 1) {
    const a: Ref<TypeNode> = t.args[0]!;
    return a.kind === "ref" && cx.shapes.has(a.name) ? `rc:${a.name}` : undefined;
  }
  if (t.kind === "ref" && (t.name === "Map" || t.name === "Set")) return COLLECTION;
  if (t.kind === "array") return `[]${typed(t.element, cx) ?? "?"}`;
  if (t.kind === "union") {
    const kept = t.types.filter((u) => !(u.kind === "ref" && (u.name === "null" || u.name === "undefined")) && u.kind !== "literal");
    return kept.length === 1 ? typed(kept[0]!, cx) : undefined;
  }
  return undefined;
}

function fieldTy(owner: Ty | undefined, name: string, cx: Ref<Lowering>): Ty | undefined {
  if (owner === undefined || owner.startsWith("[]")) return undefined;
  const shape = cx.shapes.get(owner.slice(owner.indexOf(":") + 1));
  const f = shape !== undefined ? shape.fields.get(name) : undefined;
  return f !== undefined ? typed(f.type, cx) : undefined;
}

// What an expression gives, as far as the file's own declarations say.
function tyOf(e: Ref<Expr>, scope: Ref<Scope>, cx: Ref<Lowering>): Ty | undefined {
  switch (e.kind) {
    case "ident":
      return scope.names.get(e.name);
    case "this":
      return scope.self !== undefined ? `plain:${scope.self!}` : undefined;
    case "member":
      return fieldTy(tyOf(e.object, scope, cx), e.name, cx);
    case "index": {
      const o = tyOf(e.object, scope, cx);
      return o !== undefined && o.startsWith("[]") ? o.slice(2) : undefined;
    }
    case "nonNull":
      return tyOf(e.expr, scope, cx);
    case "new":
      return e.callee.kind === "ident" && cx.shapes.has(e.callee.name) && cx.shapes.get(e.callee.name)!.isClass ? `rc:${e.callee.name}` : undefined;
    case "object":
      return undefined;
    case "conditional":
      return tyOf(e.then, scope, cx) ?? tyOf(e.else, scope, cx);
    case "binary":
      return e.op === "??" ? tyOf(e.left, scope, cx) : undefined;
    case "call": {
      if (e.callee.kind === "ident") {
        const f = cx.fns.get(e.callee.name);
        return f !== undefined ? typed(f.returns, cx) : undefined;
      }
      if (e.callee.kind !== "member") return undefined;
      const r = tyOf(e.callee.object, scope, cx);
      if (r === undefined || r.startsWith("[]")) return undefined;
      if (e.callee.name === "clone" && r.startsWith("rc:")) return r;
      const shape = cx.shapes.get(r.slice(r.indexOf(":") + 1));
      const m = shape !== undefined ? shape.methods.get(e.callee.name) : undefined;
      return m !== undefined ? typed(m.returns, cx) : undefined;
    }
    default:
      return undefined;
  }
}

function isPlace(e: Ref<Expr>): boolean {
  if (e.kind === "ident" || e.kind === "this") return true;
  if (e.kind === "member" || e.kind === "index") return isPlace(e.object);
  if (e.kind === "nonNull") return isPlace(e.expr);
  return false;
}

// The node, by id, of the longest proper part of a place that is an `Rc`, through which a write to
// the place goes; none for a place of a plain value.
function prefixId(e: Ref<Expr>, scope: Ref<Scope>, cx: Ref<Lowering>): usize | undefined {
  if (e.kind === "member" || e.kind === "index") return prefixOfObject(e.object, scope, cx);
  if (e.kind === "nonNull") return prefixId(e.expr, scope, cx);
  return undefined;
}

function prefixOfObject(e: Ref<Expr>, scope: Ref<Scope>, cx: Ref<Lowering>): usize | undefined {
  const t = tyOf(e, scope, cx);
  if (t !== undefined && t.startsWith("rc:") && isPlace(e)) return e.id;
  return prefixId(e, scope, cx);
}

// The names a body binds that hold the file's values, read in order, over what `outer` holds.
function scopeNames(body: Ref<Stmt[]>, cx: Ref<Lowering>, outer: Ref<Map<string, Ty>>, self: string | undefined): Map<string, Ty> {
  let names = new Map<string, Ty>();
  for (const [k, v] of outer) names.set(k, v);
  let scope: Scope = { names, self, returns: undefined };
  walk({ of: "stmts", node: body }, (n) => bound(n, scope, cx));
  return scope.names;
}

function bound(n: AnyNode, scope: Mut<Scope>, cx: Ref<Lowering>): void {
  if (n.of === "declarator" && n.node.target.kind === "ident") {
    const d = n.node;
    const t = d.type !== undefined ? typed(d.type, cx) : d.init !== undefined ? tyOf(d.init!, scope, cx) : undefined;
    if (t !== undefined) scope.names.set(n.node.target.name, t);
    else scope.names.delete(n.node.target.name);
  }
  if (n.of === "stmt" && n.node.kind === "forOf") {
    const left: Ref<Stmt | Pattern> = n.node.left;
    if (left.kind !== "let") return;
    const from = tyOf(n.node.right, scope, cx);
    for (const d of left.declarations) {
      if (d.target.kind !== "ident") continue;
      if (from !== undefined && from.startsWith("[]")) scope.names.set(d.target.name, from.slice(2));
      else scope.names.delete(d.target.name);
    }
  }
}

function paramNames(params: Ref<Param[]>, cx: Ref<Lowering>, outer: Ref<Map<string, Ty>>): Map<string, Ty> {
  let names = new Map<string, Ty>();
  for (const [k, v] of outer) names.set(k, v);
  for (const p of params) {
    if (p.pattern.kind !== "ident") continue;
    const t = typed(p.type, cx);
    if (t !== undefined) names.set(p.pattern.name, t);
    else names.delete(p.pattern.name);
  }
  return names;
}

// Marks the written types inside `Rc<...>` and `Weak<...>`, and a `new Rc(new C())` already
// written, which are left as they are.
function skipped(n: AnyNode, cx: Mut<Lowering>): void {
  if (n.of === "typeNode" && n.node.kind === "ref" && (n.node.name === "Rc" || n.node.name === "Weak")) {
    for (const a of n.node.args) walk({ of: "typeNode", node: a }, (m) => marked(m, cx));
  }
  if (n.of === "expr" && n.node.kind === "new" && n.node.callee.kind === "ident" && (n.node.callee.name === "Rc" || n.node.callee.name === "Weak")) {
    for (const a of n.node.typeArgs) walk({ of: "typeNode", node: a }, (m) => marked(m, cx));
    if (n.node.args !== undefined) for (const a of n.node.args!) cx.skip.add(a.id);
  }
}

function marked(n: AnyNode, cx: Mut<Lowering>): void {
  if (n.of === "typeNode") cx.skip.add(n.node.id);
}

// Each written type naming one of the file's types is an `Rc` of it.
function retyped(n: AnyNode, cx: Mut<Lowering>, ids: Mut<Ids>): void {
  if (n.of !== "typeNode" || n.node.kind !== "ref" || n.node.args.length > 0 || !cx.shapes.has(n.node.name) || cx.skip.has(n.node.id)) return;
  const t = n.node;
  const inner: TypeNode = { id: nextId(ids), kind: "ref", name: t.name, args: [], start: t.start, end: t.end };
  cx.rewrites.replaceTypeNode(t, { id: nextId(ids), kind: "ref", name: "Rc", args: [inner], start: t.start, end: t.end });
}

// Lowers a node and what it holds, each nested function in a scope of its own.
function lowered(n: AnyNode, scope: Ref<Scope>, cx: Mut<Lowering>, ids: Mut<Ids>): void {
  node(reborrowNode(n), scope, cx, ids);
  const inner = innerScope(reborrowNode(n), scope, cx);
  if (inner !== undefined) forEachChild(n, (c) => lowered(c, inner!, cx, ids));
  else forEachChild(n, (c) => lowered(c, scope, cx, ids));
}

// The scope a function's body is lowered in, or undefined for a node that is no function.
function innerScope(n: AnyNode, scope: Ref<Scope>, cx: Ref<Lowering>): Scope | undefined {
  if (n.of === "stmt" && n.node.kind === "function" && n.node.body !== undefined) {
    const names = paramNames(n.node.params, cx, scope.names);
    return { names: scopeNames(n.node.body!, cx, names, scope.self), self: scope.self, returns: typed(n.node.returnType, cx) };
  }
  if (n.of === "stmt" && n.node.kind === "class" && n.node.name !== undefined) return { names: paramNames([], cx, scope.names), self: n.node.name, returns: undefined };
  if (n.of === "classMember" && n.node.kind !== "field" && n.node.kind !== "index" && n.node.kind !== "staticBlock" && n.node.body !== undefined) {
    const m = n.node;
    const names = paramNames(m.params, cx, scope.names);
    const returns = m.kind === "method" || m.kind === "get" ? typed(m.returnType, cx) : undefined;
    return { names: scopeNames(m.body!, cx, names, scope.self), self: scope.self, returns };
  }
  if (n.of === "expr" && (n.node.kind === "arrow" || n.node.kind === "function")) {
    const e = n.node;
    const names = paramNames(e.params, cx, scope.names);
    const body: Ref<Expr | Stmt[]> = e.body;
    if (Array.isArray(body)) return { names: scopeNames(body, cx, names, scope.self), self: scope.self, returns: typed(e.returnType, cx) };
    return { names, self: scope.self, returns: typed(e.returnType, cx) };
  }
  return undefined;
}

function node(n: AnyNode, scope: Ref<Scope>, cx: Mut<Lowering>, ids: Mut<Ids>): void {
  if (n.of === "declarator") {
    const d = n.node;
    if (d.init !== undefined) {
      expect(d.init!, typed(d.type, cx), scope, cx, ids);
      shared(d.init!, scope, cx, ids);
    }
    return;
  }
  if (n.of === "classMember") {
    const m = n.node;
    if (m.kind === "field" && m.init !== undefined) {
      expect(m.init!, typed(m.type, cx), scope, cx, ids);
      shared(m.init!, scope, cx, ids);
    }
    if (m.kind === "method" && m.body !== undefined && typeof m.name === "string" && scope.self !== undefined && cx.mutating.has(`${scope.self!}.${m.name}`)) {
      cx.rewrites.replaceClassMember(m, { ...m, params: [selfParam(ids, m.start), ...m.params.map((p) => cloneParam(p))] });
    }
    return;
  }
  if (n.of === "objectProp") {
    const p = n.node;
    if (p.kind === "property") shared(p.value, scope, cx, ids);
    if (p.kind === "shorthand" && p.default === undefined && (scope.names.get(p.name) ?? "").startsWith("rc:")) {
      const at = { start: p.start, end: p.end };
      const named: Expr = { id: nextId(ids), kind: "ident", name: p.name, ...at };
      const value = cloned(named, ids);
      cx.rewrites.replaceObjectProp(p, { id: p.id, kind: "property", key: p.name, value, ...at });
    }
    return;
  }
  if (n.of === "stmt") {
    statement(n.node, scope, cx, ids);
    return;
  }
  if (n.of === "expr") expression(n.node, scope, cx, ids);
}

function statement(s: Ref<Stmt>, scope: Ref<Scope>, cx: Mut<Lowering>, ids: Mut<Ids>): void {
  if (s.kind === "return" && s.value !== undefined) {
    expect(s.value!, scope.returns, scope, cx, ids);
    shared(s.value!, scope, cx, ids);
    return;
  }
  if (s.kind !== "expr") return;
  const e: Ref<Expr> = s.expr;
  if (e.kind === "assign") {
    const p = prefixId(e.target, scope, cx);
    if (p === undefined) return;
    const at = { start: s.start, end: s.end };
    const held = `rc ${cx.count++}`;
    const it = `rc it ${cx.count++}`;
    const keep: Stmt = { id: nextId(ids), kind: "let", keyword: "const", declarations: [{ id: nextId(ids), target: { id: nextId(ids), kind: "ident", name: held, ...at }, type: undefined, init: cloneExpr(e.value), ...at }], ...at };
    const target = rerooted(e.target, p, it, ids);
    const value: Expr = { id: nextId(ids), kind: "ident", name: held, ...at };
    const op: AssignOp = e.op;
    const write: Expr = { id: nextId(ids), kind: "assign", op, target, value, start: s.start, end: s.end };
    const change: Stmt = { id: nextId(ids), kind: "expr", expr: updated(e.target, p, it, write, ids), ...at };
    cx.rewrites.replaceStmt(s, { id: s.id, kind: "block", body: [keep, change], ...at });
    return;
  }
  if (e.kind === "update") {
    const p = prefixId(e.operand, scope, cx);
    if (p === undefined) return;
    const it = `rc it ${cx.count++}`;
    const at = { start: s.start, end: s.end };
    const operand = rerooted(e.operand, p, it, ids);
    const op: "++" | "--" = e.op;
    const prefix: boolean = e.prefix;
    const write: Expr = { id: nextId(ids), kind: "update", op, prefix, operand, start: s.start, end: s.end };
    cx.rewrites.replaceStmt(s, { id: s.id, kind: "expr", expr: updated(e.operand, p, it, write, ids), ...at });
  }
}

function expression(e: Ref<Expr>, scope: Ref<Scope>, cx: Mut<Lowering>, ids: Mut<Ids>): void {
  const at = { start: e.start, end: e.end };
  if (e.kind === "new") {
    const c = cx.shapes.get(e.callee.kind === "ident" ? e.callee.name : "");
    const isClass = c !== undefined && c.isClass;
    const params: (Ty | undefined)[] = c !== undefined ? c.ctor.map((p) => typed(p.type, cx)) : [];
    if (e.args !== undefined) for (let i: usize = 0; i < e.args!.length && i < params.length; i++) expect(e.args![i]!, params[i], scope, cx, ids);
    if (e.args !== undefined) for (const a of e.args!) shared(a, scope, cx, ids);
    if (isClass && !cx.skip.has(e.id)) {
      const made = withIdExpr(cloneExpr(e), nextId(ids), 0);
      const rc: Expr = { id: nextId(ids), kind: "ident", name: "Rc", ...at };
      cx.rewrites.replaceAt(e.id, { id: e.id, kind: "new", callee: rc, typeArgs: [], args: [made], ...at });
    }
    return;
  }
  if (e.kind === "binary" && (e.op === "===" || e.op === "!==")) {
    if (!(tyOf(e.left, scope, cx) ?? "").startsWith("rc:") || !(tyOf(e.right, scope, cx) ?? "").startsWith("rc:")) return;
    const rc: Expr = { id: nextId(ids), kind: "ident", name: "Rc", ...at };
    const ptrEq: Expr = { id: nextId(ids), kind: "member", object: rc, name: "ptrEq", optional: false, ...at };
    const same: Expr = { id: nextId(ids), kind: "call", callee: ptrEq, typeArgs: [], args: [cloneExpr(e.left), cloneExpr(e.right)], optional: false, ...at };
    cx.rewrites.replaceAt(e.id, e.op === "===" ? same : { id: nextId(ids), kind: "unary", op: "!", operand: same, ...at });
    return;
  }
  if (e.kind === "assign" && e.op === "=") {
    expect(e.value, tyOf(e.target, scope, cx), scope, cx, ids);
    shared(e.value, scope, cx, ids);
    return;
  }
  if (e.kind === "array") {
    for (const x of e.elements) if (x !== undefined) shared(x, scope, cx, ids);
    return;
  }
  if (e.kind !== "call") return;
  if (e.callee.kind === "ident") {
    const f = cx.fns.get(e.callee.name);
    const params: (Ty | undefined)[] = f !== undefined ? f.params.map((p) => typed(p.type, cx)) : [];
    for (let i: usize = 0; i < e.args.length && i < params.length; i++) expect(e.args[i]!, params[i], scope, cx, ids);
    if (cx.crossing.has(e.callee.name)) {
      for (const a of e.args) crossed(a, scope, cx, ids);
      return;
    }
  }
  for (const a of e.args) shared(a, scope, cx, ids);
  if (e.callee.kind !== "member") return;
  const receiver: Ref<Expr> = e.callee.object;
  const r = tyOf(receiver, scope, cx);
  if (r !== undefined && r.startsWith("[]") && e.callee.name === "push") for (const a of e.args) expect(a, r.slice(2), scope, cx, ids);
  let p: usize | undefined = undefined;
  if (r !== undefined && r.startsWith("rc:") && isPlace(receiver) && changing(r, e.callee.name, cx)) p = receiver.id;
  else if (r !== undefined && changes(r, e.callee.name)) p = prefixOfObject(receiver, scope, cx);
  if (p === undefined) return;
  const it = `rc it ${cx.count++}`;
  const object = rerootedOrIt(receiver, p, it, ids);
  const method: Expr = { id: nextId(ids), kind: "member", object, name: e.callee.name, optional: false, start: e.callee.start, end: e.callee.end };
  const call: Expr = { id: nextId(ids), kind: "call", callee: method, typeArgs: e.typeArgs.map((t) => cloneTypeNode(t)), args: e.args.map((a) => cloneExpr(a)), optional: false, ...at };
  cx.rewrites.replaceAt(e.id, updated(receiver, p, it, call, ids));
}

// `receiver` with the part `p` taken as `it`, or `it` itself when `receiver` is that part.
function rerootedOrIt(receiver: Ref<Expr>, p: usize, it: string, ids: Mut<Ids>): Expr {
  if (receiver.id === p) return { id: nextId(ids), kind: "ident", name: it, start: receiver.start, end: receiver.end };
  return rerooted(receiver, p, it, ids);
}

// `place.update((it) => change)`, where `place` is the part of `whole` with id `p`.
function updated(whole: Ref<Expr>, p: usize, it: string, change: Expr, ids: Mut<Ids>): Expr {
  const at = { start: change.start, end: change.end };
  const param: Param = { id: nextId(ids), pattern: { id: nextId(ids), kind: "ident", name: it, ...at }, type: undefined, optional: false, rest: false, default: undefined, modifiers: [], decorators: [], comptime: false, ...at };
  const body: Stmt = { id: nextId(ids), kind: "expr", expr: change, ...at };
  const callback: Expr = { id: nextId(ids), kind: "arrow", move: false, async: false, typeParams: [], params: [param], returnType: undefined, body: [body], ...at };
  const found = partAt(whole, p);
  const place: Expr = found !== undefined ? found : { id: nextId(ids), kind: "ident", name: it, ...at };
  const callee: Expr = { id: nextId(ids), kind: "member", object: place, name: "update", optional: false, ...at };
  return { id: nextId(ids), kind: "call", callee, typeArgs: [], args: [callback], optional: false, ...at };
}

// A copy of the part of `e` with id `p`.
function partAt(e: Ref<Expr>, p: usize): Expr | undefined {
  if (e.id === p) return cloneExpr(e);
  if (e.kind === "member" || e.kind === "index") return partAt(e.object, p);
  if (e.kind === "nonNull") return partAt(e.expr, p);
  return undefined;
}

// `e` with its part of id `p` read as `it`, as an `update` callback reads it.
function rerooted(e: Ref<Expr>, p: usize, it: string, ids: Mut<Ids>): Expr {
  const at = { start: e.start, end: e.end };
  if (e.id === p) return { id: nextId(ids), kind: "ident", name: it, ...at };
  if (e.kind === "member") return { id: nextId(ids), kind: "member", object: rerooted(e.object, p, it, ids), name: e.name, optional: e.optional, ...at };
  if (e.kind === "index") return { id: nextId(ids), kind: "index", object: rerooted(e.object, p, it, ids), index: cloneExpr(e.index), optional: e.optional, ...at };
  if (e.kind === "nonNull") return { id: nextId(ids), kind: "nonNull", expr: rerooted(e.expr, p, it, ids), ...at };
  return cloneExpr(e);
}

// Reading a shared value into another place shares it.
function shared(e: Ref<Expr>, scope: Ref<Scope>, cx: Mut<Lowering>, ids: Mut<Ids>): void {
  if (e.kind === "this" || !isPlace(e) || !(tyOf(e, scope, cx) ?? "").startsWith("rc:")) return;
  cx.rewrites.replaceAt(e.id, cloned(renumberExpr(cloneExpr(e), () => nextId(ids)), ids));
}

// A shared value given to the ownership edition is a copy of what it holds.
function crossed(e: Ref<Expr>, scope: Ref<Scope>, cx: Mut<Lowering>, ids: Mut<Ids>): void {
  if (!(tyOf(e, scope, cx) ?? "").startsWith("rc:")) return;
  const at = { start: e.start, end: e.end };
  const v = `rc it ${cx.count++}`;
  const inner = isPlace(e) ? renumberExpr(cloneExpr(e), () => nextId(ids)) : withIdExpr(cloneExpr(e), nextId(ids), 0);
  const param: Param = { id: nextId(ids), pattern: { id: nextId(ids), kind: "ident", name: v, ...at }, type: undefined, optional: false, rest: false, default: undefined, modifiers: [], decorators: [], comptime: false, ...at };
  const copy = cloned({ id: nextId(ids), kind: "ident", name: v, ...at }, ids);
  const callback: Expr = { id: nextId(ids), kind: "arrow", move: false, async: false, typeParams: [], params: [param], returnType: undefined, body: copy, ...at };
  const read: Expr = { id: nextId(ids), kind: "member", object: inner, name: "read", optional: false, ...at };
  cx.rewrites.replaceAt(e.id, { id: nextId(ids), kind: "call", callee: read, typeArgs: [], args: [callback], optional: false, ...at });
}

function cloned(e: Expr, ids: Mut<Ids>): Expr {
  const at = { start: e.start, end: e.end };
  const callee: Expr = { id: nextId(ids), kind: "member", object: e, name: "clone", optional: false, ...at };
  return { id: nextId(ids), kind: "call", callee, typeArgs: [], args: [], optional: false, ...at };
}

// An object literal where a value of one of the file's types is expected makes one, in an `Rc`.
function expect(e: Ref<Expr>, ty: Ty | undefined, scope: Ref<Scope>, cx: Mut<Lowering>, ids: Mut<Ids>): void {
  if (ty === undefined) return;
  if (ty.startsWith("[]") && e.kind === "array") {
    for (const x of e.elements) if (x !== undefined) expect(x, ty.slice(2), scope, cx, ids);
    return;
  }
  if (!ty.startsWith("rc:") || e.kind !== "object") return;
  const name = ty.slice(3);
  for (const p of e.props) if (p.kind === "property" && typeof p.key === "string") expect(p.value, fieldTy(ty, p.key, cx), scope, cx, ids);
  const at = { start: e.start, end: e.end };
  const made = withIdExpr(cloneExpr(e), nextId(ids), 0);
  const rc: Expr = { id: nextId(ids), kind: "ident", name: "Rc", ...at };
  const typeArg: TypeNode = { id: nextId(ids), kind: "ref", name, args: [], ...at };
  cx.rewrites.replaceAt(e.id, { id: e.id, kind: "new", callee: rc, typeArgs: [typeArg], args: [made], ...at });
}

function selfParam(ids: Mut<Ids>, at: usize): Param {
  const span = { start: at, end: at };
  const self: TypeNode = { id: nextId(ids), kind: "ref", name: "this", args: [], ...span };
  return { id: nextId(ids), pattern: { id: nextId(ids), kind: "ident", name: "this", ...span }, type: { id: nextId(ids), kind: "ref", name: "Mut", args: [self], ...span }, optional: false, rest: false, default: undefined, modifiers: [], decorators: [], comptime: false, ...span };
}

// A warning at each field through which one of the file's types can hold itself.
function cycles(cx: Ref<Lowering>): CompileError[] {
  let out: CompileError[] = [];
  for (const [name, shape] of cx.shapes) {
    for (const [field, f] of shape.fields) {
      const to = heldType(typed(f.type, cx));
      if (to === undefined || !reaches(to, name, cx, new Set<string>())) continue;
      out.push(new CompileError("W0005", `'${name}.${field}' can lead back to a '${name}', and reference-counted objects that hold each other in a cycle are never freed; make one link of the cycle a 'Weak'`, f.start, f.end));
    }
  }
  return out;
}

function heldType(t: Ty | undefined): string | undefined {
  if (t === undefined) return undefined;
  const bare = t.replace(/^(\[\])*/, "");
  return bare.startsWith("rc:") ? bare.slice(3) : undefined;
}

function reaches(from: string, to: string, cx: Ref<Lowering>, seen: Mut<Set<string>>): boolean {
  if (from === to) return true;
  if (seen.has(from)) return false;
  seen.add(from);
  const shape = cx.shapes.get(from);
  if (shape === undefined) return false;
  for (const f of shape.fields.values()) {
    const next = heldType(typed(f.type, cx));
    if (next !== undefined && reaches(next, to, cx, seen)) return true;
  }
  return false;
}
