import { CompileError, type Names } from "./diag.fsh";
import type { ClassMember, Expr, Modifier, ObjectProp, Param, Pattern, PropertyName, Span, Stmt, TypeNode, TypeParam } from "./parser.fsh";
import { dup, forEachChild, nextId, nodeIdOf, reborrowNode, Rewrites, someNode, walk, type AnyNode, type Ids } from "./nodes.fsh";
import { cloneClassMember, cloneExpr, cloneObjectProp, cloneParam, clonePattern, cloneStmt, cloneStmts, cloneTypeNode, cloneTypeParam, rebuiltClassMember, rebuiltStmt, rebuiltStmts } from "./rebuild.fsh";

// Local declarations: a `type`, `interface`, `enum` or `class` written in a body is a
// declaration of the program's own, under a name only its scope can write. The uses in its scope
// are renamed to it, and the enclosing body's type parameters it names become type parameters
// of its own, given as type arguments wherever it is used, so it has an instance per instance of
// the body. A local class or enum can't use the body's variables, which it would outlive.

export type Local = Extract<Stmt, { kind: "typeAlias" | "interface" | "class" | "enum" }>;
// The type parameters a body sees, and the variables in scope there that a local class or enum
// would outlive.
type Context = { typeParams: TypeParam[]; declared: Set<string> };

function isLocal(s: Ref<Stmt>): boolean {
  if (s.kind === "typeAlias" || s.kind === "interface" || s.kind === "enum") return true;
  if (s.kind === "class" && s.name !== undefined) return true;
  return false;
}

function localName(s: Ref<Stmt>): string {
  if (s.kind === "typeAlias") return s.name;
  if (s.kind === "interface") return s.name;
  if (s.kind === "enum") return s.name;
  if (s.kind === "class" && s.name !== undefined) return s.name;
  return "";
}

function hasOwnTypeParam(s: Ref<Stmt>, name: string): boolean {
  if (s.kind === "typeAlias") return s.typeParams.some((q) => q.name === name);
  if (s.kind === "interface") return s.typeParams.some((q) => q.name === name);
  if (s.kind === "enum") return s.typeParams.some((q) => q.name === name);
  if (s.kind === "class") return s.typeParams.some((q) => q.name === name);
  return false;
}

function ownTypeParamsCount(s: Ref<Stmt>): usize {
  if (s.kind === "typeAlias") return s.typeParams.length;
  if (s.kind === "interface") return s.typeParams.length;
  if (s.kind === "enum") return s.typeParams.length;
  if (s.kind === "class") return s.typeParams.length;
  return 0;
}

function appendOwnTypeParams(s: Ref<Stmt>, out: Mut<TypeParam[]>): void {
  if (s.kind === "typeAlias") for (const p of s.typeParams) out.push(cloneTypeParam(p));
  else if (s.kind === "interface") for (const p of s.typeParams) out.push(cloneTypeParam(p));
  else if (s.kind === "enum") for (const p of s.typeParams) out.push(cloneTypeParam(p));
  else if (s.kind === "class") for (const p of s.typeParams) out.push(cloneTypeParam(p));
}

function asLocal(s: Ref<Stmt>): Local | undefined {
  const c = cloneStmt(s);
  if (c.kind === "typeAlias" || c.kind === "interface" || c.kind === "enum") return c;
  if (c.kind === "class" && c.name !== undefined) return c;
  return undefined;
}

/** @throws {CompileError} */
type ChildStep = (c: AnyNode) => void;

/** @throws {CompileError} */
function eachChild(node: AnyNode, step: ChildStep): void {
  let failed: CompileError | undefined = undefined;
  forEachChild(node, (c) => {
    if (failed !== undefined) return;
    try {
      step(c);
    } catch (e) {
      if (e instanceof CompileError) failed = e;
    }
  });
  if (failed !== undefined) throw failed!;
}

type HoistEnv = { names: Names; ids: Ids };

class Hoister {
  ids: Ids;
  localNames = new Set<string>();
  hasCapture: boolean;
  capturedLocals: [Local, string][] = [];
  hoisted: Stmt[] = [];
  evicted: [usize, Stmt][] = [];
  count: usize = 0;
  rewrites = new Rewrites();

  constructor(lastId: usize, hasCapture: boolean) {
    this.ids = { last: lastId };
    this.hasCapture = hasCapture;
  }

  /** @throws {CompileError} */
  visitCallable(this: Mut<this>, ctx: Ref<Context> | undefined, tp: Ref<TypeParam[]>, params: Ref<Param[]>, body: Ref<Stmt[]>): void {
    let declared = ctx !== undefined ? new Set<string>([...ctx.declared]) : new Set<string>();
    for (const p of params) for (const x of namesIn(p.pattern)) declared.add(x);
    const inner: Context = {
      typeParams: shadowed(ctx, tp),
      declared,
    };
    this.list(body, inner);
    for (const p of params) this.visit({ of: "param", node: p }, inner);
  }

