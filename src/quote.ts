import type { Tables } from "./compilation.ts";
import { CompileError } from "./diag.ts";
import { lexer } from "./lexer.ts";
import { FILE_SPAN } from "./modules.ts";
import { parse, parseExpression, parseType, type Expr, type Span, type Stmt, type TypeNode } from "./parser.ts";
import { nextId, renumber, Rewrites, walk as walkTree, type Ids } from "./nodes.ts";
import { rebuiltExpr, rebuiltStmt, rebuiltTypeNode } from "./rebuild.ts";
import type { ObjectType, Type, UnionType, Typing } from "./typing.ts";

// `quote` and `quoteType`: Fish source written in a template, parsed while checking into the
// `Ast` value it stands for, with each `${x}` a splice of another node.

// What stands for the n-th splice while the text is parsed: a name no program writes.
const SPLICE = "__fishSplice";

export type Category = "AstExpr" | "AstStmt" | "AstType";
const OF = { AstExpr: "expr", AstStmt: "stmt", AstType: "typeNode" } as const;
// `asExpressions` are the splices written as statements that are expressions, each the
// expression of its statement, as `e;` is; `names` are those where a name goes, each taking an
// identifier's name.
export type Quote = { tree: Expr | Stmt | TypeNode; category: Category; holes: Expr[]; asExpressions: Set<usize>; names: Set<usize> };

