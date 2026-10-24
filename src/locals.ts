import { CompileError } from "./diag.ts";
import type { Expr, Param, Pattern, Stmt, TypeNode, TypeParam } from "./parser.ts";

// Local declarations: a `type`, `interface`, `enum` or `class` written in a body is a
// declaration of the program's own, under a name only its scope can write. The uses in its scope
// are renamed to it, and the enclosing body's type parameters it names become type parameters
// of its own, given as type arguments wherever it is used, so it has an instance per instance of
// the body. A local class or enum can't use the body's variables, which it would outlive.

type Local = Extract<Stmt, { kind: "typeAlias" | "interface" | "class" | "enum" }>;
type Context = { owner: string; typeParams: TypeParam[]; declared: Set<string> };

const LOCAL_KINDS = new Set(["typeAlias", "interface", "class", "enum"]);
// The fields of a statement that hold statement lists, each a scope of its own.
const LISTS = ["body", "then", "else", "block", "handler", "finalizer"];

export function hoistLocals(program: Stmt[]): Stmt[] {
  const hoisted: Stmt[] = [];
  let count = 0;

  const visit = (node: unknown, ctx: Context | undefined, seen = new Set<unknown>()) => {
    if (!node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) return node.forEach((x) => visit(x, ctx, seen));
    const n = node as { kind?: string; name?: unknown; key?: unknown; typeParams?: TypeParam[]; params?: Param[]; body?: unknown };
    // A function, an arrow or a member with a body starts a context of its own.
    const bodied = (n.kind === "function" || n.kind === "arrow" || n.kind === "method" || n.kind === "constructor" || n.kind === "get" || n.kind === "set") && Array.isArray(n.body);
    if (bodied) {
      const name = typeof n.name === "string" ? n.name : typeof n.key === "string" ? n.key : n.kind!;
      const inner: Context = {
        owner: ctx ? `${ctx.owner}.${name}` : name,
        typeParams: [...(ctx?.typeParams ?? []), ...(n.typeParams ?? [])],
        declared: new Set([...(ctx?.declared ?? []), ...declaredIn(n.params ?? [], n.body as Stmt[])]),
      };
      list(n.body as Stmt[], inner);
      for (const p of n.params ?? []) visit(p, inner, seen);
      return;
    }
    // A class's members see its type parameters.
    if (n.kind === "class" && Array.isArray(n.typeParams)) {
      const inner: Context = { owner: ctx?.owner ?? (typeof n.name === "string" ? n.name : "class"), typeParams: [...(ctx?.typeParams ?? []), ...n.typeParams], declared: ctx?.declared ?? new Set() };
      for (const [k, v] of Object.entries(n)) if (k !== "typeParams") visit(v, inner, seen);
      return;
    }
    for (const [k, v] of Object.entries(n)) {
      if (ctx && LISTS.includes(k) && Array.isArray(v) && v.every(isStmt)) list(v as Stmt[], ctx);
      else if (ctx && k === "cases" && Array.isArray(v)) for (const c of v as { body: Stmt[] }[]) list(c.body, ctx);
      else visit(v, ctx, seen);
    }
  };

  // A body's statements in order, each local declaration hoisted and the rest of the list
  // renamed to it.
  const list = (stmts: Stmt[], ctx: Context) => {
    for (let i = 0; i < stmts.length; i++) {
      const s = stmts[i]!;
      if (!LOCAL_KINDS.has(s.kind)) {
        visit(s, ctx);
        continue;
      }
      const local = s as Local;
      if (local.name === undefined) continue;
      const name = local.name;
      // Its name holds no '.', which would read as an enum's member.
      const mangled = `${name}@${count++}`;
      const outer = ctx.typeParams.filter((p) => refersTo(local, p.name) && !(local.typeParams ?? []).some((q) => q.name === p.name));
      if (local.kind === "class" || local.kind === "enum") {
        const own = declaredWithin(local);
        const used = [...namesUsed(local)].find((u) => ctx.declared.has(u) && !own.has(u));
        if (used) {
          const what = local.kind === "class" ? `class '${name}'` : `enum '${name}'`;
          throw new CompileError(`the local ${what} can't use '${used}' from the function around it, which it may outlive; ${local.kind === "class" ? "pass it to its constructor" : "use a constant from the top level"}`, local.start, local.end);
        }
      }
      if (outer.length > 0 && local.kind === "enum" && !Array.isArray((local as { typeParams?: unknown }).typeParams)) {
        throw new CompileError(`the local enum '${name}' can't use the type parameters of the function around it`, local.start, local.end);
      }
      const args: TypeNode[] = outer.map((p) => ({ kind: "ref", name: p.name, args: [], start: local.start, end: local.start }));
      const own = local.typeParams?.length ?? 0;
      // Its own body sees the outer parameters as its own.
      visit(local, { ...ctx, typeParams: ctx.typeParams.filter((p) => !outer.includes(p)) });
      rename(local, name, mangled, args, own);
      Object.assign(local, { name: mangled, typeParams: [...outer.map((p) => ({ ...p })), ...(local.typeParams ?? [])], shown: name });
      hoisted.push(local);
      stmts[i] = { kind: "empty", start: s.start, end: s.end };
      // The rest of its scope sees it under its new name.
      renameList(stmts.slice(i + 1), name, mangled, args, own);
    }
  };

  visit(program, undefined);
  return hoisted;
}