  // Inside a body, each list of statements is a block.
  /** @throws {CompileError} */
  visit(this: Mut<this>, node: AnyNode, ctx: Ref<Context> | undefined): void {
    if (node.of === "stmts") {
      if (ctx !== undefined) this.list(node.node, ctx);
      return;
    }
    // A case's test is no block's, and runs nothing a local is declared in.
    if (node.of === "switchCase") {
      if (ctx !== undefined) this.list(node.node.body, ctx);
      return;
    }
    if (node.of === "stmt") {
      const peeked = this.rewrites.getStmt(node.node.id);
      const s: Ref<Stmt> = peeked !== undefined ? peeked : node.node;
      if (s.kind === "function" && s.body !== undefined) {
        this.visitCallable(ctx, s.typeParams, s.params, s.body);
        return;
      }
      if (s.kind === "class") {
        const inner: Context = {
          typeParams: shadowed(ctx, s.typeParams),
          declared: ctx !== undefined ? new Set<string>([...ctx.declared]) : new Set<string>(),
        };
        eachChild({ of: "stmt", node: s }, (c) => {
          if (c.of !== "typeParam") this.visit(c, inner);
        });
        return;
      }
      const head: string[] = ctx !== undefined ? headNamesStmt(s) : [];
      if (head.length > 0 && ctx !== undefined) {
        const here: Context = { typeParams: ctx.typeParams.map((p) => cloneTypeParam(p)), declared: new Set([...ctx.declared, ...head]) };
        eachChild({ of: "stmt", node: s }, (c) => {
          this.visit(c, here);
        });
        return;
      }
      eachChild({ of: "stmt", node: s }, (c) => {
        this.visit(c, ctx);
      });
      return;
    }
    if (node.of === "expr") {
      const peeked = this.rewrites.getExpr(node.node.id);
      const e: Ref<Expr> = peeked !== undefined ? peeked : node.node;
      if (e.kind === "arrow") {
        let declared = ctx !== undefined ? new Set<string>([...ctx.declared]) : new Set<string>();
        for (const p of e.params) for (const x of namesIn(p.pattern)) declared.add(x);
        const inner: Context = {
          typeParams: shadowed(ctx, e.typeParams),
          declared,
        };
        if (Array.isArray(e.body)) this.list(e.body, inner);
        else this.visit({ of: "expr", node: e.body }, inner);
        for (const p of e.params) this.visit({ of: "param", node: p }, inner);
        return;
      }
      if (e.kind === "function") {
        this.visitCallable(ctx, e.typeParams, e.params, e.body);
        return;
      }
      if (e.kind === "class") {
        const inner: Context = {
          typeParams: shadowed(ctx, e.typeParams),
          declared: ctx !== undefined ? new Set<string>([...ctx.declared]) : new Set<string>(),
        };
        eachChild({ of: "expr", node: e }, (c) => {
          if (c.of !== "typeParam") this.visit(c, inner);
        });
        return;
      }
      eachChild({ of: "expr", node: e }, (c) => {
        this.visit(c, ctx);
      });
      return;
    }
    if (node.of === "typeNode") {
      const peeked = this.rewrites.getTypeNode(node.node.id);
      const t: Ref<TypeNode> = peeked !== undefined ? peeked : node.node;
      eachChild({ of: "typeNode", node: t }, (c) => {
        this.visit(c, ctx);
      });
      return;
    }
    if (node.of === "pattern") {
      const peeked = this.rewrites.getPattern(node.node.id);
      const p: Ref<Pattern> = peeked !== undefined ? peeked : node.node;
      eachChild({ of: "pattern", node: p }, (c) => {
        this.visit(c, ctx);
      });
      return;
    }
    if (node.of === "classMember") {
      const m = node.node;
      if (m.kind === "method" && m.body !== undefined) {
        this.visitCallable(ctx, m.typeParams, m.params, m.body);
        return;
      }
      if (m.kind === "constructor" && m.body !== undefined) {
        this.visitCallable(ctx, [], m.params, m.body);
        return;
      }
      if (m.kind === "get" && m.body !== undefined) {
        this.visitCallable(ctx, [], m.params, m.body);
        return;
      }
      if (m.kind === "set" && m.body !== undefined) {
        this.visitCallable(ctx, [], m.params, m.body);
        return;
      }
      eachChild(node, (c) => {
        this.visit(c, ctx);
      });
      return;
    }
    if (node.of === "objectProp") {
      const p = node.node;
      if (p.kind === "method") {
        this.visitCallable(ctx, p.typeParams, p.params, p.body);
        return;
      }
      if (p.kind === "get") {
        this.visitCallable(ctx, [], p.params, p.body);
        return;
      }
      if (p.kind === "set") {
        this.visitCallable(ctx, [], p.params, p.body);
        return;
      }
      eachChild(node, (c) => {
        this.visit(c, ctx);
      });
      return;
    }
    eachChild(node, (c) => {
      this.visit(c, ctx);
    });
  }

