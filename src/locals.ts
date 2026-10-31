import { CompileError, type Names } from "./diag.ts";
import type { Expr, Param, Pattern, Stmt, TypeNode, TypeParam } from "./parser.ts";
import { nextId, NodeMap, NodeSet, type Ids } from "./nodes.ts";

// Local declarations: a `type`, `interface`, `enum` or `class` written in a body is a
// declaration of the program's own, under a name only its scope can write. The uses in its scope
// are renamed to it, and the enclosing body's type parameters it names become type parameters
// of its own, given as type arguments wherever it is used, so it has an instance per instance of
// the body. A local class or enum can't use the body's variables, which it would outlive.

export type Local = Extract<Stmt, { kind: "typeAlias" | "interface" | "class" | "enum" }> & { name: string };
// The type parameters a body sees, and the variables in scope there that a local class or enum
// would outlive.
type Context = { typeParams: TypeParam[]; declared: Set<string> };

const LOCAL_KINDS = new Set(["typeAlias", "interface", "class", "enum"]);
const BODIED = new Set(["function", "arrow", "method", "constructor", "get", "set"]);
// The fields of a statement that hold statement lists, each a scope of its own.
const LISTS = ["body", "then", "else", "block", "handler", "finalizer"];

// Each name made is noted in `names`, and each node made numbered from `ids`. `captured`, when
// given, is told of each local class or enum using a variable around it, which is otherwise an
// error.
export function hoistLocals({ names, ids }: { names: Names; ids: Ids }, program: Stmt[], captured?: (local: Local, name: string) => void): Stmt[] {
  const hoisted: Stmt[] = [];
  let count = 0;

  const visit = (node: unknown, ctx: Context | undefined, seen: Set<unknown> = new Set<unknown>()) => {
    if (!node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) return node.forEach((x) => visit(x, ctx, seen));
    const n = node as { kind?: string; typeParams?: TypeParam[]; params?: Param[]; body?: unknown };
    // A function, an arrow or a member with a body starts a context of its own.
    if (BODIED.has(n.kind!) && n.body) {
      const inner: Context = {
        typeParams: shadowed(ctx?.typeParams ?? [], n.typeParams ?? []),
        declared: new Set([...(ctx?.declared ?? []), ...(n.params ?? []).flatMap((p) => namesIn(p.pattern))]),
      };
      if (Array.isArray(n.body)) list(n.body as Stmt[], inner);
      else visit(n.body, inner, seen);
      for (const p of n.params ?? []) visit(p, inner, seen);
      return;
    }
    // A class's members see its type parameters.
    if (n.kind === "class" && Array.isArray(n.typeParams)) {
      const inner: Context = { typeParams: shadowed(ctx?.typeParams ?? [], n.typeParams), declared: ctx?.declared ?? new Set() };
      for (const [k, v] of Object.entries(n)) if (k !== "typeParams") visit(v, inner, seen);
      return;
    }
    // A loop's head and a catch clause bind names for what follows them.
    const head = ctx && headNames(n);
    const here = head && head.length > 0 ? { ...ctx, declared: new Set([...ctx.declared, ...head]) } : ctx;
    for (const [k, v] of Object.entries(n)) {
      if (here && LISTS.includes(k) && Array.isArray(v) && v.every(isStmt)) list(v as Stmt[], here);
      else if (here && k === "cases" && Array.isArray(v)) for (const c of v as { body: Stmt[] }[]) list(c.body, here);
      else visit(v, here, seen);
    }
  };

  // A block's statements. Each local declaration in it is renamed throughout the block, as
  // TypeScript scopes it to the whole block, and hoisted.
  const list = (stmts: Stmt[], outer: Context) => {
    const ctx: Context = { ...outer, declared: new Set([...outer.declared, ...stmts.flatMap(valueNames)]) };
    const locals = stmts.filter((s): s is Local => LOCAL_KINDS.has(s.kind) && (s as Local).name !== undefined);
    const uses = generics(locals, ctx.typeParams);
    const renames = locals.map((local) => {
      const name = local.name;
      // Its name holds no '.', which would read as an enum's member.
      const mangled = `${name}@${count++}`;
      names.local.add(mangled);
      const params = uses.get(local)!;
      if (local.kind === "class" || local.kind === "enum") {
        const own = declaredWithin(local);
        const used = [...namesUsed(local)].find((u) => ctx.declared.has(u) && !own.has(u));
        if (used) {
          const what = local.kind === "class" ? `class '${name}'` : `enum '${name}'`;
          if (captured) captured(local, used);
          else throw new CompileError(`the local ${what} can't use '${used}' from the function around it, which it may outlive; ${local.kind === "class" ? "pass it to its constructor" : "use a constant from the top level"}`, local.start, local.end);
        }
        const early = stmts.slice(0, stmts.indexOf(local)).find((s) => runsUse(s, name));
        if (early && !captured) throw new CompileError(`${what(local)} '${name}' is used before its declaration`, early.start, early.end);
      }
      if (params.length > 0 && local.kind === "enum" && !Array.isArray((local as { typeParams?: unknown }).typeParams)) {
        throw new CompileError(`the local enum '${name}' can't use the type parameters of the function around it`, local.start, local.end);
      }
      const args: TypeNode[] = params.map((p): TypeNode => ({ id: nextId(ids), kind: "ref", name: p.name, args: [], start: local.start, end: local.start }));
      const own = local.typeParams?.length ?? 0;
      Object.assign(local, { name: mangled, typeParams: [...params.map((p) => ({ ...p, id: nextId(ids) })), ...(local.typeParams ?? [])] });
      return { name, mangled, args, own, values: local.kind === "class" || local.kind === "enum" };
    });
    for (const r of renames) for (const s of stmts) rename(s, r);
    for (const s of stmts) visit(s, ctx);
    for (const local of locals) {
      hoisted.push(local);
      stmts[stmts.indexOf(local)] = { id: nextId(ids), kind: "empty", start: local.start, end: local.end };
    }
  };

  visit(program, undefined);
  return hoisted;
}

