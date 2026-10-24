import { CompileError } from "./diag.ts";
import { lexer } from "./lexer.ts";
import { parse, parseExpression, parseType, type Expr, type Span, type Stmt, type TypeNode } from "./parser.ts";
import { field, unfold, unfolded, type ObjectType, type Type, type UnionType } from "./typing.ts";

// `quote` and `quoteType`: Fish source written in a template, parsed while checking into the
// `Ast` value it stands for, with each `${x}` a splice of another node.

// What stands for the n-th splice while the text is parsed: a name no program writes.
const SPLICE = "__fishSplice";

export type Category = "AstExpr" | "AstStmt" | "AstType";
// `asExpressions` are the splices written as statements that are expressions, each the
// expression of its statement, as `e;` is.
export type Quote = { tree: Expr | Stmt | TypeNode; category: Category; holes: Expr[]; asExpressions: Set<number> };

const parsed = new WeakMap<Expr, Quote>();

// The tree a quote's text parses to: a type for `quoteType`, else an expression when the whole
// text is one and doesn't start as JavaScript's statements do, else one statement or
// declaration.
export function quoted(e: Extract<Expr, { kind: "tagged" }>, asType: boolean): Quote {
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
      tree = parseType(text);
    } catch (error) {
      tree = fail(error);
    }
    quote = { tree, category: "AstType", holes: template.exprs, asExpressions: new Set() };
  } else {
    // As JavaScript reads a statement, one starting with `function`, `class` or `{` is no
    // expression.
    const statement = startsStatement(text);
    let tree: Expr | Stmt | undefined;
    try {
      tree = statement ? undefined : parseExpression(text);
    } catch {
      tree = undefined;
    }
    if (tree) quote = { tree, category: "AstExpr", holes: template.exprs, asExpressions: new Set() };
    else {
      let stmts: Stmt[] = [];
      try {
        stmts = parse(text);
      } catch (error) {
        fail(error);
      }
      if (stmts.length !== 1) throw new CompileError(`a quote holds one expression, statement or declaration, not ${stmts.length}`, e.start, e.end);
      quote = { tree: stmts[0]!, category: "AstStmt", holes: template.exprs, asExpressions: new Set() };
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

// Which splice a node stands for, if it is one.
function spliceOf(node: unknown): number | undefined {
  if (!node || typeof node !== "object") return undefined;
  const n = node as { kind?: string; name?: unknown; args?: unknown[]; expr?: unknown };
  if ((n.kind !== "ident" && !(n.kind === "ref" && n.args?.length === 0)) || typeof n.name !== "string" || !n.name.startsWith(SPLICE)) return undefined;
  const i = n.name.slice(SPLICE.length);
  return /^\d+$/.test(i) ? Number(i) : undefined;
}

// The category each splice of a quote stands in, found by walking its tree beside the Ast type
// it makes; a splice anywhere else, as a name, is an error.
export function holesOf(q: Quote, types: Record<Category, Type>, at: Span): Category[] {
  const found: (Category | undefined)[] = q.holes.map(() => undefined);
  walk(q.tree, types[q.category], types, q.asExpressions, (i, category) => {
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
function memberFor(node: unknown, union: UnionType): Type | undefined {
  const members = union.members.map(unfold);
  if (node === null || node === undefined) return members.includes("null") ? "null" : undefined;
  if (Array.isArray(node)) return union.members.find((m) => typeof unfold(m) !== "string" && (unfold(m) as { kind: string }).kind === "array");
  if (typeof node === "string") return union.members.find((m) => m === "string" || (typeof m !== "string" && m.kind === "literal" && m.value === node));
  if (typeof node !== "object") return union.members.find((m) => typeof m === "string" && m !== "null");
  const n = node as Record<string, unknown>;
  return union.members.find((m) => {
    const o = unfold(m);
    if (typeof o === "string" || o.kind !== "object") return false;
    const kind = field(o, "kind")?.type;
    if (typeof n.kind === "string" && (typeof kind === "string" || kind?.kind !== "literal" || kind.value !== n.kind)) return false;
    return Object.keys(n).every((k) => field(o, k) !== undefined);
  });
}

function walk(node: unknown, type: Type, types: Record<Category, Type>, asExpressions: Set<number>, hole: (i: number, category: Category) => void) {
  const t = unfolded(type);
  if (node === null || node === undefined || typeof t === "string") return;
  if (t.kind === "union") {
    const splice = spliceIn(node, t, types, asExpressions);
    if (splice) return hole(splice.i, splice.category);
    const member = memberFor(node, t);
    if (member) walk(node, member, types, asExpressions, hole);
    return;
  }
  if (t.kind === "array" && Array.isArray(node)) {
    for (const x of node) walk(x, t.element, types, asExpressions, hole);
    return;
  }
  if (t.kind === "object") for (const f of t.fields) walk((node as Record<string, unknown>)[f.name], f.type, types, asExpressions, hole);
}

// The splice a node in a union's place stands for: a statement written as a splice alone, or a
// splice where an expression or a type goes.
function spliceIn(node: unknown, t: UnionType, types: Record<Category, Type>, asExpressions: Set<number>): { i: number; category: Category } | undefined {
  const n = node as { kind?: string; expr?: unknown };
  const member = memberFor(node, t);
  const statements = unfold(types.AstStmt) as UnionType;
  if (n.kind === "expr" && spliceOf(n.expr) !== undefined && !asExpressions.has(spliceOf(n.expr)!) && member && statements.members.includes(member)) return { i: spliceOf(n.expr)!, category: "AstStmt" };
  const i = spliceOf(node);
  if (i === undefined) return undefined;
  if ((node as { kind: string }).kind === "ident" && isUnionOf(t, types.AstExpr)) return { i, category: "AstExpr" };
  if ((node as { kind: string }).kind === "ref" && isUnionOf(t, types.AstType)) return { i, category: "AstType" };
  return undefined;
}

function isUnionOf(t: Type, category: Type): boolean {
  const c = unfold(category);
  return typeof t !== "string" && t.kind === "union" && typeof c !== "string" && c.kind === "union" && c.members.every((m) => t.members.includes(m));
}

// What a quote's tree is while compiling: records of the Ast types, every node given the
// quote's span, each splice the value of its hole.
export type Builder<V> = {
  record(type: ObjectType, fields: Map<string, V>): V;
  array(items: V[]): V;
  member(value: V, of: Type, member: Type): V;
  splice(i: number, into: Type): V;
  int(n: bigint): V;
  none: V;
};

// Without `at`, every node keeps its own span, as a declaration a macro takes does.
export function built<V>(q: Quote, types: Record<Category, Type>, at: Span | undefined, b: Builder<V>): V {
  const make = (node: unknown, type: Type): V => {
    const t = unfolded(type);
    if (typeof t !== "string" && t.kind === "union") {
      if (node === null || node === undefined) return b.member(b.none, t, "null");
      const splice = spliceIn(node, t, types, q.asExpressions);
      if (splice) return b.splice(splice.i, type);
      const member = memberFor(node, t);
      if (!member) throw new Error("internal error: a quoted node fits no member of its Ast type");
      return b.member(make(node, member), t, member);
    }
    if (node === null || node === undefined || t === "null") return b.none;
    if (typeof t === "string") return t === "i64" ? b.int(inRange(BigInt(node as number | bigint), at ?? { start: 0, end: 0 })) : (node as V);
    if (t.kind === "literal") return t.value as V;
    if (t.kind === "array") return b.array((node as unknown[]).map((x) => make(x, t.element)));
    if (t.kind !== "object") throw new Error(`internal error: an Ast field of type '${t.kind}'`);
    const n = node as Record<string, unknown>;
    const fields = new Map<string, V>();
    for (const f of t.fields) {
      if (f.name === "start" || f.name === "end") fields.set(f.name, b.int(BigInt(at ? at[f.name] : (n[f.name] as number))));
      else fields.set(f.name, make(n[f.name], f.type));
    }
    return b.record(t, fields);
  };
  return make(q.tree, types[q.category]);
}

// An integer an Ast holds, as an `i64` until big integers.
function inRange(n: bigint, at: Span): bigint {
  if (n < -(1n << 63n) || n >= 1n << 63n) throw new CompileError(`this quote holds the integer ${n}, which an Ast's 'i64' can't hold`, at.start, at.end);
  return n;
}