  // A block's statements. Each local declaration in it is renamed throughout the block, as
  // TypeScript scopes it to the whole block, and hoisted.
  /** @throws {CompileError} */
  list(this: Mut<this>, stmts: Ref<Stmt[]>, outer: Ref<Context>): void {
    const ctx: Context = { typeParams: outer.typeParams.map((p) => cloneTypeParam(p)), declared: new Set([...outer.declared, ...stmts.flatMap((s) => valueNames(s))]) };
    let localIndices: usize[] = [];
    for (let i: usize = 0; i < stmts.length; i++) {
      if (isLocal(stmts[i]!)) localIndices.push(i);
    }
    // Which outer type parameters a local uses is read with the renames made so far, since a
    // local naming an outer local class uses the parameters it was given.
    let viewed: Stmt[] = [];
    if (localIndices.length > 0) for (const s of stmts) viewed.push(rebuiltStmt(cloneStmt(s), this.rewrites));
    const uses = generics(viewed, localIndices, ctx.typeParams);
    let renames: Rename[] = [];
    for (let idx: usize = 0; idx < localIndices.length; idx++) {
      const pos = localIndices[idx]!;
      const local: Ref<Stmt> = stmts[pos]!;
      const name = localName(local);
      // Its name holds no '.', which would read as an enum's member.
      const mangled = `${name}@${this.count++}`;
      this.localNames.add(mangled);
      const params = uses.get(local.id)!;
      const isClassOrEnum = local.kind === "class" || local.kind === "enum";
      if (isClassOrEnum) {
        const own = declaredWithin(local);
        const used = [...namesUsed(local)].find((u) => ctx.declared.has(u) && !own.has(u));
        if (used !== undefined) {
          const whatKind = local.kind === "class" ? `class '${name}'` : `enum '${name}'`;
          if (this.hasCapture) this.capturedLocals.push([asLocal(local)!, used]);
          else throw new CompileError("E0409", `the local ${whatKind} can't use '${used}' from the function around it, which it may outlive; ${local.kind === "class" ? "pass it to its constructor" : "use a constant from the top level"}`, local.start, local.end);
        }
        if (!this.hasCapture) {
          for (let j: usize = 0; j < pos; j++) {
            const sj: Ref<Stmt> = stmts[j]!;
            if (runsUse(sj, name)) {
              throw new CompileError("E0403", `${what(local)} '${name}' is used before its declaration`, sj.start, sj.end);
            }
          }
        }
      }
      const own = ownTypeParamsCount(local);
      let mergedParams: TypeParam[] = [];
      for (const p of params) {
        let cp = cloneTypeParam(p);
        cp.id = nextId(this.ids);
        mergedParams.push(cp);
      }
      appendOwnTypeParams(local, mergedParams);
      let clonedLocal = cloneStmt(local);
      if (clonedLocal.kind === "typeAlias") {
        clonedLocal.name = mangled;
        clonedLocal.typeParams = mergedParams;
      } else if (clonedLocal.kind === "interface") {
        clonedLocal.name = mangled;
        clonedLocal.typeParams = mergedParams;
      } else if (clonedLocal.kind === "class") {
        clonedLocal.name = mangled;
        clonedLocal.typeParams = mergedParams;
      } else if (clonedLocal.kind === "enum") {
        clonedLocal.name = mangled;
        clonedLocal.typeParams = mergedParams;
      }
      const replaced = this.rewrites.replaceStmt(local, clonedLocal);
      const [forHoist] = dup(replaced);
      this.hoisted.push(forHoist);
      this.evicted.push([local.id, { id: nextId(this.ids), kind: "empty", start: local.start, end: local.end }]);
      renames.push({ name, mangled, paramNames: params.map((p) => p.name), at: { start: local.start, end: local.start }, own, values: local.kind === "class" || local.kind === "enum" });
    }
    for (const r of renames) for (const s of stmts) rename({ of: "stmt", node: s }, r, this.rewrites, this.ids);
    for (const s of stmts) this.visit({ of: "stmt", node: s }, ctx);
  }
}

// The declarations hoisting made program-wide, and, when asked for, where each local class or
// enum using a variable around it starts, in the order found.
export type Hoisted = { hoisted: Stmt[]; captured: usize[] };

// Each name made is noted in `names`, and each node made numbered from `ids`. A local class or
// enum using a variable around it is an error, unless `collect` asks for them to be listed.
/** @throws {CompileError} */
export function hoistLocals(env: Mut<HoistEnv>, program: Mut<Stmt[]>, collect: boolean = false): Hoisted {
  let h = new Hoister(env.ids.last, collect);
  for (const s of program) h.visit({ of: "stmt", node: s }, undefined);
  env.ids.last = h.ids.last;
  for (const name of h.localNames) env.names.local.add(name);
  let captured: usize[] = [];
  for (const [loc, _used] of h.capturedLocals) captured.push(loc.start);
  rebuiltStmts(h.hoisted, h.rewrites);
  // A local declared in a hoisted class's method leaves that method too; the hoisted
  // declarations themselves are evicted only from where they were written, so only their
  // members are rebuilt with the evictions.
  let evictions = new Rewrites();
  for (let ev = h.evicted; ev.length > 0; ) {
    const [id, empty] = ev.shift()!;
    evictions.evictStmt(id, cloneStmt(empty));
    h.rewrites.evictStmt(id, empty);
  }
  let hoisted = h.hoisted.splice(0);
  hoisted.reverse();
  while (hoisted.length > 0) {
    const s = hoisted.pop()!;
    if (s.kind === "class") {
      let kept: ClassMember[] = [];
      for (const m of s.members) kept.push(rebuiltClassMember(cloneClassMember(m), evictions));
      h.hoisted.push({ ...s, members: kept });
    } else h.hoisted.push(s);
  }
  rebuiltStmts(program, h.rewrites);
  return { hoisted: h.hoisted, captured };
}