// The outer type parameters each local uses, itself or through a local it names, in the order
// the body declares them.
function generics(locals: Local[], typeParams: TypeParam[]): NodeMap<Local, TypeParam[]> {
  const used = new NodeMap(locals.map((l) => [l, new NodeSet(typeParams.filter((p) => refersTo(l, p.name) && !(l.typeParams ?? []).some((q) => q.name === p.name)))]));
  for (let grew = true; grew; ) {
    grew = false;
    for (const l of locals) {
      for (const m of locals) {
        if (m === l || !mentions(l, m.name)) continue;
        for (const p of used.get(m)!) {
          if (used.get(l)!.has(p) || (l.typeParams ?? []).some((q) => q.name === p.name)) continue;
          used.get(l)!.add(p);
          grew = true;
        }
      }
    }
  }
  return new NodeMap(locals.map((l) => [l, typeParams.filter((p) => used.get(l)!.has(p))]));
}

function what(local: Local): string {
  return local.kind === "class" ? "class" : "enum";
}

// Type parameters seen inside a declaration that adds its own, an inner one hiding an outer.
function shadowed(outer: TypeParam[], own: TypeParam[]): TypeParam[] {
  return [...outer.filter((p) => !own.some((q) => q.name === p.name)), ...own];
}

// The variables a statement declares in its block.
function valueNames(s: Stmt): string[] {
  if (s.kind === "let") return s.declarations.flatMap((d) => namesIn(d.target));
  return s.kind === "function" && s.name ? [s.name] : [];
}

function headNames(n: { kind?: string }): string[] {
  const stmt = n as { kind?: string; init?: Stmt; left?: Stmt | Pattern; param?: Pattern };
  const declared = stmt.kind === "for" ? stmt.init : stmt.kind === "forOf" || stmt.kind === "forIn" ? stmt.left : undefined;
  if (declared && declared.kind === "let") return valueNames(declared as Stmt);
  return stmt.kind === "try" ? namesIn(stmt.param) : [];
}

function isStmt(x: unknown): boolean {
  return !!x && typeof x === "object" && typeof (x as { kind?: unknown }).kind === "string";
}

// Renames a local declaration in the statements after it, until one declares the name again.
type Rename = { name: string; mangled: string; args: TypeNode[]; own: number; values: boolean };

// A nested block that declares the name again isn't its scope there; a type alias or interface
// is hidden only by another type.
function declares(s: Stmt, r: Rename): boolean {
  if (LOCAL_KINDS.has(s.kind)) return (s as { name?: string }).name === r.name;
  return r.values && valueNames(s).includes(r.name);
}

// Every use of the name under `node`, as a type or, for a class or enum, a value, made a use of
// the hoisted name, the outer type parameters given first among its type arguments.
function rename(node: unknown, r: Rename, seen: Set<unknown> = new Set<unknown>()) {
  if (!node || typeof node !== "object" || seen.has(node)) return;
  seen.add(node);
  if (Array.isArray(node)) {
    if (node.every(isStmt) && node.some((s) => declares(s as Stmt, r))) return;
    for (const x of node) rename(x, r, seen);
    return;
  }
  const { name: from, mangled: to, args, own } = r;
  const n = node as { kind?: string; name?: unknown; args?: TypeNode[]; typeArgs?: TypeNode[]; callee?: Expr; expr?: Expr };
  if (n.kind === "ref" && n.name === from) {
    n.name = to;
    n.args = [...args, ...(n.args ?? [])];
  } else if (r.values && (n.kind === "new" || n.kind === "instantiation") && args.length > 0) {
    const target = n.kind === "new" ? n.callee : n.expr;
    if (target?.kind === "ident" && target.name === from) {
      if ((n.typeArgs ?? []).length === 0 && own > 0) {
        throw new CompileError(`'${from}' is generic over the function's type parameters as well as its own, so write its type arguments here`, (n as unknown as Expr).start, (n as unknown as Expr).end);
      }
      n.typeArgs = [...args, ...(n.typeArgs ?? [])];
    }
  }
  if (r.values && n.kind === "ident" && n.name === from) n.name = to;
  // A dotted name, as an enum member's type or a match pattern's variant, names it first.
  if ((n.kind === "ref" || n.kind === "variant") && typeof n.name === "string" && n.name.startsWith(`${from}.`)) n.name = `${to}${n.name.slice(from.length)}`;
  for (const v of Object.values(n)) rename(v, r, seen);
}

