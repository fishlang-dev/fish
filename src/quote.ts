import type { Tables } from "./compilation.ts";
import { CompileError } from "./diag.ts";
import { lexer } from "./lexer.ts";
import { FILE_SPAN } from "./program.ts";
import { parse, parseExpression, parseType, type Expr, type Span, type Stmt, type TypeNode } from "./parser.ts";
import { nextId, someNode, type AnyNode, type Ids } from "./nodes.ts";
import { cloneExpr } from "./rebuild.ts";
import type { ObjectType, Type, Typing } from "./typing.ts";
import { quoteTree, type QuoteField, type QuoteValue } from "./walk.ts";

// `quote` and `quoteType`: Fish source written in a template, parsed while checking into the
// `Ast` value it stands for, with each `${x}` a splice of another node.

// What stands for the n-th splice while the text is parsed: a name no program writes.
const SPLICE = "__fishSplice";

export type Category = "AstExpr" | "AstStmt" | "AstType";
// The Ast type each category of node is.
export type Categories = { AstExpr: Type; AstStmt: Type; AstType: Type };

function typeFor(types: Ref<Categories>, c: Category): Type {
  return c === "AstExpr" ? types.AstExpr : c === "AstStmt" ? types.AstStmt : types.AstType;
}

// A quote's tree as parsed: an expression, a statement or a type.
export type QuoteTree = { of: "expr"; node: Expr } | { of: "stmt"; node: Stmt } | { of: "typeNode"; node: TypeNode };

function treeNode(t: Ref<QuoteTree>): AnyNode {
  if (t.of === "expr") return { of: "expr", node: t.node };
  if (t.of === "stmt") return { of: "stmt", node: t.node };
  return { of: "typeNode", node: t.node };
}

// `asExpressions` are the splices written as statements that are expressions, each the
// expression of its statement, as `e;` is; `names` are those where a name goes, each taking an
// identifier's name.
export type Quote = { tree: QuoteTree; category: Category; holes: Expr[]; asExpressions: Set<usize>; names: Set<usize> };

// Whether `tree` uses `import.meta`.
function usesImportMeta(tree: Ref<QuoteTree>): boolean {
  return someNode(treeNode(tree), (n) => n.of === "expr" && n.node.kind === "meta" && n.node.name === "import.meta");
}

function unparsed(error: Ref<CompileError>, at: Ref<Span>): CompileError {
  return new CompileError("E1105", `this quote's text doesn't parse: ${error.message}`, at.start, at.end);
}