// The outer type parameters each local uses, itself or through a local it names, in the order
// the body declares them.
function generics(stmts: Ref<Stmt[]>, localIndices: Ref<usize[]>, typeParams: Ref<TypeParam[]>): Map<usize, TypeParam[]> {
  let used = new Map<usize, Set<string>>();
  for (let i: usize = 0; i < localIndices.length; i++) {
    const l: Ref<Stmt> = stmts[localIndices[i]!]!;
    let set = new Set<string>();
    for (let j: usize = 0; j < typeParams.length; j++) {
      const p: Ref<TypeParam> = typeParams[j]!;
      if (refersTo(l, p.name) && !hasOwnTypeParam(l, p.name)) set.add(p.name);
    }
    used.set(l.id, set);
  }
  for (let grew = true; grew; ) {
    grew = false;
    for (let i: usize = 0; i < localIndices.length; i++) {
      const l: Ref<Stmt> = stmts[localIndices[i]!]!;
      for (let j: usize = 0; j < localIndices.length; j++) {
        const m: Ref<Stmt> = stmts[localIndices[j]!]!;
        if (m.id === l.id || !mentions(l, localName(m))) continue;
        const mNames: string[] = [...used.get(m.id)!];
        for (const pName of mNames) {
          if (used.get(l.id)!.has(pName) || hasOwnTypeParam(l, pName)) continue;
          let nextSet = new Set<string>([...used.get(l.id)!, pName]);
          used.set(l.id, nextSet);
          grew = true;
        }
      }
    }
  }
  let out = new Map<usize, TypeParam[]>();
  for (let i: usize = 0; i < localIndices.length; i++) {
    const l: Ref<Stmt> = stmts[localIndices[i]!]!;
    const lSet = used.get(l.id)!;
    let list: TypeParam[] = [];
    for (let j: usize = 0; j < typeParams.length; j++) {
      if (lSet.has(typeParams[j]!.name)) list.push(cloneTypeParam(typeParams[j]!));
    }
    out.set(l.id, list);
  }
  return out;
}

function what(local: Ref<Stmt>): string {
  return local.kind === "class" ? "class" : "enum";
}

// Type parameters seen inside a declaration that adds its own, an inner one hiding an outer.
function shadowed(ctx: Ref<Context> | undefined, own: Ref<TypeParam[]>): TypeParam[] {
  let out: TypeParam[] = [];
  if (ctx !== undefined) {
    for (let i: usize = 0; i < ctx.typeParams.length; i++) {
      if (!own.some((q) => q.name === ctx.typeParams[i]!.name)) out.push(cloneTypeParam(ctx.typeParams[i]!));
    }
  }
  for (let i: usize = 0; i < own.length; i++) out.push(cloneTypeParam(own[i]!));
  return out;
}

// The variables a statement declares in its block.
function valueNames(s: Ref<Stmt>): string[] {
  if (s.kind === "let") return s.declarations.flatMap((d) => namesIn(d.target));
  if (s.kind === "function") return [s.name];
  return [];
}

function headNamesStmt(s: Ref<Stmt>): string[] {
  if (s.kind === "for" && s.init !== undefined && s.init.kind === "let") return valueNames(s.init);
  if (s.kind === "forOf" && s.left.kind === "let") return valueNames(s.left);
  if (s.kind === "forIn" && s.left.kind === "let") return valueNames(s.left);
  if (s.kind === "try" && s.param !== undefined) return namesIn(s.param);
  return [];
}

// Renames a local declaration in the statements after it, until one declares the name again.
type Rename = { name: string; mangled: string; paramNames: string[]; at: Span; own: usize; values: boolean };

// A nested block that declares the name again isn't its scope there; a type alias or interface
// is hidden only by another type.
function declares(s: Ref<Stmt>, r: Ref<Rename>): boolean {
  if (s.kind === "typeAlias") return s.name === r.name;
  if (s.kind === "interface") return s.name === r.name;
  if (s.kind === "enum") return s.name === r.name;
  if (s.kind === "class" && s.name !== undefined) return s.name === r.name;
  return r.values && valueNames(s).includes(r.name);
}

function makeTypeArgs(r: Ref<Rename>, ids: Mut<Ids>): TypeNode[] {
  let out: TypeNode[] = [];
  for (const name of r.paramNames) out.push({ id: nextId(ids), kind: "ref", name, args: [], start: r.at.start, end: r.at.end });
  return out;
}