// The tree a quote's text parses to: a type for `quoteType`, else an expression when the whole
// text is one and doesn't start as JavaScript's statements do, else one statement or
// declaration. `parsedQuotes` holds each quote parsed so far.
export function quoted({ parsedQuotes: parsed, ids }: Tables, e: Extract<Expr, { kind: "tagged" }>, asType: boolean): Quote {
  const made = parsed.get(e);
  if (made) return made;
  const template = e.template;
  if (template.kind !== "template") throw new CompileError("a quote is followed by a template literal", template.start, template.end);
  // The text as written, so a string's or a regex's escapes reach the parser as they would.
  const written = template.raw.map((q) => q.replace(/\\(`|\$\{)/g, "$1"));
  const text = written.map((q, i) => (i === 0 ? q : ` ${SPLICE}${i - 1} ${q}`)).join("");
  const fail = (error: unknown): never => {
    if (!(error instanceof CompileError)) throw error;
    throw new CompileError(`this quote's text doesn't parse: ${error.message}`, e.start, e.end);
  };
  let quote: Quote;
  if (asType) {
    let tree: TypeNode;
    try {
      tree = parseType(text, ids);
    } catch (error) {
      tree = fail(error);
    }
    quote = { tree, category: "AstType", holes: template.exprs, asExpressions: new Set(), names: new Set() };
  } else {
    // As JavaScript reads a statement, one starting with `function`, `class` or `{` is no
    // expression.
    const statement = startsStatement(text);
    let tree: Expr | Stmt | undefined;
    try {
      tree = statement ? undefined : parseExpression(text, ids);
    } catch {
      tree = undefined;
    }
    if (tree) quote = { tree, category: "AstExpr", holes: template.exprs, asExpressions: new Set(), names: new Set() };
    else {
      let stmts: Stmt[] = [];
      try {
        stmts = parse(text, ids);
      } catch (error) {
        fail(error);
      }
      if (stmts.length !== 1) throw new CompileError(`a quote holds one expression, statement or declaration, not ${stmts.length}`, e.start, e.end);
      quote = { tree: stmts[0]!, category: "AstStmt", holes: template.exprs, asExpressions: new Set(), names: new Set() };
    }
  }
  parsed.set(e, quote);
  return quote;
}

// Whether a text starts as only a statement can, past any comments.
function startsStatement(text: string): boolean {
  try {
    const tokens = lexer(text);
    const first = tokens.next();
    // A decorated class is a declaration there too.
    if (first.kind === "punct" && (first.text === "{" || first.text === "@")) return true;
    if (first.kind !== "ident") return false;
    if (first.text === "function" || first.text === "class") return true;
    const second = tokens.next();
    return first.text === "async" && second.kind === "ident" && second.text === "function" && !second.newlineBefore;
  } catch {
    return false;
  }
}

// Which splice a name stands for, if it is one.
function nameSplice(text: unknown): usize | undefined {
  if (typeof text !== "string" || !text.startsWith(SPLICE)) return undefined;
  const i = text.slice(SPLICE.length);
  return /^\d+$/.test(i) ? Number(i) : undefined;
}

// Which splice a node stands for, if it is one.
function spliceOf(node: unknown): usize | undefined {
  if (!node || typeof node !== "object") return undefined;
  const n = node as { kind?: string; name?: unknown; args?: unknown[]; expr?: unknown };
  if ((n.kind !== "ident" && !(n.kind === "ref" && n.args?.length === 0)) || typeof n.name !== "string" || !n.name.startsWith(SPLICE)) return undefined;
  const i = n.name.slice(SPLICE.length);
  return /^\d+$/.test(i) ? Number(i) : undefined;
}

// The category each splice of a quote stands in, found by walking its tree beside the Ast type
// it makes; a splice anywhere else, as a name, is an error.
export function holesOf(typing: Typing, q: Quote, types: Record<Category, Type>, at: Span): Category[] {
  const found: (Category | undefined)[] = q.holes.map(() => undefined);
  walk(typing, q.tree, types[q.category], types, q, (i, category) => {
    if (i >= q.holes.length) throw new CompileError(`'${SPLICE}${i}' is the name a quote's splices are parsed under, so a quote can't use it`, at.start, at.end);
    found[i] = category;
  });
  return found.map((c, i) => {
    if (c) return c;
    const hole = q.holes[i]!;
    throw new CompileError("a splice in a quote stands for an expression, a statement or a type; splicing a name isn't supported yet", hole.start ?? at.start, hole.end ?? at.end);
  });
}

// The member of a union a node is: the object of its kind with all its fields, a string, an
// array or a number.
function memberFor({ unfold, field, rec }: Typing, node: unknown, union: UnionType): Type | undefined {
  const all = rec(union).members;
  const members = all.map(unfold);
  if (node === null || node === undefined) return members.includes("null") ? "null" : undefined;
  if (Array.isArray(node)) return all.find((m) => {
    const u = unfold(m);
    return typeof u !== "string" && rec(u).kind === "array";
  });
  if (typeof node === "string") return all.find((m) => {
    if (m === "string") return true;
    const r = typeof m === "string" ? undefined : rec(m);
    return r?.kind === "literal" && r.value === node;
  });
  if (typeof node !== "object") return all.find((m) => typeof m === "string" && m !== "null");
  const n = node as Record<string, unknown>;
  return all.find((m) => {
    const o = unfold(m);
    if (typeof o === "string") return false;
    if (rec(o).kind !== "object") return false;
    const kind = field(o, "kind")?.type;
    const kr = kind === undefined || typeof kind === "string" ? undefined : rec(kind);
    if (typeof n.kind === "string" && (kr?.kind !== "literal" || kr.value !== n.kind)) return false;
    return Object.keys(n).every((k) => k === "id" || field(o, k) !== undefined);
  });
}

function walk(typing: Typing, node: unknown, type: Type, types: Record<Category, Type>, q: Quote, hole: (i: usize, category: Category) => void) {
  const t = typing.unfolded(type);
  // A splice where a name goes takes an identifier, its name put there.
  const name = nameSplice(node);
  if (name !== undefined) {
    q.names.add(name);
    return hole(name, "AstExpr");
  }
  if (node === null || node === undefined || typeof t === "string") return;
  const r = typing.rec(t);
  if (r.kind === "union") {
    const splice = spliceIn(typing, node, t as UnionType, types, q.asExpressions);
    if (splice) return hole(splice.i, splice.category);
    const member = memberFor(typing, node, t as UnionType);
    if (member) walk(typing, node, member, types, q, hole);
    return;
  }
  if (r.kind === "array" && Array.isArray(node)) {
    for (const x of node) walk(typing, x, r.element, types, q, hole);
    return;
  }
  if (r.kind === "object") for (const f of r.fields) walk(typing, (node as Record<string, unknown>)[f.name], f.type, types, q, hole);
}

// The splice a node in a union's place stands for: a statement written as a splice alone, or a
// splice where an expression or a type goes.
function spliceIn(typing: Typing, node: unknown, t: UnionType, types: Record<Category, Type>, asExpressions: Set<usize>): { i: usize; category: Category } | undefined {
  const n = node as { kind?: string; expr?: unknown };
  const member = memberFor(typing, node, t);
  const statements = typing.unfold(types.AstStmt) as UnionType;
  if (n.kind === "expr" && spliceOf(n.expr) !== undefined && !asExpressions.has(spliceOf(n.expr)!) && member && typing.rec(statements).members.includes(member)) return { i: spliceOf(n.expr)!, category: "AstStmt" };
  const i = spliceOf(node);
  if (i === undefined) return undefined;
  if ((node as { kind: string }).kind === "ident" && isUnionOf(typing, t, types.AstExpr)) return { i, category: "AstExpr" };
  if ((node as { kind: string }).kind === "ref" && isUnionOf(typing, t, types.AstType)) return { i, category: "AstType" };
  return undefined;
}

function isUnionOf({ unfold, rec }: Typing, t: Type, category: Type): boolean {
  const c = unfold(category);
  if (typeof t === "string" || typeof c === "string") return false;
  const [tr, cr] = [rec(t), rec(c)];
  return tr.kind === "union" && cr.kind === "union" && cr.members.every((m) => tr.members.includes(m));
}

// What a quote's tree is while compiling: records of the Ast types, every node given the
// quote's span, each splice the value of its hole.
export type Builder<V> = {
  record(type: ObjectType, fields: Map<string, V>): V;
  array(items: V[]): V;
  member(value: V, of: Type, member: Type): V;
  splice(i: usize, into: Type): V;
  name(i: usize): V;
  int(n: bigint): V;
  none: V;
};

// While a macro runs: the private names of the top-level declarations its quotes make, known to
// all of them; the names each file declares or imports, which a quote written there means
// wherever its expansion lands; the spellings that pin them, `name-fsh<file>`, which the linker
// gives the declaration the name means in that file; and the names of the program's enum
// members, which a bare name in a quoted match means rather than binds.
export type Hygiene = { declared: Map<string, string>; namesIn(file: usize): Set<string>; pins: Set<string>; members: Set<string>; fresh(name: string): string };

// Runs `run` with the quotes it builds in the check `tables` belongs to taking hygiene `h`.
export function withHygiene<T>(tables: Tables, h: Hygiene, run: () => T): T {
  const outer = tables.hygiene;
  tables.hygiene = h;
  try {
    return run();
  } finally {
    tables.hygiene = outer;
  }
}

// The top-level names a quote declares, when it is a declaration. A C function keeps its name.
export function declaredBy(q: Quote): string[] {
  if (q.category !== "AstStmt") return [];
  const t = (q.tree as Stmt).kind === "export" ? (q.tree as Extract<Stmt, { kind: "export" }>).body : (q.tree as Stmt);
  if (!t) return [];
  if (t.kind === "let") return t.declarations.flatMap((d) => (d.target.kind === "ident" && nameSplice(d.target.name) === undefined ? [d.target.name] : []));
  const name = (t as { name?: unknown }).name;
  return DECLARATIONS.has(t.kind) && typeof name === "string" && nameSplice(name) === undefined ? [name] : [];
}

const DECLARATIONS = new Set(["function", "class", "typeAlias", "interface", "enum"]);
// The nodes whose `name` is a name of the program's, bound or used: never a member's or a key's.
const NAMED = new Set(["ident", "ref", "variant", "function", "class", "typeAlias", "interface", "enum", "infer", "mapped"]);
// The bare names a match pattern means rather than binds, besides the program's enum members.
const VARIANTS = new Set(["None"]);

// A quote's tree with its names made hygienic: each name it binds, a variable, a parameter, a
// type parameter, a match binding, an `infer` or a declaration, private to it and to the quotes
// spliced into it, whose bindings it gets in `bound`; and a name the file the quote is written in
// declares or imports, pinned to what it means there.
// The names left free in a quote, each with the spelling it was given there, for a quote it is
// spliced into to bind.
export type Free = Map<string, string>;

function hygienic(ids: Ids, tree: Quote["tree"], of: "expr" | "stmt" | "typeNode", h: Hygiene, file: usize, bound: Map<string, string>, free: Free): unknown {
  const copy = renumber(of, structuredClone(tree), () => nextId(ids));
  const rewrites = new Rewrites();
  const names = h.namesIn(file);
  const bind = (name: unknown) => {
    if (typeof name === "string" && name !== "this" && nameSplice(name) === undefined && !bound.has(name) && !h.declared.has(name)) bound.set(name, h.fresh(name));
  };
  const pattern = (p: unknown, inMatch = false) => {
    if (!p || typeof p !== "object") return;
    const n = p as { kind?: string; name?: unknown; target?: unknown; props?: { value: unknown }[]; elements?: unknown[]; rest?: unknown; args?: unknown[]; patterns?: unknown[] };
    // In a match a bare name binds, as the checker reads it, unless an enum has a member of it.
    if (n.kind === "ident" && !(inMatch && typeof n.name === "string" && (VARIANTS.has(n.name) || h.members.has(n.name)))) bind(n.name);
    if (n.kind === "default") pattern(n.target, inMatch);
    for (const x of n.props ?? []) pattern(x.value, inMatch);
    for (const x of [...(n.elements ?? []), ...(n.args ?? []), ...(n.patterns ?? [])]) pattern(x, inMatch);
    pattern(n.rest, inMatch);
  };
  walkTree(of, copy, ({ node }) => {
    const n = node as Record<string, unknown> & { kind?: string };
    // A C function's name, and its parameters', are C's.
    if (n.kind === "declare") return false;
    if (DECLARATIONS.has(n.kind!) || n.kind === "infer" || n.kind === "mapped") bind(n.name);
    if (n.kind === "let") for (const d of n.declarations as { target: unknown }[]) pattern(d.target);
    if (Array.isArray(n.params)) for (const p of n.params as { pattern: unknown }[]) pattern(p.pattern);
    if (Array.isArray(n.typeParams)) for (const p of n.typeParams as { name: unknown }[]) bind(p.name);
    if (n.kind === "try") pattern(n.param);
    if (Array.isArray(n.arms)) for (const a of n.arms as { pattern: unknown }[]) pattern(a.pattern, true);
  });
  const renamed = (name: string): string | undefined => {
    const [head, ...rest] = name.split(".");
    const to = bound.get(head!) ?? h.declared.get(head!);
    if (to) return [to, ...rest].join(".");
    if (!names.has(head!)) {
      free.set(head!, head!);
      return undefined;
    }
    const pinned = `${head}-fsh${file}`;
    h.pins.add(pinned);
    free.set(head!, pinned);
    return [pinned, ...rest].join(".");
  };
  walkTree(of, copy, ({ node }) => {
    const n = node as Record<string, unknown> & { kind?: string };
    if (n.kind === "declare") return false;
    if (NAMED.has(n.kind!) && typeof n.name === "string") n.name = renamed(n.name) ?? n.name;
    // `{ x }` naming a renamed variable is `{ x: x@m0 }`.
    if (n.kind === "shorthand" && typeof n.name === "string" && renamed(n.name)) {
      const key = n.name;
      const value: Expr = { id: nextId(ids), kind: "ident", name: renamed(key)!, start: n.start as usize, end: n.end as usize };
      rewrites.replace(node as Expr, { id: 0, kind: "property", key, value, start: value.start, end: value.end });
    }
    if (Array.isArray(n.typeParams)) for (const p of n.typeParams as { name: string }[]) p.name = bound.get(p.name) ?? p.name;
  });
  return of === "expr" ? rebuiltExpr(copy as Expr, rewrites) : of === "stmt" ? rebuiltStmt(copy as Stmt, rewrites) : rebuiltTypeNode(copy as TypeNode, rewrites);
}

// Without `at`, every node keeps its own span, as a declaration a macro takes does. `scope`
// gives the bindings of the quotes spliced in, and gets this quote's, with theirs; `free` gets
// the names it leaves free.
export function built<V>({ typing, hygiene, ids }: Tables, q: Quote, types: Record<Category, Type>, at: Span | undefined, b: Builder<V>, scope: Map<string, string> = new Map<string, string>(), free: Free = new Map()): V {
  // `here` is the span of the node a part is in, where an error about the part is reported.
  const make = (node: unknown, type: Type, here: Span = at ?? { start: 0, end: 0 }): V => {
    const t = typing.unfolded(type);
    const r = typeof t === "string" ? undefined : typing.rec(t);
    if (r?.kind === "union") {
      if (node === null || node === undefined) return b.member(b.none, t, "null");
      const splice = spliceIn(typing, node, t as UnionType, types, q.asExpressions);
      if (splice) return b.splice(splice.i, type);
      const member = memberFor(typing, node, t as UnionType);
      if (!member) throw new Error("internal error: a quoted node fits no member of its Ast type");
      return b.member(make(node, member, here), t, member);
    }
    if (node === null || node === undefined || t === "null") return b.none;
    if (t === "string" && nameSplice(node) !== undefined) return b.name(nameSplice(node)!);
    if (r === undefined) return t === "i64" ? b.int(inRange(BigInt(node as i64 | bigint), here)) : (node as V);
    if (r.kind === "literal") return r.value as V;
    if (r.kind === "array") return b.array((node as unknown[]).map((x) => make(x, r.element, here)));
    if (r.kind !== "object") throw new Error(`internal error: an Ast field of type '${r.kind}'`);
    const n = node as Record<string, unknown>;
    const own = !at && typeof n.start === "number" && typeof n.end === "number" ? { start: n.start, end: n.end } : here;
    const fields = new Map<string, V>();
    for (const f of r.fields) {
      if (f.name === "start" || f.name === "end") fields.set(f.name, b.int(BigInt(at ? at[f.name] : (n[f.name] as usize))));
      else fields.set(f.name, make(n[f.name], f.type, own));
    }
    return b.record(t as ObjectType, fields);
  };
  return make(at && hygiene ? hygienic(ids, q.tree, OF[q.category], hygiene, Math.floor(at.start / FILE_SPAN), scope, free) : q.tree, types[q.category]);
}

// An integer an Ast holds, as an `i64` until big integers.
function inRange(n: bigint, at: Span): bigint {
  if (n < -(1n << 63n) || n >= 1n << 63n) throw new CompileError(`an Ast holds an integer as an 'i64', which can't hold ${n}`, at.start, at.end);
  return n;
}