function isStmt(x: unknown): boolean {
  return !!x && typeof x === "object" && typeof (x as { kind?: unknown }).kind === "string";
}

// Renames a local declaration in the statements after it, until one declares the name again.
function renameList(stmts: Stmt[], from: string, to: string, args: TypeNode[], own: number) {
  for (const s of stmts) {
    if (declares(s, from)) return;
    rename(s, from, to, args, own);
  }
}

function declares(s: Stmt, name: string): boolean {
  if (LOCAL_KINDS.has(s.kind) || s.kind === "function") return (s as { name?: string }).name === name;
  return s.kind === "let" && s.declarations.some((d) => namesIn(d.target).includes(name));
}

// Every use of `from` under `node`, as a type or a value, made a use of `to`, the outer type
// parameters given first among its type arguments.
function rename(node: unknown, from: string, to: string, args: TypeNode[], own: number, seen = new Set<unknown>()) {
  if (!node || typeof node !== "object" || seen.has(node)) return;
  seen.add(node);
  if (Array.isArray(node)) {
    // A nested list that declares the name again stops being its scope there.
    if (node.every(isStmt) && node.some((s) => declares(s as Stmt, from))) {
      renameList(node as Stmt[], from, to, args, own);
      return;
    }
    for (const x of node) rename(x, from, to, args, own, seen);
    return;
  }
  const n = node as { kind?: string; name?: unknown; args?: TypeNode[]; typeArgs?: TypeNode[]; callee?: Expr; expr?: Expr };
  if (n.kind === "ref" && n.name === from) {
    n.name = to;
    n.args = [...args, ...(n.args ?? [])];
  } else if ((n.kind === "new" || n.kind === "instantiation") && args.length > 0) {
    const target = n.kind === "new" ? n.callee : n.expr;
    if (target?.kind === "ident" && target.name === from) {
      if ((n.typeArgs ?? []).length === 0 && own > 0) {
        throw new CompileError(`'${from}' is generic over the function's type parameters as well as its own, so write its type arguments here`, (n as unknown as Expr).start, (n as unknown as Expr).end);
      }
      n.typeArgs = [...args, ...(n.typeArgs ?? [])];
    }
  }
  if (n.kind === "ident" && n.name === from) n.name = to;
  // A dotted name, as an enum member's type or a match pattern's variant, names it first.
  if ((n.kind === "ref" || n.kind === "variant") && typeof n.name === "string" && n.name.startsWith(`${from}.`)) n.name = `${to}${n.name.slice(from.length)}`;
  for (const v of Object.values(n)) rename(v, from, to, args, own, seen);
}

function refersTo(node: unknown, name: string, seen = new Set<unknown>()): boolean {
  if (!node || typeof node !== "object" || seen.has(node)) return false;
  seen.add(node);
  if (Array.isArray(node)) return node.some((x) => refersTo(x, name, seen));
  const n = node as { kind?: string; name?: unknown };
  if (n.kind === "ref" && n.name === name) return true;
  return Object.values(n).some((v) => refersTo(v, name, seen));
}

// The value names a declaration reads.
function namesUsed(node: unknown, found = new Set<string>(), seen = new Set<unknown>()): Set<string> {
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
function declaredWithin(node: unknown, found = new Set<string>(), seen = new Set<unknown>()): Set<string> {
  if (!node || typeof node !== "object" || seen.has(node)) return found;
  seen.add(node);
  if (Array.isArray(node)) {
    for (const x of node) declaredWithin(x, found, seen);
    return found;
  }
  const n = node as { kind?: string; params?: Param[]; body?: unknown; declarations?: { target: Pattern }[]; name?: unknown; param?: Pattern };
  for (const p of n.params ?? []) for (const x of namesIn(p.pattern)) found.add(x);
  if (n.kind === "let") for (const d of n.declarations ?? []) for (const x of namesIn(d.target)) found.add(x);
  if ((n.kind === "function" || n.kind === "class") && typeof n.name === "string") found.add(n.name);
  if (n.kind === "try" && n.param) for (const x of namesIn(n.param)) found.add(x);
  for (const v of Object.values(n)) declaredWithin(v, found, seen);
  return found;
}

function declaredIn(params: Param[], body: Stmt[]): Set<string> {
  return declaredWithin([params.map((p) => ({ kind: "let", declarations: [{ target: p.pattern }] })), body]);
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