// Every use of the name under `node`, as a type or, for a class or enum, a value, made a use of
// the hoisted name, the outer type parameters given first among its type arguments.
/** @throws {CompileError} */
function rename(written: AnyNode, r: Ref<Rename>, rewrites: Mut<Rewrites>, ids: Mut<Ids>): void {
  if (written.of === "stmts") {
    if (written.node.some((s) => {
      const peeked = rewrites.getStmt(s.id);
      return declares(peeked !== undefined ? peeked : s, r);
    })) return;
    for (const s of written.node) rename({ of: "stmt", node: s }, r, rewrites, ids);
    return;
  }
  const { name: from, mangled: to, own } = r;
  if (written.of === "stmt") {
    const peeked = rewrites.getStmt(written.node.id);
    const s: Ref<Stmt> = peeked !== undefined ? peeked : written.node;
    eachChild({ of: "stmt", node: s }, (c) => {
      rename(c, r, rewrites, ids);
    });
    return;
  }
  if (written.of === "typeNode") {
    const peeked = rewrites.getTypeNode(written.node.id);
    const t: Ref<TypeNode> = peeked !== undefined ? peeked : written.node;
    if (t.kind === "ref" && t.name === from) {
      let cloned = cloneTypeNode(t);
      if (cloned.kind === "ref") {
        cloned.name = to;
        cloned.args = [...makeTypeArgs(r, ids), ...cloned.args];
      }
      const next = rewrites.replaceTypeNode(t, cloned);
      eachChild({ of: "typeNode", node: next }, (c) => {
        rename(c, r, rewrites, ids);
      });
      return;
    } else if (t.kind === "ref" && t.name.startsWith(`${from}.`)) {
      let cloned = cloneTypeNode(t);
      if (cloned.kind === "ref") {
        cloned.name = `${to}${t.name.slice(from.length as i64)}`;
      }
      const next = rewrites.replaceTypeNode(t, cloned);
      eachChild({ of: "typeNode", node: next }, (c) => {
        rename(c, r, rewrites, ids);
      });
      return;
    }
    eachChild({ of: "typeNode", node: t }, (c) => {
      rename(c, r, rewrites, ids);
    });
    return;
  }
  if (written.of === "expr") {
    const peeked = rewrites.getExpr(written.node.id);
    const e: Ref<Expr> = peeked !== undefined ? peeked : written.node;
    if (r.values && e.kind === "new" && r.paramNames.length > 0 && e.callee.kind === "ident" && e.callee.name === from) {
      if (e.typeArgs.length === 0 && own > 0) {
        throw new CompileError("E0104", `'${from}' is generic over the function's type parameters as well as its own, so write its type arguments here`, e.start, e.end);
      }
      let cloned = cloneExpr(e);
      if (cloned.kind === "new") {
        cloned.typeArgs = [...makeTypeArgs(r, ids), ...cloned.typeArgs];
      }
      const next = rewrites.replace(e, cloned);
      eachChild({ of: "expr", node: next }, (c) => {
        rename(c, r, rewrites, ids);
      });
      return;
    } else if (r.values && e.kind === "instantiation" && r.paramNames.length > 0 && e.expr.kind === "ident" && e.expr.name === from) {
      if (e.typeArgs.length === 0 && own > 0) {
        throw new CompileError("E0104", `'${from}' is generic over the function's type parameters as well as its own, so write its type arguments here`, e.start, e.end);
      }
      let cloned = cloneExpr(e);
      if (cloned.kind === "instantiation") {
        cloned.typeArgs = [...makeTypeArgs(r, ids), ...cloned.typeArgs];
      }
      const next = rewrites.replace(e, cloned);
      eachChild({ of: "expr", node: next }, (c) => {
        rename(c, r, rewrites, ids);
      });
      return;
    } else if (r.values && e.kind === "ident" && e.name === from) {
      const next = rewrites.replace(e, { id: e.id, kind: "ident", name: to, start: e.start, end: e.end });
      eachChild({ of: "expr", node: next }, (c) => {
        rename(c, r, rewrites, ids);
      });
      return;
    }
    eachChild({ of: "expr", node: e }, (c) => {
      rename(c, r, rewrites, ids);
    });
    return;
  }
  if (written.of === "pattern") {
    const peeked = rewrites.getPattern(written.node.id);
    const p: Ref<Pattern> = peeked !== undefined ? peeked : written.node;
    if (r.values && p.kind === "ident" && p.name === from) {
      const next = rewrites.replacePattern(p, { id: p.id, kind: "ident", name: to, start: p.start, end: p.end });
      eachChild({ of: "pattern", node: next }, (c) => {
        rename(c, r, rewrites, ids);
      });
      return;
    } else if (p.kind === "variant" && p.name.startsWith(`${from}.`)) {
      let cloned = clonePattern(p);
      if (cloned.kind === "variant") {
        cloned.name = `${to}${p.name.slice(from.length as i64)}`;
      }
      const next = rewrites.replacePattern(p, cloned);
      eachChild({ of: "pattern", node: next }, (c) => {
        rename(c, r, rewrites, ids);
      });
      return;
    }
    eachChild({ of: "pattern", node: p }, (c) => {
      rename(c, r, rewrites, ids);
    });
    return;
  }
  eachChild(written, (c) => {
    rename(c, r, rewrites, ids);
  });
}

// Whether a node names a declaration, as a type, a value or an enum member's type.
function mentions(s: Ref<Stmt>, name: string): boolean {
  return someNode({ of: "stmt", node: s }, (item) => {
    if (item.of === "typeNode" && item.node.kind === "ref") return item.node.name === name || item.node.name.startsWith(`${name}.`);
    if (item.of === "expr" && item.node.kind === "ident") return item.node.name === name;
    if (item.of === "pattern" && item.node.kind === "variant") return item.node.name === name || item.node.name.startsWith(`${name}.`);
    return false;
  });
}