// Whether a node names a declaration, as a type, a value or an enum member's type.
function mentions(node: unknown, name: string, seen: Set<unknown> = new Set<unknown>()): boolean {
  if (!node || typeof node !== "object" || seen.has(node)) return false;
  seen.add(node);
  if (Array.isArray(node)) return node.some((x) => mentions(x, name, seen));
  const n = node as { kind?: string; name?: unknown };
  if ((n.kind === "ref" || n.kind === "ident" || n.kind === "variant") && typeof n.name === "string" && (n.name === name || n.name.startsWith(`${name}.`))) return true;
  return Object.values(n).some((v) => mentions(v, name, seen));
}

// Whether a statement uses a value by name as it runs, not from a function it only defines.
function runsUse(node: unknown, name: string): boolean {
  if (!node || typeof node !== "object") return false;
  if (Array.isArray(node)) return node.some((x) => runsUse(x, name));
  const n = node as { kind?: string; name?: unknown };
  if (BODIED.has(n.kind!) || n.kind === "class") return false;
  // An inner block, loop or catch clause binding the name hides it.
  if (headNames(n).includes(name) || Object.values(n).some((v) => Array.isArray(v) && v.every(isStmt) && v.some((s) => valueNames(s as Stmt).includes(name)))) return false;
  if (n.kind === "ident" && n.name === name) return true;
  return Object.values(n).some((v) => runsUse(v, name));
}

function refersTo(node: unknown, name: string, seen: Set<unknown> = new Set<unknown>()): boolean {
  if (!node || typeof node !== "object" || seen.has(node)) return false;
  seen.add(node);
  if (Array.isArray(node)) return node.some((x) => refersTo(x, name, seen));
  const n = node as { kind?: string; name?: unknown };
  if (n.kind === "ref" && n.name === name) return true;
  return Object.values(n).some((v) => refersTo(v, name, seen));
}

// The value names a declaration reads.
function namesUsed(node: unknown, found: Set<string> = new Set<string>(), seen: Set<unknown> = new Set<unknown>()): Set<string> {
  if (!node || typeof node !== "object" || seen.has(node)) return found;
  seen.add(node);
  if (Array.isArray(node)) {
    for (const x of node) namesUsed(x, found, seen);
    return found;
  }
  const n = node as { kind?: string; name?: unknown };
  if ((n.kind === "ident" || n.kind === "shorthand") && typeof n.name === "string") found.add(n.name);
  for (const v of Object.values(n)) namesUsed(v, found, seen);
  return found;
}

// The names declared inside a declaration: its methods' parameters and locals.
function declaredWithin(node: unknown, found: Set<string> = new Set<string>(), seen: Set<unknown> = new Set<unknown>()): Set<string> {
  if (!node || typeof node !== "object" || seen.has(node)) return found;
  seen.add(node);
  if (Array.isArray(node)) {
    for (const x of node) declaredWithin(x, found, seen);
    return found;
  }
  const n = node as { kind?: string; params?: Param[]; body?: unknown; declarations?: { target: Pattern }[]; name?: unknown; param?: Pattern };
  for (const p of n.params ?? []) for (const x of namesIn(p.pattern)) found.add(x);
  if (n.kind === "let") for (const d of n.declarations ?? []) for (const x of namesIn(d.target)) found.add(x);
  if (n.kind === "function" && typeof n.name === "string") found.add(n.name);
  if (n.kind === "try" && n.param) for (const x of namesIn(n.param)) found.add(x);
  for (const v of Object.values(n)) declaredWithin(v, found, seen);
  return found;
}

function namesIn(p: Pattern | undefined): string[] {
  if (!p) return [];
  switch (p.kind) {
    case "ident":
      return [p.name];
    case "default":
      return namesIn(p.target);
    case "array":
      return [...p.elements.flatMap((x) => namesIn(x)), ...namesIn(p.rest)];
    case "object":
      return [...p.props.flatMap((x) => namesIn(x.value)), ...namesIn(p.rest)];
    default:
      return [];
  }
}