// The tree a quote's text parses to: a type for `quoteType`, else an expression when the whole
// text is one and doesn't start as JavaScript's statements do, else one statement or
// declaration. `parsedQuotes` holds each quote parsed so far.
/** @throws {CompileError} */
export function quoted(tables: Mut<Tables>, e: Ref<Extract<Expr, { kind: "tagged" }>>, asType: boolean): Quote {
  const made = tables.parsedQuotes.get(e);
  if (made !== undefined) return made;
  if (e.template.kind !== "template") throw new CompileError("E1105", "a quote is followed by a template literal", e.template.start, e.template.end);
  // The text as written, so a string's or a regex's escapes reach the parser as they would.
  let text = "";
  for (let i: usize = 0; i < e.template.raw.length; i++) {
    const q = e.template.raw[i]!.replace(/\\(`|\$\{)/g, "$1");
    text += i === 0 ? q : ` ${SPLICE}${i - 1} ${q}`;
  }
  let holes: Expr[] = [];
  for (const x of e.template.exprs) holes.push(cloneExpr(x));
  let tree: QuoteTree;
  let category: Category;
  if (asType) {
    try {
      tree = { of: "typeNode", node: parseType(text, tables.ids) };
    } catch (error) {
      if (!(error instanceof CompileError)) throw error;
      throw unparsed(error, e);
    }
    category = "AstType";
  } else {
    // As JavaScript reads a statement, one starting with `function`, `class` or `{` is no
    // expression.
    let expression: Expr | undefined = undefined;
    if (!startsStatement(text)) {
      try {
        expression = parseExpression(text, tables.ids);
      } catch {
        expression = undefined;
      }
    }
    if (expression !== undefined) {
      tree = { of: "expr", node: expression };
      category = "AstExpr";
    } else {
      let stmts: Stmt[] = [];
      try {
        stmts = parse(text, tables.ids);
      } catch (error) {
        if (!(error instanceof CompileError)) throw error;
        throw unparsed(error, e);
      }
      if (stmts.length !== 1) throw new CompileError("E1105", `a quote holds one expression, statement or declaration, not ${stmts.length}`, e.start, e.end);
      tree = { of: "stmt", node: stmts.pop()! };
      category = "AstStmt";
    }
  }
  // A quote is checked where the macro puts it, so whose file `import.meta` would name is open.
  if (!asType && usesImportMeta(tree)) throw new CompileError("E1105", "'import.meta' in a quote isn't supported yet: whether it names the macro's file or the file using the macro isn't decided", e.start, e.end);
  tables.parsedQuotes.set(cloneExpr(e), { tree, category, holes, asExpressions: new Set<usize>(), names: new Set<usize>() });
  return tables.parsedQuotes.get(e)!;
}

// Whether a text starts as only a statement can, past any comments.
function startsStatement(text: string): boolean {
  try {
    let tokens = lexer(text);
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
function spliceIndex(name: string): usize | undefined {
  if (!name.startsWith(SPLICE) || name.length === SPLICE.length) return undefined;
  let i: usize = 0;
  for (const c of name.slice(SPLICE.length as i64)) {
    if (c < "0" || c > "9") return undefined;
    i = i * 10 + ((c.charCodeAt(0) - 48) as usize);
  }
  return i;
}

// The text or the integer a node's field holds, or nothing when it holds none.
function textIn(fields: Ref<QuoteField[]>, name: string): string | undefined {
  for (const f of fields) if (f.name === name && f.value.kind === "text") return f.value.value;
  return undefined;
}

function intIn(fields: Ref<QuoteField[]>, name: string): i64 | undefined {
  for (const f of fields) if (f.name === name && f.value.kind === "int") return f.value.value;
  return undefined;
}

function kindOf(v: Ref<QuoteValue>): string | undefined {
  if (v.kind === "node") return textIn(v.fields, "kind");
  if (v.kind === "record") return textIn(v.fields, "kind");
  return undefined;
}

// Whether a node's field is an empty list.
function emptyIn(fields: Ref<QuoteField[]>, name: string): boolean {
  for (const f of fields) if (f.name === name) return f.value.kind === "list" && f.value.items.length === 0;
  return false;
}

// Which splice a name where a name goes stands for, if it is one.
function nameSplice(v: Ref<QuoteValue>): usize | undefined {
  return v.kind === "text" ? spliceIndex(v.value) : undefined;
}

// Which splice a node stands for, if it is one: an identifier, or a type naming one.
function spliceOf(v: Ref<QuoteValue>): usize | undefined {
  if (v.kind !== "node") return undefined;
  const kind = textIn(v.fields, "kind");
  if (kind === "ref") {
    if (!emptyIn(v.fields, "args")) return undefined;
  } else if (kind !== "ident") return undefined;
  const name = textIn(v.fields, "name");
  return name !== undefined ? spliceIndex(name) : undefined;
}

// The category each splice of a quote stands in, found by walking its tree beside the Ast type
// it makes; a splice anywhere else, as a name, is an error.
/** @throws {CompileError} */
export function holesOf(typing: Mut<Typing>, q: Mut<Quote>, types: Ref<Categories>, at: Ref<Span>): Category[] {
  const tree = quoteTree(treeNode(q.tree));
  let found: (Category | undefined)[] = [];
  for (let i: usize = 0; i < q.holes.length; i++) found.push(undefined);
  let names = new Set<usize>();
  holesIn(typing, tree, typeFor(types, q.category), types, q.asExpressions, names, found, at);
  for (const n of names) q.names.add(n);
  let out: Category[] = [];
  for (let i: usize = 0; i < found.length; i++) {
    const c = found[i];
    if (c === undefined) throw new CompileError("E1105", "a splice in a quote stands for an expression, a statement or a type; splicing a name isn't supported yet", q.holes[i]!.start, q.holes[i]!.end);
    out.push(c);
  }
  return out;
}

/** @throws {CompileError} */
function hole(found: Mut<(Category | undefined)[]>, i: usize, category: Category, at: Ref<Span>): void {
  if (i >= found.length) throw new CompileError("E1105", `'${SPLICE}${i}' is the name a quote's splices are parsed under, so a quote can't use it`, at.start, at.end);
  found[i] = category;
}

/** @throws {CompileError} */
function holesIn(typing: Mut<Typing>, v: Ref<QuoteValue>, type: Type, types: Ref<Categories>, asExpressions: Ref<Set<usize>>, names: Mut<Set<usize>>, found: Mut<(Category | undefined)[]>, at: Ref<Span>): void {
  const t = typing.unfolded(type);
  // A splice where a name goes takes an identifier, its name put there.
  const name = nameSplice(v);
  if (name !== undefined) {
    names.add(name);
    hole(found, name, "AstExpr", at);
    return;
  }
  if (v.kind === "none" || typeof t === "string") return;
  const members = unionMembers(typing, t);
  if (members !== undefined) {
    const splice = spliceIn(typing, v, t, members, types, asExpressions);
    if (splice !== undefined) {
      hole(found, splice.i, splice.category, at);
      return;
    }
    const member = memberFor(typing, v, members);
    if (member !== undefined) holesIn(typing, v, member, types, asExpressions, names, found, at);
    return;
  }
  const element = arrayElement(typing, t);
  if (element !== undefined) {
    if (v.kind === "list") for (const x of v.items) holesIn(typing, x, element, types, asExpressions, names, found, at);
    return;
  }
  const fields = objectFields(typing, t);
  if (v.kind === "node") holesInFields(typing, v.fields, fields, types, asExpressions, names, found, at);
  else if (v.kind === "record") holesInFields(typing, v.fields, fields, types, asExpressions, names, found, at);
}

// Each field of an object type's value, in the type's order.
/** @throws {CompileError} */
function holesInFields(typing: Mut<Typing>, values: Ref<QuoteField[]>, fields: Ref<{ name: string; type: Type }[]>, types: Ref<Categories>, asExpressions: Ref<Set<usize>>, names: Mut<Set<usize>>, found: Mut<(Category | undefined)[]>, at: Ref<Span>): void {
  for (const f of fields) for (const g of values) if (g.name === f.name) holesIn(typing, g.value, f.type, types, asExpressions, names, found, at);
}

function unionMembers(typing: Ref<Typing>, t: Type): Type[] | undefined {
  if (typeof t === "string") return undefined;
  const r = typing.rec(t);
  if (r.kind !== "union") return undefined;
  let out: Type[] = [];
  for (const m of r.members) out.push(m);
  return out;
}

function arrayElement(typing: Ref<Typing>, t: Type): Type | undefined {
  if (typeof t === "string") return undefined;
  const r = typing.rec(t);
  return r.kind === "array" ? r.element : undefined;
}

function objectFields(typing: Ref<Typing>, t: Type): { name: string; type: Type }[] {
  let out: { name: string; type: Type }[] = [];
  if (typeof t === "string") return out;
  const r = typing.rec(t);
  if (r.kind === "object") for (const f of r.fields) out.push({ name: f.name, type: f.type });
  return out;
}

// The member of a union a value is: the object of its kind with all its fields, a string, an
// array or a number.
function memberFor(typing: Ref<Typing>, v: Ref<QuoteValue>, all: Ref<Type[]>): Type | undefined {
  if (v.kind === "none") {
    for (const m of all) if (typing.unfold(m) === "null") return "null";
    return undefined;
  }
  if (v.kind === "list") {
    for (const m of all) if (arrayElement(typing, typing.unfold(m)) !== undefined) return m;
    return undefined;
  }
  if (v.kind === "text") {
    for (const m of all) {
      if (m === "string") return m;
      if (typeof m !== "string") {
        const r = typing.rec(m);
        if (r.kind === "literal" && r.value === v.value) return m;
      }
    }
    return undefined;
  }
  if (v.kind !== "node" && v.kind !== "record") {
    for (const m of all) if (typeof m === "string" && m !== "null") return m;
    return undefined;
  }
  const kind = kindOf(v);
  for (const m of all) {
    const o = typing.unfold(m);
    if (typeof o === "string" || typing.rec(o).kind !== "object") continue;
    const k = typing.field(o, "kind");
    const kr = k === undefined || typeof k.type === "string" ? undefined : typing.rec(k.type);
    if (kind !== undefined && (kr === undefined || kr.kind !== "literal" || kr.value !== kind)) continue;
    if (fieldsFit(typing, v, o)) return m;
  }
  return undefined;
}

// Whether every field a value has, its id aside, is a field of the object type `o`.
function fieldsFit(typing: Ref<Typing>, v: Ref<QuoteValue>, o: Exclude<Type, string>): boolean {
  if (v.kind === "node") {
    for (const f of v.fields) if (f.name !== "id" && typing.field(o, f.name) === undefined) return false;
  }
  if (v.kind === "record") {
    for (const f of v.fields) if (f.name !== "id" && typing.field(o, f.name) === undefined) return false;
  }
  return true;
}

// The splice a value in a union's place stands for: a statement written as a splice alone, or a
// splice where an expression or a type goes.
function spliceIn(typing: Ref<Typing>, v: Ref<QuoteValue>, t: Type, members: Ref<Type[]>, types: Ref<Categories>, asExpressions: Ref<Set<usize>>): { i: usize; category: Category } | undefined {
  const kind = v.kind === "node" ? kindOf(v) : undefined;
  if (v.kind === "node" && kind === "expr") {
    let i: usize | undefined = undefined;
    for (const f of v.fields) if (f.name === "expr") i = spliceOf(f.value);
    if (i !== undefined && !asExpressions.has(i)) {
      const member = memberFor(typing, v, members);
      const statements = unionMembers(typing, typing.unfold(types.AstStmt));
      if (member !== undefined && statements !== undefined && statements.includes(member)) return { i, category: "AstStmt" };
    }
  }
  const i = spliceOf(v);
  if (i === undefined) return undefined;
  if (kind === "ident" && isUnionOf(typing, t, types.AstExpr)) return { i, category: "AstExpr" };
  if (kind === "ref" && isUnionOf(typing, t, types.AstType)) return { i, category: "AstType" };
  return undefined;
}

function isUnionOf(typing: Ref<Typing>, t: Type, category: Type): boolean {
  const these = unionMembers(typing, t);
  const those = unionMembers(typing, typing.unfold(category));
  if (these === undefined || those === undefined) return false;
  for (const m of those) if (!these.includes(m)) return false;
  return true;
}

// What a quote's tree is while compiling: records of the Ast types, every node given the
// quote's span, each splice the value of its hole, and the text, numbers and flags it holds.
export interface Builder<V> {
  // Called once the quote's bindings are in `scope`, before any splice; a name a splice leaves
  // free that nothing binds goes in `free`.
  prepare(this: Mut<this>, scope: Ref<Map<string, string>>, free: Mut<Free>): void;
  record(type: ObjectType, fields: Map<string, V>): V;
  array(items: V[]): V;
  member(value: V, of: Type, member: Type): V;
  /** @throws {CompileError} */
  splice(typing: Mut<Typing>, i: usize, into: Type): V;
  /** @throws {CompileError} */
  name(i: usize): V;
  int(n: bigint): V;
  text(s: string): V;
  boolean(b: boolean): V;
  float(f: f64): V;
  literal(value: string | bigint | boolean): V;
  none(): V;
}

// While a macro runs: the private names of the top-level declarations its quotes make, known to
// all of them; the names each file declares or imports, which a quote written there means
// wherever its expansion lands; the spellings that pin them, `name-fsh<file>`, which the linker
// gives the declaration the name means in that file; and the names of the program's enum
// members, which a bare name in a quoted match means rather than binds. A fresh name is a name
// with the expansion's `suffix`, noted in `made` for the compilation's made-up names.
export type Hygiene = { declared: Map<string, string>; namesIn: Map<usize, Set<string>>; pins: Set<string>; members: Set<string>; suffix: string; made: Set<string> };

// A name only this expansion's quotes write.
export function freshName(h: Mut<Hygiene>, name: string): string {
  h.made.add(`${name}${h.suffix}`);
  return `${name}${h.suffix}`;
}

// Runs `run` with the quotes it builds in the check `tables` belongs to taking hygiene `h`.
export function withHygiene<T>(tables: Mut<Tables>, h: Hygiene, run: () => T): T {
  tables.hygienes.push(h);
  try {
    return run();
  } finally {
    tables.hygienes.pop();
  }
}

// The top-level names a quote declares, when it is a declaration. A C function keeps its name.
export function declaredBy(q: Ref<Quote>): string[] {
  if (q.tree.of !== "stmt") return [];
  return declaredIn(q.tree.node);
}

function declaredIn(s: Ref<Stmt>): string[] {
  if (s.kind === "export") return declaredIn(s.body);
  let out: string[] = [];
  if (s.kind === "let") {
    for (const d of s.declarations) if (d.target.kind === "ident" && spliceIndex(d.target.name) === undefined) out.push(d.target.name);
  }
  if (s.kind === "function" && spliceIndex(s.name) === undefined) out.push(s.name);
  if (s.kind === "class" && s.name !== undefined && spliceIndex(s.name) === undefined) out.push(s.name);
  if (s.kind === "typeAlias" && spliceIndex(s.name) === undefined) out.push(s.name);
  if (s.kind === "interface" && spliceIndex(s.name) === undefined) out.push(s.name);
  if (s.kind === "enum" && spliceIndex(s.name) === undefined) out.push(s.name);
  return out;
}

const DECLARATIONS = new Set<string>(["function", "class", "typeAlias", "interface", "enum"]);
// The nodes whose `name` is a name of the program's, bound or used: never a member's or a key's.
const NAMED = new Set<string>(["ident", "ref", "variant", "function", "class", "typeAlias", "interface", "enum", "infer", "mapped"]);
// The bare names a match pattern means rather than binds, besides the program's enum members.
const VARIANTS = new Set<string>(["None"]);

// The names left free in a quote, each with the spelling it was given there, for a quote it is
// spliced into to bind.
export type Free = Map<string, string>;

// Making a quote's tree hygienic: `h` the macro's hygiene, `m` the file the quote is written in
// and the names that file declares or imports, `bound` the names bound in the quote and the quotes
// spliced into it, and `free` the names it leaves free.
type Making = { file: usize; names: Set<string> };

// A quote's tree with its names made hygienic: each name it binds, a variable, a parameter, a
// type parameter, a match binding, an `infer` or a declaration, private to it and to the quotes
// spliced into it, whose bindings it gets in `bound`; and a name the file the quote is written in
// declares or imports, pinned to what it means there.
function hygienic(ids: Mut<Ids>, tree: Ref<QuoteValue>, m: Ref<Making>, h: Mut<Hygiene>, bound: Mut<Map<string, string>>, free: Mut<Free>): QuoteValue {
  binds(h, bound, tree);
  return renamedValue(ids, m, h, bound, free, tree);
}

function bind(h: Mut<Hygiene>, bound: Mut<Map<string, string>>, name: string | undefined): void {
  if (name === undefined || name === "this" || spliceIndex(name) !== undefined || bound.has(name) || h.declared.has(name)) return;
  const fresh = freshName(h, name);
  bound.set(name, fresh);
}

// Binds the names a tree's declarations, parameters, type parameters and patterns bind.
function binds(h: Mut<Hygiene>, bound: Mut<Map<string, string>>, v: Ref<QuoteValue>): void {
  if (v.kind === "list") {
    for (const x of v.items) binds(h, bound, x);
    return;
  }
  if (v.kind === "record") {
    for (const f of v.fields) binds(h, bound, f.value);
    return;
  }
  if (v.kind !== "node") return;
  const kind = textIn(v.fields, "kind");
  // A C function's name, and its parameters', are C's.
  if (kind === "declare") return;
  if (kind !== undefined && (DECLARATIONS.has(kind) || kind === "infer" || kind === "mapped")) bind(h, bound, textIn(v.fields, "name"));
  if (kind === "let") for (const f of v.fields) if (f.name === "declarations") bindEach(h, bound, f.value, "target", false);
  for (const f of v.fields) if (f.name === "params") bindEach(h, bound, f.value, "pattern", false);
  for (const f of v.fields) if (f.name === "typeParams" && f.value.kind === "list") for (const p of f.value.items) if (p.kind === "node") bind(h, bound, textIn(p.fields, "name"));
  if (kind === "try") for (const f of v.fields) if (f.name === "param") bindPattern(h, bound, f.value, false);
  for (const f of v.fields) if (f.name === "arms") bindEach(h, bound, f.value, "pattern", true);
  for (const f of v.fields) binds(h, bound, f.value);
}

// The pattern each node in a list holds in its field `field`.
function bindEach(h: Mut<Hygiene>, bound: Mut<Map<string, string>>, list: Ref<QuoteValue>, field: string, inMatch: boolean): void {
  if (list.kind !== "list") return;
  for (const x of list.items) if (x.kind === "node") for (const g of x.fields) if (g.name === field) bindPattern(h, bound, g.value, inMatch);
}

function bindPattern(h: Mut<Hygiene>, bound: Mut<Map<string, string>>, p: Ref<QuoteValue>, inMatch: boolean): void {
  if (p.kind !== "node") return;
  const kind = textIn(p.fields, "kind");
  const name = textIn(p.fields, "name");
  // In a match a bare name binds, as the checker reads it, unless an enum has a member of it.
  if (kind === "ident" && !(inMatch && name !== undefined && (VARIANTS.has(name) || h.members.has(name)))) bind(h, bound, name);
  if (kind === "default") for (const f of p.fields) if (f.name === "target") bindPattern(h, bound, f.value, inMatch);
  for (const f of p.fields) if (f.name === "props") bindEach(h, bound, f.value, "value", inMatch);
  for (const field of ["elements", "args", "patterns"]) {
    for (const f of p.fields) if (f.name === field && f.value.kind === "list") for (const x of f.value.items) bindPattern(h, bound, x, inMatch);
  }
  for (const f of p.fields) if (f.name === "rest") bindPattern(h, bound, f.value, inMatch);
}

// What a name in a quote is spelled as: a binding's fresh name, a name of the quote's file pinned
// to what it means there, or itself, left free.
function renamedName(m: Ref<Making>, h: Mut<Hygiene>, bound: Ref<Map<string, string>>, free: Mut<Free>, name: string): string | undefined {
  const parts = name.split(".");
  const head = parts[0]!;
  let rest = "";
  for (let i: usize = 1; i < parts.length; i++) rest += `.${parts[i]!}`;
  const binding = bound.get(head);
  const to = binding !== undefined ? binding : h.declared.get(head);
  if (to !== undefined) return `${to}${rest}`;
  if (!m.names.has(head)) {
    free.set(head, head);
    return undefined;
  }
  const pinned = `${head}-fsh${m.file}`;
  h.pins.add(pinned);
  free.set(head, pinned);
  return `${pinned}${rest}`;
}

// A copy of a tree with its names spelled as `renamedName` gives them.
function renamedValue(ids: Mut<Ids>, m: Ref<Making>, h: Mut<Hygiene>, bound: Mut<Map<string, string>>, free: Mut<Free>, v: Ref<QuoteValue>): QuoteValue {
  switch (v.kind) {
    case "none":
      return { kind: "none" };
    case "text":
      return { kind: "text", value: v.value };
    case "boolean":
      return { kind: "boolean", value: v.value };
    case "int":
      return { kind: "int", value: v.value };
    case "bigint":
      return { kind: "bigint", value: v.value };
    case "float":
      return { kind: "float", value: v.value };
    case "list": {
      let out: QuoteValue[] = [];
      for (const x of v.items) out.push(renamedValue(ids, m, h, bound, free, x));
      return { kind: "list", items: out };
    }
    case "record": {
      let out: QuoteField[] = [];
      for (const f of v.fields) out.push({ name: f.name, value: renamedValue(ids, m, h, bound, free, f.value) });
      return { kind: "record", fields: out };
    }
    case "node":
      return renamedNode(ids, m, h, bound, free, v.of, v.fields);
  }
  return { kind: "none" };
}

function renamedNode(ids: Mut<Ids>, m: Ref<Making>, h: Mut<Hygiene>, bound: Mut<Map<string, string>>, free: Mut<Free>, of: string, fields: Ref<QuoteField[]>): QuoteValue {
  const kind = textIn(fields, "kind");
  if (kind === "declare") return { kind: "node", of, fields: copyFields(fields) };
  const name = textIn(fields, "name");
  const to = kind !== undefined && NAMED.has(kind) && name !== undefined ? renamedName(m, h, bound, free, name) : undefined;
  // `{ x }` naming a renamed variable is `{ x: x@m0 }`.
  const shorthand = of === "objectProp" && kind === "shorthand" && name !== undefined ? renamedName(m, h, bound, free, name) : undefined;
  let out: QuoteField[] = [];
  for (const f of fields) {
    if (f.name === "name" && to !== undefined) out.push({ name: "name", value: { kind: "text", value: to } });
    else if (f.name === "typeParams") out.push({ name: "typeParams", value: renamedTypeParams(ids, m, h, bound, free, f.value) });
    else out.push({ name: f.name, value: renamedValue(ids, m, h, bound, free, f.value) });
  }
  if (shorthand === undefined || name === undefined) return { kind: "node", of, fields: out };
  const start = intIn(fields, "start") ?? 0;
  const end = intIn(fields, "end") ?? 0;
  const value: QuoteValue = { kind: "node", of: "expr", fields: [
    { name: "kind", value: { kind: "text", value: "ident" } },
    { name: "start", value: { kind: "int", value: start } },
    { name: "end", value: { kind: "int", value: end } },
    { name: "id", value: { kind: "int", value: nextId(ids) as i64 } },
    { name: "name", value: { kind: "text", value: shorthand } },
  ] };
  return { kind: "node", of, fields: [
    { name: "kind", value: { kind: "text", value: "property" } },
    { name: "start", value: { kind: "int", value: start } },
    { name: "end", value: { kind: "int", value: end } },
    { name: "id", value: { kind: "int", value: 0 } },
    { name: "key", value: { kind: "text", value: name } },
    { name: "value", value },
  ] };
}

// A declaration's own type parameters, each renamed to the name it binds.
function renamedTypeParams(ids: Mut<Ids>, m: Ref<Making>, h: Mut<Hygiene>, bound: Mut<Map<string, string>>, free: Mut<Free>, v: Ref<QuoteValue>): QuoteValue {
  const copy = renamedValue(ids, m, h, bound, free, v);
  if (copy.kind !== "list") return copy;
  let out: QuoteValue[] = [];
  for (const p of copy.items) {
    if (p.kind !== "node") {
      out.push(copyValue(p));
      continue;
    }
    let fields: QuoteField[] = [];
    for (const f of p.fields) {
      const name = f.name === "name" && f.value.kind === "text" ? f.value.value : undefined;
      const to = name !== undefined ? bound.get(name) : undefined;
      if (to !== undefined) fields.push({ name: f.name, value: { kind: "text", value: to } });
      else fields.push({ name: f.name, value: copyValue(f.value) });
    }
    out.push({ kind: "node", of: p.of, fields });
  }
  return { kind: "list", items: out };
}

function copyFields(fields: Ref<QuoteField[]>): QuoteField[] {
  let out: QuoteField[] = [];
  for (const f of fields) out.push({ name: f.name, value: copyValue(f.value) });
  return out;
}

function copyValue(v: Ref<QuoteValue>): QuoteValue {
  switch (v.kind) {
    case "none":
      return { kind: "none" };
    case "text":
      return { kind: "text", value: v.value };
    case "boolean":
      return { kind: "boolean", value: v.value };
    case "int":
      return { kind: "int", value: v.value };
    case "bigint":
      return { kind: "bigint", value: v.value };
    case "float":
      return { kind: "float", value: v.value };
    case "list": {
      let out: QuoteValue[] = [];
      for (const x of v.items) out.push(copyValue(x));
      return { kind: "list", items: out };
    }
    case "record":
      return { kind: "record", fields: copyFields(v.fields) };
    case "node":
      return { kind: "node", of: v.of, fields: copyFields(v.fields) };
  }
  return { kind: "none" };
}

// What building a quote's value reads: its tree's Ast types and the splices written as
// expressions, and with `fixed`, the span every node is given.
type Building = { types: Categories; asExpressions: Set<usize>; fixed: boolean; start: usize; end: usize };

// Without `at`, every node keeps its own span, as a declaration a macro takes does. `scope`
// gives the bindings of the quotes spliced in, and gets this quote's, with theirs; `free` gets
// the names it leaves free.
/** @throws {CompileError} */
export function built<V, K extends Builder<V>>(tables: Mut<Tables>, q: Ref<Quote>, types: Ref<Categories>, at: Span | undefined, b: Mut<K>, scope: Mut<Map<string, string>>, free: Mut<Free>): V {
  const tree = quoteTree(treeNode(q.tree));
  let asExpressions = new Set<usize>();
  for (const i of q.asExpressions) asExpressions.add(i);
  const c: Building = { types: { AstExpr: types.AstExpr, AstStmt: types.AstStmt, AstType: types.AstType }, asExpressions, fixed: at !== undefined, start: at !== undefined ? at.start : 0, end: at !== undefined ? at.end : 0 };
  const type = typeFor(types, q.category);
  const last = tables.hygienes.length;
  if (at === undefined || last === 0) {
    b.prepare(scope, free);
    return make<V, K>(tables.typing, c, b, tree, type, c.start, c.end);
  }
  const span = FILE_SPAN as usize;
  const file = (at.start - (at.start % span)) / span;
  const m: Making = { file, names: tables.hygienes[last - 1]!.namesIn.get(file)! };
  const clean = hygienic(tables.ids, tree, m, tables.hygienes[last - 1]!, scope, free);
  b.prepare(scope, free);
  return make<V, K>(tables.typing, c, b, clean, type, c.start, c.end);
}

// The value of `v`, of the Ast type `type`. `start` and `end` are the span of the node a part is
// in, where an error about the part is reported.
/** @throws {CompileError} */
function make<V, K extends Builder<V>>(typing: Mut<Typing>, c: Ref<Building>, b: Ref<K>, v: Ref<QuoteValue>, type: Type, start: usize, end: usize): V {
  const t = typing.unfolded(type);
  const members = unionMembers(typing, t);
  if (members !== undefined) {
    if (v.kind === "none") return b.member(b.none(), t, "null");
    const splice = spliceIn(typing, v, t, members, c.types, c.asExpressions);
    if (splice !== undefined) return b.splice(typing, splice.i, type);
    const member = memberFor(typing, v, members);
    if (member === undefined) throw new CompileError("E1103", "internal error: a quoted node fits no member of its Ast type", start, end);
    return b.member(make<V, K>(typing, c, b, v, member, start, end), t, member);
  }
  if (v.kind === "none" || t === "null") return b.none();
  if (t === "string") {
    const name = nameSplice(v);
    if (name !== undefined) return b.name(name);
  }
  if (typeof t === "string") {
    if (t === "i64") return b.int(inRange(intOf(v), start, end));
    if (v.kind === "text") return b.text(v.value);
    if (v.kind === "boolean") return b.boolean(v.value);
    if (v.kind === "float") return b.float(v.value);
    throw new CompileError("E1103", `internal error: an Ast field of type '${t}' holds a ${v.kind}`, start, end);
  }
  const r = typing.rec(t);
  if (r.kind === "literal") return b.literal(r.value);
  const element = arrayElement(typing, t);
  if (element !== undefined) {
    let out: V[] = [];
    if (v.kind === "list") for (const x of v.items) out.push(make<V, K>(typing, c, b, x, element, start, end));
    return b.array(out);
  }
  if (r.kind !== "object") throw new CompileError("E1103", `internal error: an Ast field of type '${r.kind}'`, start, end);
  const fields = objectFields(typing, t);
  let out = new Map<string, V>();
  if (v.kind === "node") makeFields<V, K>(typing, c, b, v.fields, fields, start, end, out);
  else if (v.kind === "record") makeFields<V, K>(typing, c, b, v.fields, fields, start, end, out);
  else makeFields<V, K>(typing, c, b, [], fields, start, end, out);
  return b.record(t as ObjectType, out);
}

// Each field of an object type's value, in the type's order, a field it doesn't have nothing.
// Without a fixed span, a node keeps its own.
/** @throws {CompileError} */
function makeFields<V, K extends Builder<V>>(typing: Mut<Typing>, c: Ref<Building>, b: Ref<K>, values: Ref<QuoteField[]>, fields: Ref<{ name: string; type: Type }[]>, start: usize, end: usize, out: Mut<Map<string, V>>): void {
  const ownStart = intIn(values, "start");
  const ownEnd = intIn(values, "end");
  let hereStart = start;
  let hereEnd = end;
  if (!c.fixed && ownStart !== undefined && ownEnd !== undefined) {
    hereStart = ownStart as usize;
    hereEnd = ownEnd as usize;
  }
  const none: QuoteValue = { kind: "none" };
  for (const f of fields) {
    if (f.name === "start" || f.name === "end") {
      const written = f.name === "start" ? ownStart : ownEnd;
      const at = c.fixed ? (f.name === "start" ? c.start : c.end) : written !== undefined ? (written as usize) : 0;
      out.set(f.name, b.int(BigInt(at)));
      continue;
    }
    let found = false;
    for (const g of values) {
      if (g.name !== f.name) continue;
      out.set(f.name, make<V, K>(typing, c, b, g.value, f.type, hereStart, hereEnd));
      found = true;
      break;
    }
    if (!found) out.set(f.name, make<V, K>(typing, c, b, none, f.type, hereStart, hereEnd));
  }
}

function intOf(v: Ref<QuoteValue>): bigint {
  if (v.kind === "int") return BigInt(v.value);
  if (v.kind === "bigint") return v.value;
  return 0n;
}

// An integer an Ast holds, as an `i64` until big integers.
/** @throws {CompileError} */
function inRange(n: bigint, start: usize, end: usize): bigint {
  if (n < -(1n << 63n) || n >= 1n << 63n) throw new CompileError("E1105", `an Ast holds an integer as an 'i64', which can't hold ${n}`, start, end);
  return n;
}