// Whether a statement uses a value by name as it runs, not from a function it only defines.
function runsUseNode(node: AnyNode, name: string): boolean {
  if (node.of === "stmts") {
    if (node.node.some((x) => valueNames(x).includes(name))) return false;
    return node.node.some((x) => runsUseNode({ of: "stmt", node: x }, name));
  }
  if (node.of === "stmt") {
    const st: Ref<Stmt> = node.node;
    if (st.kind === "function" || st.kind === "class") return false;
    if (headNamesStmt(st).includes(name)) return false;
    if (st.kind === "try" && st.param !== undefined && namesIn(st.param).includes(name)) {
      if (runsUseNode({ of: "stmts", node: st.block }, name)) return true;
      if (st.finalizer !== undefined && runsUseNode({ of: "stmts", node: st.finalizer }, name)) return true;
      return false;
    }
  } else if (node.of === "expr") {
    const e: Ref<Expr> = node.node;
    if (e.kind === "arrow" || e.kind === "function" || e.kind === "class") return false;
    if (e.kind === "ident" && e.name === name) return true;
  } else if (node.of === "classMember") {
    const m: Ref<ClassMember> = node.node;
    if (m.kind === "method" || m.kind === "constructor" || m.kind === "get" || m.kind === "set") return false;
  } else if (node.of === "objectProp") {
    const p: Ref<ObjectProp> = node.node;
    if (p.kind === "method" || p.kind === "get" || p.kind === "set") return false;
    if (p.kind === "shorthand" && p.name === name) return true;
  }
  let hit = false;
  forEachChild(node, (c) => {
    if (!hit && runsUseNode(c, name)) hit = true;
  });
  return hit;
}

function runsUse(s: Ref<Stmt>, name: string): boolean {
  return runsUseNode({ of: "stmt", node: s }, name);
}

function refersTo(s: Ref<Stmt>, name: string): boolean {
  return someNode({ of: "stmt", node: s }, (item) => item.of === "typeNode" && item.node.kind === "ref" && item.node.name === name);
}

// The value names a declaration reads.
function namesUsed(s: Ref<Stmt>): Set<string> {
  let found = new Set<string>();
  walk({ of: "stmt", node: s }, (item) => {
    if (item.of === "expr" && item.node.kind === "ident") found.add(item.node.name);
    if (item.of === "pattern" && item.node.kind === "ident") found.add(item.node.name);
    if (item.of === "objectProp" && item.node.kind === "shorthand") found.add(item.node.name);
  });
  return found;
}

// The names declared inside a declaration: its methods' parameters and locals.
function declaredWithin(st: Ref<Stmt>): Set<string> {
  let found = new Set<string>();
  walk({ of: "stmt", node: st }, (item) => {
    if (item.of === "param") {
      for (const x of namesIn(item.node.pattern)) found.add(x);
    } else if (item.of === "stmt") {
      const s: Ref<Stmt> = item.node;
      if (s.kind === "let") for (const d of s.declarations) for (const x of namesIn(d.target)) found.add(x);
      if (s.kind === "function") found.add(s.name);
      if (s.kind === "try" && s.param !== undefined) for (const x of namesIn(s.param)) found.add(x);
    }
  });
  return found;
}

export function namesIn(p: Ref<Pattern>): string[] {
  let out: string[] = [];
  collectNamesIn(p, out);
  return out;
}

function collectNamesIn(p: Ref<Pattern>, out: Mut<string[]>): void {
  if (p.kind === "ident") out.push(p.name);
  else if (p.kind === "default") collectNamesIn(p.target, out);
  else if (p.kind === "array") {
    for (const x of p.elements) if (x !== undefined) collectNamesIn(x, out);
    if (p.rest !== undefined) collectNamesIn(p.rest, out);
  } else if (p.kind === "object") {
    for (const x of p.props) collectNamesIn(x.value, out);
    if (p.rest !== undefined) collectNamesIn(p.rest, out);
  }
}

// Methods and accessors in object literals. An object literal holding any is made as an instance
// of a class of its own, so its methods borrow `this` as a class's do: the class has a type
// parameter for each property, which its constructor's arguments infer, and is declared at the
// start of the body the literal is in, where hoisting makes it program-wide like any local class.
// Its members are checked in each instance only, as only an instance knows its fields' types.
export const OBJECT_CLASS = "@object";

// A literal found, the body it is in (none at the top level), and the variables the bodies around
// it declare, which its methods can't use.
type Found = Span & { id: usize; props: ObjectProp[]; owner: usize | undefined; names: Set<string> };

function bodyOwner(node: Ref<AnyNode>): boolean {
  if (node.of === "stmt") return node.node.kind === "function" && node.node.body !== undefined;
  if (node.of === "func") return node.node.body !== undefined;
  if (node.of === "expr") return node.node.kind === "arrow" || node.node.kind === "function";
  if (node.of === "classMember") return ((node.node.kind === "method" || node.node.kind === "constructor" || node.node.kind === "get" || node.node.kind === "set") && node.node.body !== undefined) || node.node.kind === "staticBlock";
  if (node.of === "objectProp") return node.node.kind === "method" || node.node.kind === "get" || node.node.kind === "set";
  return false;
}

// A literal with a method or accessor whose other properties are named values or shorthands.
function lowerable(props: Ref<ObjectProp[]>): boolean {
  if (!props.some((p) => p.kind === "method" || p.kind === "get" || p.kind === "set")) return false;
  return props.every((p) => (p.kind === "shorthand" ? p.default === undefined : p.kind === "spread" ? false : typeof p.key === "string"));
}

// The variables a body declares at any depth, its parameters included; local types aren't
// variables, so a class may use them.
function declaredIn(node: AnyNode): Set<string> {
  let found = new Set<string>();
  walk(node, (n) => {
    if (n.of === "param") {
      for (const x of namesIn(n.node.pattern)) found.add(x);
    } else if (n.of === "stmt") {
      const s: Ref<Stmt> = n.node;
      if (s.kind === "let") for (const d of s.declarations) for (const x of namesIn(d.target)) found.add(x);
      if (s.kind === "function") found.add(s.name);
      if (s.kind === "try" && s.param !== undefined) for (const x of namesIn(s.param)) found.add(x);
    }
  });
  return found;
}

// A property's name; a literal is lowered only when each it holds has one.
function keyName(k: Ref<PropertyName>): string {
  return typeof k === "string" ? k : "";
}

function usedIn(node: AnyNode): Set<string> {
  let found = new Set<string>();
  walk(node, (n) => {
    if (n.of === "expr" && n.node.kind === "ident") found.add(n.node.name);
    if (n.of === "objectProp" && n.node.kind === "shorthand") found.add(n.node.name);
  });
  return found;
}

class ObjectClasses {
  ids: Ids;
  found: Found[] = [];
  rewrites = new Rewrites();

  constructor(lastId: usize) {
    this.ids = { last: lastId };
  }

  visit(this: Mut<this>, node: AnyNode, owner: usize | undefined, names: Ref<Set<string>>): void {
    if (bodyOwner(node)) {
      const id = nodeIdOf(node) as usize;
      const inner = new Set<string>([...names, ...declaredIn(reborrowNode(node))]);
      forEachChild(node, (c) => {
        this.visit(c, id, inner);
      });
      return;
    }
    if (node.of === "expr" && node.node.kind === "object" && lowerable(node.node.props)) this.found.push({ id: node.node.id, props: node.node.props.map((p) => cloneObjectProp(p)), owner, names: new Set<string>([...names]), start: node.node.start, end: node.node.end });
    forEachChild(node, (c) => {
      this.visit(c, owner, names);
    });
  }

  private typeRef(this: Mut<this>, name: string, at: Ref<Span>): TypeNode {
    return { id: nextId(this.ids), kind: "ref", name, args: [], start: at.start, end: at.end };
  }

  private ident(this: Mut<this>, name: string, at: Ref<Span>): Expr {
    return { id: nextId(this.ids), kind: "ident", name, start: at.start, end: at.end };
  }

  // The class a literal is an instance of, with the `new` that makes it put in the literal's
  // place; `inside` holds the classes made for the literals in each method's body, to start it.
  /** @throws {CompileError} */
  made(this: Mut<this>, f: Ref<Found>, inside: Mut<Map<usize, Stmt[]>>): Stmt {
    const name = `${OBJECT_CLASS}${f.id}`;
    let typeParams: TypeParam[] = [];
    let params: Param[] = [];
    let assigns: Stmt[] = [];
    let members: ClassMember[] = [];
    let args: Expr[] = [];
    for (const p of f.props) {
      const at = { start: p.start, end: p.end };
      if (p.kind === "property" || p.kind === "shorthand") {
        const key = p.kind === "property" ? keyName(p.key) : p.name;
        const t = `@T${typeParams.length}`;
        const v = `@v${typeParams.length}`;
        typeParams.push({ id: nextId(this.ids), name: t, constraint: undefined, default: undefined, modifiers: [], start: at.start, end: at.end });
        members.push({ id: nextId(this.ids), kind: "field", name: key, optional: false, definite: false, type: this.typeRef(t, at), init: undefined, modifiers: [], decorators: [], start: at.start, end: at.end });
        params.push({ id: nextId(this.ids), pattern: { id: nextId(this.ids), kind: "ident", name: v, start: at.start, end: at.end }, type: this.typeRef(t, at), optional: false, rest: false, default: undefined, modifiers: [], decorators: [], comptime: false, start: at.start, end: at.end });
        const target: Expr = { id: nextId(this.ids), kind: "member", object: { id: nextId(this.ids), kind: "this", start: at.start, end: at.end }, name: key, optional: false, start: at.start, end: at.end };
        const value = this.ident(v, at);
        assigns.push({ id: nextId(this.ids), kind: "expr", expr: { id: nextId(this.ids), kind: "assign", op: "=", target, value, start: at.start, end: at.end }, start: at.start, end: at.end });
        args.push(p.kind === "property" ? cloneExpr(p.value) : this.ident(p.name, at));
        continue;
      }
      if (p.kind !== "method" && p.kind !== "get" && p.kind !== "set") continue;
      const own = declaredIn({ of: "objectProp", node: p });
      for (const u of usedIn({ of: "objectProp", node: p })) {
        if (f.names.has(u) && !own.has(u)) throw new CompileError("E0409", `a method in an object literal can't use '${u}' from the function around it yet; give the object a property holding it, and read it as 'this.${u}'`, p.start, p.end);
      }
      const key = keyName(p.key);
      let body: Stmt[] = [];
      const before = inside.get(p.id);
      if (before !== undefined) for (const s of before) body.push(cloneStmt(s));
      inside.delete(p.id);
      for (const s of p.body) body.push(cloneStmt(s));
      const taken = p.params.map((q) => cloneParam(q));
      const returnType = p.returnType !== undefined ? cloneTypeNode(p.returnType!) : undefined;
      if (p.kind === "method") {
        const modifiers: Modifier[] = p.async ? ["async"] : [];
        members.push({ id: nextId(this.ids), kind: "method", name: key, optional: false, generator: p.generator, typeParams: p.typeParams.map((q) => cloneTypeParam(q)), params: taken, returnType, body, modifiers, decorators: [], start: at.start, end: at.end });
      } else {
        members.push({ id: nextId(this.ids), kind: p.kind, name: key, params: taken, returnType, body, modifiers: [], decorators: [], start: at.start, end: at.end });
      }
    }
    const span = { start: f.start, end: f.end };
    members.unshift({ id: nextId(this.ids), kind: "constructor", params, body: assigns, modifiers: [], decorators: [], start: span.start, end: span.end });
    const callee = this.ident(name, span);
    this.rewrites.replaceAt(f.id, { id: f.id, kind: "new", callee, typeArgs: [], args, start: span.start, end: span.end });
    return { id: nextId(this.ids), kind: "class", name, abstract: false, decorators: [], typeParams, extends: undefined, implements: [], members, start: span.start, end: span.end };
  }

  // A body found again with the classes made for its literals put at its start; an arrow with an
  // expression body returns it.
  startWith(this: Mut<this>, node: Ref<AnyNode>, classes: Ref<Stmt[]>): void {
    let body = cloneStmts(classes);
    if (node.of === "stmt" && node.node.kind === "function" && node.node.body !== undefined) {
      for (const s of node.node.body!) body.push(cloneStmt(s));
      this.rewrites.replaceStmt(node.node, { ...node.node, body });
    } else if (node.of === "func" && node.node.body !== undefined) {
      for (const s of node.node.body!) body.push(cloneStmt(s));
      this.rewrites.replaceFunc(node.node, { ...node.node, body });
    } else if (node.of === "expr") {
      const e: Ref<Expr> = node.node;
      if (e.kind === "arrow") {
        if (Array.isArray(e.body)) for (const s of e.body) body.push(cloneStmt(s));
        else body.push({ id: nextId(this.ids), kind: "return", value: cloneExpr(e.body), start: e.body.start, end: e.body.end });
        this.rewrites.replace(e, { ...e, body });
      } else if (e.kind === "function") {
        for (const s of e.body) body.push(cloneStmt(s));
        this.rewrites.replace(e, { ...e, body });
      }
    } else if (node.of === "classMember") {
      const m: Ref<ClassMember> = node.node;
      if (m.kind === "method" && m.body !== undefined) {
        for (const s of m.body!) body.push(cloneStmt(s));
        this.rewrites.replaceClassMember(m, { ...m, body });
      } else if (m.kind === "constructor" && m.body !== undefined) {
        for (const s of m.body!) body.push(cloneStmt(s));
        this.rewrites.replaceClassMember(m, { ...m, body });
      } else if ((m.kind === "get" || m.kind === "set") && m.body !== undefined) {
        for (const s of m.body!) body.push(cloneStmt(s));
        this.rewrites.replaceClassMember(m, { ...m, body });
      } else if (m.kind === "staticBlock") {
        for (const s of m.body) body.push(cloneStmt(s));
        this.rewrites.replaceClassMember(m, { ...m, body });
      }
    } else if (node.of === "objectProp") {
      const p: Ref<ObjectProp> = node.node;
      if (p.kind === "method") {
        for (const s of p.body) body.push(cloneStmt(s));
        this.rewrites.replaceObjectProp(p, { ...p, body });
      } else if (p.kind === "get" || p.kind === "set") {
        for (const s of p.body) body.push(cloneStmt(s));
        this.rewrites.replaceObjectProp(p, { ...p, body });
      }
    }
  }
}

// Each object literal with methods or accessors made an instance of its own class, declared
// where hoisting finds it; the classes for literals at the top level start the program.
/** @throws {CompileError} */
export function lowerObjectMethods(ids: Mut<Ids>, program: Stmt[]): Stmt[] {
  const any = someNode({ of: "stmts", node: program }, (n) => n.of === "objectProp" && (n.node.kind === "method" || n.node.kind === "get" || n.node.kind === "set"));
  if (!any) return program;
  let c = new ObjectClasses(ids.last);
  const none = new Set<string>();
  for (const s of program) c.visit({ of: "stmt", node: s }, undefined, none);
  let found = c.found.splice(0);
  let inside = new Map<usize, Stmt[]>();
  let top: Stmt[] = [];
  // Inner literals first, so the classes for a method's own literals start its body in the class
  // made for the literal around it.
  while (found.length > 0) {
    const f = found.pop()!;
    const declared = c.made(f, inside);
    if (f.owner === undefined) {
      top.push(declared);
      continue;
    }
    let list: Stmt[] = [];
    const had = inside.get(f.owner!);
    if (had !== undefined) for (const s of had) list.push(cloneStmt(s));
    list.push(declared);
    inside.set(f.owner!, list);
  }
  if (inside.size > 0) {
    walk({ of: "stmts", node: program }, (n) => {
      if (!bodyOwner(n)) return;
      const classes = inside.get(nodeIdOf(n) as usize);
      if (classes !== undefined) c.startWith(n, classes);
    });
  }
  ids.last = c.ids.last;
  // The top level's classes are rebuilt too: their methods may hold literals made into classes.
  let out = [...top, ...program];
  rebuiltStmts(out, c.rewrites);
  return out;
}
