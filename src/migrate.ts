import { CompileError } from "./diag.ts";
import { isToken, type Comment, type Token } from "./lexer.ts";
import type { Edition } from "./manifest.ts";
import { forEachChild, nodeIdOf, reborrowNode, type AnyNode, type Ids } from "./nodes.ts";
import { parseWithComments, type Expr, type Specifier, type Stmt, type TypeNode } from "./parser.ts";

// Migrating TypeScript into Fish: the edition a file is in, and the rules that find what a
// TS-compat file has to change before it compiles as native Fish.

// The edition a file's directive names, and where the directive is, or undefined without one. The
// directive is the file's first line, or its second after a shebang.
/** @throws {CompileError} */
export function directive(src: string): { edition: Edition; start: usize; end: usize } | undefined {
  const shebang = src.startsWith("#!");
  const start: usize = shebang ? ((src.indexOf("\n") + 1) as usize) : 0;
  if (shebang && start === 0) return undefined;
  const newline = src.indexOf("\n", start as i64);
  const line = src.slice(start as i64, newline < 0 ? (src.length as i64) : newline).replace(/\r$/, "");
  if (!/^\/\/\s*@fish-edition(?=\s|$)/.test(line)) return undefined;
  const end = start + line.length;
  let edition: Edition | undefined = undefined;
  if (line === "// @fish-edition native") edition = "native";
  else if (line === "// @fish-edition ts-compat") edition = "ts-compat";
  if (edition === undefined) throw new CompileError("E0005", "an edition directive is written '// @fish-edition native' or '// @fish-edition ts-compat'", start, end);
  return { edition, start, end };
}

// Refuses a file in the TS-compat edition, by its directive or else its package's, at the
// directive or the file's first line.
/** @throws {CompileError} */
export function refuseCompat(src: string, packaged: Edition | undefined) {
  const declared = directive(src);
  const edition = declared !== undefined ? declared.edition : packaged;
  if (edition !== "ts-compat") return;
  const message = "this file is in the TS-compat edition, which Fish doesn't compile; run 'fishc lint' to find what to change, then mark it '// @fish-edition native'";
  if (declared !== undefined) throw new CompileError("E0006", message, declared.start, declared.end);
  const newline = src.indexOf("\n");
  const first: usize = newline < 0 ? src.length : (newline as usize);
  throw new CompileError("E0006", message, 0, first > 1 ? first : 1);
}

// A construct a migration rule finds, by the rule's id, over a file's text. An auto rule's hit
// carries the edits that fix it, applied together or not at all, and says what they change.
export type Action = "auto" | "guided" | "reject";
export type Edit = { start: usize; end: usize; text: string };
export type Hit = { rule: string; action: Action; start: usize; end: usize; edits?: Edit[]; message?: string };

// The comment the lint leaves after each ownership type it inserts, for a person to confirm.
export const MARKER = "/* fish: review */";

// What each reject rule asks for instead, as `fishc lint` says it.
export const REJECTS: Record<string, string> = {
  R1: "eval and new Function run code made while the program runs, and a native binary has no compiler for it; write the code itself, or choose among functions with a Map or a switch",
  R2: "prototype edits and Object.defineProperty change a type after it is declared, and Fish types have fixed layouts; declare the field or method on the class, or wrap the value",
  R3: "delete removes a field, and Fish objects have fixed layouts; make the field an Option and set it to null, or keep the entries in a dictionary, '{ [k: string]: T }', or a Map",
  R5: "the arguments object isn't in Fish; take the arguments as a rest parameter, as in '...args: T[]'",
  R6: "Symbol is runtime reflection, which Fish doesn't have beyond a '[Symbol.iterator]' method; use a string or an enum for a key, and an interface for a protocol",
  R7: "declaration merging and module augmentation reopen a type after it is declared, and Fish types are closed; give everything in one declaration, or a new name",
};

const OWN_MEMBERS = new Set(["field", "method", "get", "set"]);
const MERGING = new Set(["function", "class", "interface", "namespace", "enum"]);

const byStart = (a: Ref<Hit>, b: Ref<Hit>): i64 => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0);

// Applies the auto rules' edits to `src` in rounds: each round takes the hits whose edits overlap
// none taken before them, and the next round finds what is left, up to five rounds. `fsh` says
// whether a relative `.ts` import's `.fsh` file is there, or will be. Gives the text and how many
// hits were fixed. Throws a CompileError when `src` doesn't parse, or when the fixes give text
// that doesn't, which would be the lint's mistake.
/** @throws {CompileError} */
export function fix(src: string, fsh?: Imported): { text: string; fixed: usize } {
  let text = src;
  let fixed: usize = 0;
  let edited = false;
  // What `fsh` says of each import, asked once each, as the same import gets the same answer.
  let answers = new Map<string, string>();
  for (let round = 0; round < 5; round++) {
    let ids: Ids = { last: 0 };
    const parsed = parseWithComments(text, ids);
    const f = fileOf(parsed.program, text, parsed.tokens);
    for (const m of tsImports(f)) if (!answers.has(m)) answers.set(m, answerOf(fsh === undefined ? "rename" : fsh(m)));
    let fixable = hitsIn(f, parsed, text, answers).filter((h) => h.edits !== undefined && h.edits.length > 0);
    fixable.sort(byStart);
    let taken: Edit[] = [];
    let count: usize = 0;
    for (const h of fixable) {
      const edits: Ref<Edit[] | undefined> = h.edits;
      if (edits === undefined || edits.some((e) => taken.some((t) => overlaps(e, t)))) continue;
      for (const e of edits) taken.push({ start: e.start, end: e.end, text: e.text });
      count++;
    }
    edited = count > 0;
    if (!edited) break;
    // Edits at one place apply in the order their hit gave them.
    let ordered: { start: usize; end: usize; text: string; i: usize }[] = [];
    let i: usize = 0;
    while (taken.length > 0) {
      const e = taken.shift()!;
      ordered.push({ start: e.start, end: e.end, text: e.text, i });
      i++;
    }
    ordered.sort((a, b) => (a.start !== b.start ? (a.start > b.start ? -1 : 1) : a.i > b.i ? -1 : a.i < b.i ? 1 : 0));
    for (const e of ordered) text = text.slice(0, e.start as i64) + e.text + text.slice(e.end as i64);
    fixed += count;
  }
  let ids: Ids = { last: 0 };
  if (edited) parseWithComments(text, ids);
  return { text, fixed };
}

// Two edits over the same text, or one inside the other's, can't both apply in one round; nor
// can two inserted at one place by different hits.
const overlaps = (a: Ref<Edit>, b: Ref<Edit>) => (a.start === b.start && (a.start === a.end || b.start === b.end)) || (a.start < b.end && b.start < a.end);

export type Parsed = { program: Stmt[]; comments: Comment[]; tokens: Token[] };
// What a relative `.ts` import's target is to become: renamed to `.fsh` when that file is there or
// will be, ambiguous when both the `.ts` and the `.fsh` file are there, or nothing to change.
export type Imported = (specifier: string) => "rename" | "ambiguous" | undefined;

// Every migration rule's hits in a parsed file, in no particular order: the reject rules, the auto
// rules with their edits, and the review markers among its comments. An edit that would delete a
// comment is dropped, its hit reported but not fixed. `fsh` is as for `fix`, renaming by default.
export function migrations(parsed: Ref<Parsed>, src: string, fsh?: Imported): Hit[] {
  const f = fileOf(parsed.program, src, parsed.tokens);
  let answers = new Map<string, string>();
  for (const m of tsImports(f)) if (!answers.has(m)) answers.set(m, answerOf(fsh === undefined ? "rename" : fsh(m)));
  return hitsIn(f, parsed, src, answers);
}

const answerOf = (a: "rename" | "ambiguous" | undefined): string => (a === undefined ? "keep" : a);

// The relative `.ts` imports and re-exports A10 looks at, by their specifiers.
function tsImports(f: Ref<File>): string[] {
  let found: string[] = [];
  for (const n of f.order) {
    const x: Ref<Item> = f.items[n]!;
    const module = x.module;
    if ((x.kind === "import" || x.kind === "exportAll" || x.kind === "exportNamed") && module !== undefined && /^\.\.?\/.*\.ts$/.test(module) && !module.endsWith(".d.ts") && !x.attributes) found.push(module);
  }
  return found;
}

// The hits of `migrations`, with what each relative `.ts` import is to become in `answers`.
function hitsIn(f: Ref<File>, parsed: Ref<Parsed>, src: string, answers: Ref<Map<string, string>>): Hit[] {
  const dictionary = new Dictionaries(f);
  let hits = rejectsIn(f, dictionary);
  append(hits, autoFixes(f, answers));
  append(hits, guided(f));
  append(hits, markers(src, parsed.comments));
  for (let i: usize = 0; i < hits.length; i++) {
    const edits: Ref<Edit[] | undefined> = hits[i]!.edits;
    if (edits === undefined || !edits.some((e) => parsed.comments.some((c) => c.start >= e.start && c.end <= e.end))) continue;
    const message = hits[i]!.message;
    hits[i]!.edits = undefined;
    hits[i]!.message = `a comment sits where this change would go, so it can't be made automatically; make it by hand: ${message === undefined ? "" : message}`;
  }
  return hits;
}

function append(to: Mut<Hit[]>, more: Hit[]) {
  let rest = more;
  while (rest.length > 0) to.push(rest.shift()!);
}

// The hits `fishc survey` counts: the reject and guided rules, and A1, A3 and A8 wherever they
// occur, fixable or not, without working out any edits.
export function surveyHits(program: Ref<Stmt[]>): Hit[] {
  const tokens: Token[] = [];
  // The guided rules read no text or tokens.
  const f = fileOf(program, "", tokens);
  const ambient = ambientNodes(f);
  let hits = rejectsIn(f, new Dictionaries(f));
  append(hits, guided(f));
  for (const n of f.order) {
    const x: Ref<Item> = f.items[n]!;
    if (x.kind === "let" && x.keyword === "var" && !ambient.has(n)) hits.push({ rule: "A1", action: "auto", start: x.start, end: x.end });
    if (x.kind === "binary" && (x.op === "==" || x.op === "!=")) hits.push({ rule: "A3", action: "auto", start: x.start, end: x.end });
    if (jsonCast(f, n)) hits.push({ rule: "A8", action: "auto", start: x.start, end: x.end });
  }
  return hits;
}

// The nodes inside `declare`, where nothing runs.
function ambientNodes(f: Ref<File>): Set<usize> {
  let ambient = new Set<usize>();
  for (const n of f.order) {
    const body = f.items[n]!.body;
    if (f.items[n]!.kind !== "declare" || body === undefined) continue;
    for (const x of nodesUnder(f, body)) ambient.add(x);
  }
  return ambient;
}

// The reject rules' hits in a file's tree, in no particular order.
export function rejects(program: Ref<Stmt[]>): Hit[] {
  const tokens: Token[] = [];
  return rejectsIn(fileOf(program, "", tokens), undefined);
}

// A node of the parsed tree as the rules read it: every node of every syntax category, and every
// object holding nodes without being one, such as a parameter or a declarator, whose `kind` is
// empty. Fields naming other nodes give their places in `File.items`, which lists the tree in
// order, each before the nodes it holds; a field a node doesn't have is undefined, or empty.
type Item = {
  of: string; kind: string; id: usize; start: usize; end: usize;
  // What holds the item, under which field, and the span of the statement list it sits in, if any.
  parent: usize | undefined; key: string; listed: boolean; listStart: usize; listEnd: usize;
  // Where the items the item holds end.
  last: usize;
  // A name written as a name, a computed name's expression, and an object literal member's key.
  name: string | undefined; nameExpr: usize | undefined; propKey: string | undefined;
  op: string; keyword: string; module: string | undefined;
  // The names an import binds, or an `export { ... }` lists.
  names: string[];
  generator: boolean; async: boolean; optional: boolean; rest: boolean; quoted: boolean; global: boolean;
  readonly: boolean; macro: boolean; attributes: boolean; hasDefault: boolean; isStatic: boolean;
  modifiers: boolean; promised: boolean; hasBody: boolean; exprs: usize;
  callee: usize | undefined; object: usize | undefined; operand: usize | undefined; left: usize | undefined;
  right: usize | undefined; target: usize | undefined; value: usize | undefined; init: usize | undefined;
  type: usize | undefined; expr: usize | undefined; index: usize | undefined; pattern: usize | undefined;
  param: usize | undefined; returnType: usize | undefined; extends: usize | undefined;
  declaration: usize | undefined; body: usize | undefined;
  args: usize[]; params: usize[]; typeParams: usize[]; members: usize[]; props: usize[]; types: usize[];
  elements: usize[]; declarations: usize[]; decorators: usize[]; implements: usize[]; typeArgs: usize[];
  // A function's body: its statements, or the expression an arrow function gives.
  bodyItems: usize[];
  kids: usize[];
};

// A file as the rules read it: its text and tokens, its tree, and, by name, its identifiers, its
// declarations of variables, functions and classes, and its calls of a name, each list in source
// order. `order` is every node, `top` the file's statements, `lists` every statement list a node
// holds, the file's first, and `bound` how many times the file binds each name.
type File = {
  src: string; tokens: Token[]; items: Item[]; order: usize[]; top: usize[]; lists: usize[][];
  bound: Map<string, usize>; idents: Map<string, usize[]>; lets: Map<string, usize[]>; calls: Map<string, usize[]>;
};
type Span = { start: usize; end: usize };
type Link = { parent: usize; key: string; listed: boolean; listStart: usize; listEnd: usize };

function blank(of: string, kind: string, id: usize, start: usize, end: usize): Item {
  return {
    of, kind, id, start, end, parent: undefined, key: "", listed: false, listStart: 0, listEnd: 0, last: 0,
    name: undefined, nameExpr: undefined, propKey: undefined, op: "", keyword: "", module: undefined, names: [],
    generator: false, async: false, optional: false, rest: false, quoted: false, global: false, readonly: false,
    macro: false, attributes: false, hasDefault: false, isStatic: false, modifiers: false, promised: false, hasBody: false, exprs: 0,
    callee: undefined, object: undefined, operand: undefined, left: undefined, right: undefined, target: undefined,
    value: undefined, init: undefined, type: undefined, expr: undefined, index: undefined, pattern: undefined,
    param: undefined, returnType: undefined, extends: undefined, declaration: undefined, body: undefined,
    args: [], params: [], typeParams: [], members: [], props: [], types: [], elements: [], declarations: [],
    decorators: [], implements: [], typeArgs: [], bodyItems: [], kids: [],
  };
}

const isPromise = (t: Ref<TypeNode | undefined>): boolean => t !== undefined && t.kind === "ref" && t.name === "Promise";
const idOf = (t: Ref<TypeNode | undefined>): usize | undefined => (t === undefined ? undefined : t.id);
const exprId = (e: Ref<Expr | undefined>): usize | undefined => (e === undefined ? undefined : e.id);
const stmtIds = (body: Ref<Stmt[] | undefined>): usize[] => (body === undefined ? [] : body.map((s) => s.id));

// What reading a file's tree has gathered so far: its items, each node id's place among them,
// what holds each node not yet read, and the statement lists each node holds.
type Reading = { items: Item[]; index: Map<usize, usize>; links: Map<usize, Link>; held: { holder: usize; ids: usize[] }[] };

// Reads `n` and the nodes under it into `r`, each before those it holds. It recurses as deep as the
// tree, which is no deeper than the parser's own recursion that built it.
function read(n: AnyNode, r: Mut<Reading>): void {
  if (n.of === "stmts") {
    forEachChild(n, (c) => read(c, r));
    return;
  }
  let it = itemOf(reborrowNode(n));
  const i = r.items.length;
  r.index.set(it.id, i);
  const link = r.links.get(it.id);
  if (link !== undefined) {
    it.parent = link.parent;
    it.key = link.key;
    it.listed = link.listed;
    it.listStart = link.listStart;
    it.listEnd = link.listEnd;
  }
  let lists: usize[][] = [];
  const keys = keysIn(it);
  forEachChild(reborrowNode(n), (c) => {
    if (c.of === "stmts") {
      const list = c.node;
      let ids: usize[] = [];
      for (const s of list) {
        ids.push(s.id);
        it.kids.push(s.id);
        r.links.set(s.id, { parent: i, key: "", listed: true, listStart: list[0]!.start, listEnd: list[list.length - 1]!.end });
      }
      lists.push(ids);
      return;
    }
    const id = nodeIdOf(c);
    if (id < 0) return;
    it.kids.push(id as usize);
    r.links.set(id as usize, { parent: i, key: keyOf(keys, id as usize), listed: false, listStart: 0, listEnd: 0 });
  });
  // Only a node's own statement lists can merge declarations; a `case`'s belong to no node.
  if (it.kind !== "") while (lists.length > 0) r.held.push({ holder: i, ids: lists.shift()! });
  r.items.push(it);
  forEachChild(n, (c) => read(c, r));
}

// The file's tree, read once.
function fileOf(program: Ref<Stmt[]>, src: string, tokens: Ref<Token[]>): File {
  let r: Reading = { items: [], index: new Map<usize, usize>(), links: new Map<usize, Link>(), held: [] };
  read({ of: "stmts", node: program }, r);
  let items = r.items;
  const index = r.index;
  let held = r.held;
  for (let i: usize = 0; i < items.length; i++) resolveIds(items[i]!, index);
  for (let i = items.length; i > 0; i--) {
    const at = i - 1;
    if (items[at]!.last < at + 1) items[at]!.last = at + 1;
    const p = items[at]!.parent;
    if (p !== undefined && items[p]!.last < items[at]!.last) items[p]!.last = items[at]!.last;
  }
  let top: usize[] = [];
  for (const s of program) {
    const at = index.get(s.id);
    if (at !== undefined) top.push(at);
  }
  // The order the rules meet the nodes in: each node before those it holds, taken from the last
  // to the first.
  let order: usize[] = [];
  let stack: usize[] = [...top];
  while (stack.length > 0) {
    const at = stack.pop()!;
    if (items[at]!.kind !== "") order.push(at);
    for (const k of items[at]!.kids) stack.push(k);
  }
  let position = new Map<usize, usize>();
  for (const [p, at] of order.entries()) position.set(at, p as usize);
  held.sort((a, b) => {
    const x = position.get(a.holder);
    const y = position.get(b.holder);
    const pa = x === undefined ? 0 : x;
    const pb = y === undefined ? 0 : y;
    return pa < pb ? -1 : pa > pb ? 1 : 0;
  });
  let lists: usize[][] = [[...top]];
  for (const h of held) {
    let list: usize[] = [];
    for (const id of h.ids) {
      const at = index.get(id);
      if (at !== undefined) list.push(at);
    }
    lists.push(list);
  }
  let f: File = { src, tokens: tokens.slice(), items, order, top, lists, bound: new Map<string, usize>(), idents: new Map<string, usize[]>(), lets: new Map<string, usize[]>(), calls: new Map<string, usize[]>() };
  f.bound = bindings(f);
  byName(f);
  return f;
}

// The field of `it` each child is under, for the fields the rules ask about, by the child's id.
function keysIn(it: Ref<Item>): Map<usize, string> {
  let keys = new Map<usize, string>();
  for (const id of it.implements) keys.set(id, "implements");
  for (const id of it.elements) keys.set(id, "elements");
  for (const id of it.args) keys.set(id, "args");
  const single: [usize | undefined, string][] = [[it.index, "index"], [it.right, "right"], [it.left, "left"], [it.operand, "operand"], [it.object, "object"], [it.init, "init"], [it.value, "value"], [it.target, "target"], [it.callee, "callee"]];
  for (const [id, key] of single) if (id !== undefined) keys.set(id, key);
  return keys;
}

function keyOf(keys: Ref<Map<usize, string>>, id: usize): string {
  const key = keys.get(id);
  return key === undefined ? "" : key;
}

const placeOf = (index: Ref<Map<usize, usize>>, id: usize | undefined): usize | undefined => (id === undefined ? undefined : index.get(id));

function placesOf(index: Ref<Map<usize, usize>>, ids: Ref<usize[]>): usize[] {
  let out: usize[] = [];
  for (const id of ids) {
    const at = index.get(id);
    if (at !== undefined) out.push(at);
  }
  return out;
}

// Turns the node ids `itemOf` gave into places in the file's items.
function resolveIds(it: Mut<Item>, index: Ref<Map<usize, usize>>) {
  it.nameExpr = placeOf(index, it.nameExpr);
  it.callee = placeOf(index, it.callee);
  it.object = placeOf(index, it.object);
  it.operand = placeOf(index, it.operand);
  it.left = placeOf(index, it.left);
  it.right = placeOf(index, it.right);
  it.target = placeOf(index, it.target);
  it.value = placeOf(index, it.value);
  it.init = placeOf(index, it.init);
  it.type = placeOf(index, it.type);
  it.expr = placeOf(index, it.expr);
  it.index = placeOf(index, it.index);
  it.pattern = placeOf(index, it.pattern);
  it.param = placeOf(index, it.param);
  it.returnType = placeOf(index, it.returnType);
  it.extends = placeOf(index, it.extends);
  it.declaration = placeOf(index, it.declaration);
  it.body = placeOf(index, it.body);
  it.args = placesOf(index, it.args);
  it.params = placesOf(index, it.params);
  it.typeParams = placesOf(index, it.typeParams);
  it.members = placesOf(index, it.members);
  it.props = placesOf(index, it.props);
  it.types = placesOf(index, it.types);
  it.elements = placesOf(index, it.elements);
  it.declarations = placesOf(index, it.declarations);
  it.decorators = placesOf(index, it.decorators);
  it.implements = placesOf(index, it.implements);
  it.typeArgs = placesOf(index, it.typeArgs);
  it.bodyItems = placesOf(index, it.bodyItems);
  it.kids = placesOf(index, it.kids);
}

// One node's item, its fields naming other nodes by their ids.
function itemOf(n: AnyNode): Item {
  if (n.of === "expr") return exprItem(n.node);
  if (n.of === "stmt") return stmtItem(n.node);
  if (n.of === "typeNode") return typeItem(n.node);
  if (n.of === "typeMember") {
    const m = n.node;
    let it = blank("typeMember", m.kind, m.id, m.start, m.end);
    if (m.kind === "property") {
      if (typeof m.name === "string") it.name = m.name;
      else it.nameExpr = m.name.id;
      it.optional = m.optional;
      it.readonly = m.readonly;
      it.type = idOf(m.type);
    } else if (m.kind === "method") {
      if (typeof m.name === "string") it.name = m.name;
      else it.nameExpr = m.name.id;
      it.optional = m.optional;
      it.typeParams = m.typeParams.map((p) => p.id);
      it.params = m.params.map((p) => p.id);
      it.promised = isPromise(m.returns);
    } else if (m.kind === "call" || m.kind === "construct") {
      it.typeParams = m.typeParams.map((p) => p.id);
      it.params = m.params.map((p) => p.id);
      it.promised = isPromise(m.returns);
    } else if (m.kind === "index") {
      it.readonly = m.readonly;
      it.params = m.params.map((p) => p.id);
      it.type = m.type.id;
    } else if (m.kind === "get" || m.kind === "set") {
      if (typeof m.name === "string") it.name = m.name;
      else it.nameExpr = m.name.id;
      it.params = m.params.map((p) => p.id);
      it.promised = isPromise(m.returns);
    }
    return it;
  }
  if (n.of === "objectProp") {
    const p = n.node;
    let it = blank("objectProp", p.kind, p.id, p.start, p.end);
    if (p.kind === "property") {
      if (typeof p.key === "string") it.propKey = p.key;
      it.value = p.value.id;
    } else if (p.kind === "shorthand") {
      it.name = p.name;
    } else if (p.kind === "spread") {
      it.value = p.value.id;
    } else if (p.kind === "method") {
      if (typeof p.key === "string") it.propKey = p.key;
      it.async = p.async;
      it.generator = p.generator;
      it.typeParams = p.typeParams.map((x) => x.id);
      it.params = p.params.map((x) => x.id);
      it.returnType = idOf(p.returnType);
      it.hasBody = true;
      it.bodyItems = stmtIds(p.body);
      it.promised = !p.generator && (p.async || isPromise(p.returnType));
    } else {
      if (typeof p.key === "string") it.propKey = p.key;
      it.params = p.params.map((x) => x.id);
      it.returnType = idOf(p.returnType);
      it.hasBody = true;
      it.bodyItems = stmtIds(p.body);
      it.promised = isPromise(p.returnType);
    }
    return it;
  }
  if (n.of === "classMember") {
    const m = n.node;
    let it = blank("classMember", m.kind, m.id, m.start, m.end);
    it.modifiers = true;
    it.isStatic = m.modifiers.includes("static");
    it.decorators = m.decorators.map((d) => d.id);
    const async = m.modifiers.includes("async");
    it.promised = async;
    if (m.kind === "field") {
      if (typeof m.name === "string") it.name = m.name;
      else it.nameExpr = m.name.id;
      it.optional = m.optional;
      it.type = idOf(m.type);
      it.init = exprId(m.init);
    } else if (m.kind === "method") {
      if (typeof m.name === "string") it.name = m.name;
      else it.nameExpr = m.name.id;
      it.optional = m.optional;
      it.generator = m.generator;
      it.typeParams = m.typeParams.map((p) => p.id);
      it.params = m.params.map((p) => p.id);
      it.returnType = idOf(m.returnType);
      it.hasBody = m.body !== undefined;
      it.bodyItems = stmtIds(m.body);
      it.promised = !m.generator && (async || isPromise(m.returnType));
    } else if (m.kind === "constructor") {
      it.params = m.params.map((p) => p.id);
      it.hasBody = m.body !== undefined;
      it.bodyItems = stmtIds(m.body);
    } else if (m.kind === "get" || m.kind === "set") {
      if (typeof m.name === "string") it.name = m.name;
      else it.nameExpr = m.name.id;
      it.params = m.params.map((p) => p.id);
      it.returnType = idOf(m.returnType);
      it.hasBody = m.body !== undefined;
      it.bodyItems = stmtIds(m.body);
      it.promised = async || isPromise(m.returnType);
    } else if (m.kind === "index") {
      it.params = m.params.map((p) => p.id);
      it.type = m.type.id;
    } else {
      it.hasBody = true;
      it.bodyItems = stmtIds(m.body);
    }
    return it;
  }
  if (n.of === "param") {
    const p = n.node;
    let it = blank("param", "", p.id, p.start, p.end);
    it.pattern = p.pattern.id;
    it.type = idOf(p.type);
    it.optional = p.optional;
    it.rest = p.rest;
    it.hasDefault = p.default !== undefined;
    it.modifiers = true;
    return it;
  }
  if (n.of === "pattern") {
    const p = n.node;
    let it = blank("pattern", p.kind, p.id, p.start, p.end);
    if (p.kind === "ident" || p.kind === "variant") it.name = p.name;
    else if (p.kind === "object") it.props = p.props.map((x) => x.id);
    else if (p.kind === "default") {
      it.target = p.target.id;
      it.value = p.value.id;
    } else if (p.kind === "expr") it.expr = p.expr.id;
    return it;
  }
  if (n.of === "declarator") {
    const d = n.node;
    let it = blank("declarator", "", d.id, d.start, d.end);
    it.target = d.target.id;
    it.type = idOf(d.type);
    it.init = exprId(d.init);
    return it;
  }
  if (n.of === "typeParam") {
    let it = blank("typeParam", "", n.node.id, n.node.start, n.node.end);
    it.name = n.node.name;
    return it;
  }
  if (n.of === "enumMember") {
    let it = blank("enumMember", "", n.node.id, n.node.start, n.node.end);
    it.init = exprId(n.node.init);
    return it;
  }
  if (n.of === "typeAlias") return aliasItem("typeAlias", n.node.id, n.node.start, n.node.end, n.node.name, n.node.typeParams.map((p) => p.id), n.node.type.id);
  if (n.of === "interface") {
    let it = blank("interface", "interface", n.node.id, n.node.start, n.node.end);
    it.name = n.node.name;
    it.typeParams = n.node.typeParams.map((p) => p.id);
    it.members = n.node.members.map((m) => m.id);
    return it;
  }
  if (n.of === "func") {
    const fn = n.node;
    let it = blank("func", "function", fn.id, fn.start, fn.end);
    it.name = fn.name;
    it.macro = true;
    it.async = fn.async;
    it.generator = fn.generator;
    it.typeParams = fn.typeParams.map((p) => p.id);
    it.params = fn.params.map((p) => p.id);
    it.returnType = idOf(fn.returnType);
    it.hasBody = fn.body !== undefined;
    it.bodyItems = stmtIds(fn.body);
    it.promised = !fn.generator && (fn.async || isPromise(fn.returnType));
    return it;
  }
  if (n.of === "tupleElement" || n.of === "matchArm" || n.of === "patternProp" || n.of === "specifier" || n.of === "switchCase" || n.of === "classNode") {
    const id = nodeIdOf(n);
    return blank(n.of, "", id < 0 ? 0 : (id as usize), 0, 0);
  }
  return blank(n.of, "", 0, 0, 0);
}

function aliasItem(of: string, id: usize, start: usize, end: usize, name: string, typeParams: usize[], type: usize): Item {
  let it = blank(of, "typeAlias", id, start, end);
  it.name = name;
  it.typeParams = typeParams;
  it.type = type;
  return it;
}

function typeItem(t: Ref<TypeNode>): Item {
  let it = blank("typeNode", t.kind, t.id, t.start, t.end);
  if (t.kind === "ref") {
    it.name = t.name;
    it.args = t.args.map((a) => a.id);
  } else if (t.kind === "object") {
    it.members = t.members.map((m) => m.id);
  } else if (t.kind === "function") {
    it.typeParams = t.typeParams.map((p) => p.id);
    it.params = t.params.map((p) => p.id);
    it.promised = isPromise(t.returns);
  } else if (t.kind === "union" || t.kind === "intersection") {
    it.types = t.types.map((x) => x.id);
  } else if (t.kind === "operator") {
    it.op = t.op;
    it.type = t.type.id;
  } else if (t.kind === "import") {
    it.module = t.module;
    it.name = t.name;
    it.args = t.args.map((a) => a.id);
  } else if (t.kind === "infer" || t.kind === "mapped") {
    it.name = t.name;
  } else if (t.kind === "predicate") {
    it.name = t.name;
    it.type = idOf(t.type);
  }
  return it;
}

function exprItem(e: Ref<Expr>): Item {
  let it = blank("expr", e.kind, e.id, e.start, e.end);
  if (e.kind === "template") {
    it.exprs = e.exprs.length;
  } else if (e.kind === "ident" || e.kind === "privateName" || e.kind === "meta") {
    it.name = e.name;
  } else if (e.kind === "spread" || e.kind === "throw" || e.kind === "pipe") {
    it.value = e.value.id;
  } else if (e.kind === "yield") {
    it.value = exprId(e.value);
  } else if (e.kind === "array") {
    for (const x of e.elements) if (x !== undefined) it.elements.push(x.id);
  } else if (e.kind === "object") {
    it.props = e.props.map((p) => p.id);
  } else if (e.kind === "function") {
    it.name = e.name;
    it.async = e.async;
    it.generator = e.generator;
    it.typeParams = e.typeParams.map((p) => p.id);
    it.params = e.params.map((p) => p.id);
    it.returnType = idOf(e.returnType);
    it.hasBody = true;
    it.bodyItems = stmtIds(e.body);
    it.promised = !e.generator && (e.async || isPromise(e.returnType));
  } else if (e.kind === "arrow") {
    it.async = e.async;
    it.typeParams = e.typeParams.map((p) => p.id);
    it.params = e.params.map((p) => p.id);
    it.returnType = idOf(e.returnType);
    it.hasBody = true;
    const body: Ref<Stmt[] | Expr> = e.body;
  if (Array.isArray(body)) it.bodyItems = stmtIds(body);
    else it.bodyItems = [body.id];
    it.promised = e.async || isPromise(e.returnType);
  } else if (e.kind === "member") {
    it.object = e.object.id;
    it.name = e.name;
  } else if (e.kind === "index") {
    it.object = e.object.id;
    it.index = e.index.id;
  } else if (e.kind === "call") {
    it.callee = e.callee.id;
    it.typeArgs = e.typeArgs.map((t) => t.id);
    it.args = e.args.map((a) => a.id);
  } else if (e.kind === "new") {
    it.callee = e.callee.id;
    it.typeArgs = e.typeArgs.map((t) => t.id);
  if (e.args !== undefined) it.args = e.args.map((a) => a.id);
  } else if (e.kind === "instantiation" || e.kind === "nonNull" || e.kind === "comptime" || e.kind === "unsafe") {
    it.expr = e.expr.id;
  } else if (e.kind === "import") {
    it.args = e.args.map((a) => a.id);
  } else if (e.kind === "class") {
    it.name = e.name;
    it.decorators = e.decorators.map((d) => d.id);
    it.typeParams = e.typeParams.map((p) => p.id);
    it.extends = exprId(e.extends);
    it.implements = e.implements.map((t) => t.id);
    it.members = e.members.map((m) => m.id);
  } else if (e.kind === "unary" || e.kind === "update") {
    it.op = e.op;
    it.operand = e.operand.id;
  } else if (e.kind === "binary") {
    it.op = e.op;
    it.left = e.left.id;
    it.right = e.right.id;
  } else if (e.kind === "assign") {
    it.op = e.op;
    it.target = e.target.id;
    it.value = e.value.id;
  } else if (e.kind === "destructure") {
    it.pattern = e.pattern.id;
    it.value = e.value.id;
  } else if (e.kind === "as" || e.kind === "satisfies" || e.kind === "assertion") {
    it.expr = e.expr.id;
    it.type = e.type.id;
  }
  return it;
}

function stmtItem(s: Ref<Stmt>): Item {
  let it = blank("stmt", s.kind, s.id, s.start, s.end);
  if (s.kind === "expr") {
    it.expr = s.expr.id;
  } else if (s.kind === "let") {
    it.keyword = s.keyword;
    it.declarations = s.declarations.map((d) => d.id);
  } else if (s.kind === "return") {
    it.value = exprId(s.value);
  } else if (s.kind === "throw" || s.kind === "exportAssign") {
    it.value = s.value.id;
  } else if (s.kind === "try") {
  if (s.param !== undefined) it.param = s.param.id;
  } else if (s.kind === "forIn" || s.kind === "forOf") {
    it.left = s.left.id;
    it.right = s.right.id;
  } else if (s.kind === "enum") {
    it.name = s.name;
    it.typeParams = s.typeParams.map((p) => p.id);
  } else if (s.kind === "namespace") {
    it.name = s.name;
    it.quoted = s.quoted;
    it.global = s.global;
  } else if (s.kind === "declare" || s.kind === "export" || s.kind === "labeled") {
    it.body = s.body.id;
  } else if (s.kind === "import") {
    it.module = s.module;
    it.attributes = s.attributes !== undefined;
    const d = s.default;
  if (d !== undefined) it.names.push(d);
    const ns = s.namespace;
  if (ns !== undefined) it.names.push(ns);
    const named: Ref<Specifier[] | undefined> = s.named;
  if (named !== undefined) for (const sp of named) it.names.push(sp.alias !== undefined ? sp.alias : sp.name);
  } else if (s.kind === "importEquals" || s.kind === "exportAsNamespace") {
    it.name = s.name;
  } else if (s.kind === "exportDefault") {
  if (s.declaration !== undefined) it.declaration = s.declaration.id;
    it.value = exprId(s.value);
  } else if (s.kind === "exportNamed") {
    it.module = s.module;
    for (const sp of s.specifiers) it.names.push(sp.name);
  } else if (s.kind === "exportAll") {
    it.module = s.module;
  } else if (s.kind === "typeAlias") {
    it.name = s.name;
    it.typeParams = s.typeParams.map((p) => p.id);
    it.type = s.type.id;
  } else if (s.kind === "interface") {
    it.name = s.name;
    it.typeParams = s.typeParams.map((p) => p.id);
    it.members = s.members.map((m) => m.id);
  } else if (s.kind === "function") {
    it.name = s.name;
    it.macro = true;
    it.async = s.async;
    it.generator = s.generator;
    it.typeParams = s.typeParams.map((p) => p.id);
    it.params = s.params.map((p) => p.id);
    it.returnType = idOf(s.returnType);
    it.hasBody = s.body !== undefined;
    it.bodyItems = stmtIds(s.body);
    it.promised = !s.generator && (s.async || isPromise(s.returnType));
  } else if (s.kind === "class") {
    it.name = s.name;
    it.decorators = s.decorators.map((d) => d.id);
    it.typeParams = s.typeParams.map((p) => p.id);
    it.extends = exprId(s.extends);
    it.implements = s.implements.map((t) => t.id);
    it.members = s.members.map((m) => m.id);
  }
  return it;
}

const kindAt = (f: Ref<File>, i: usize | undefined): string => (i === undefined ? "" : f.items[i]!.kind);
const nameAt = (f: Ref<File>, i: usize | undefined): string | undefined => (i === undefined ? undefined : f.items[i]!.name);
// Whether the item at `i` is the identifier `name`.
const named = (f: Ref<File>, i: usize | undefined, name: string): boolean => i !== undefined && f.items[i]!.kind === "ident" && f.items[i]!.name === name;
const isFunction = (kind: string) => kind === "function" || kind === "arrow" || kind === "method" || kind === "get" || kind === "set" || kind === "constructor";
const spanOf = (f: Ref<File>, i: usize): Span => ({ start: f.items[i]!.start, end: f.items[i]!.end });

// The nodes under the item at `i`, itself included, in the tree's order.
function nodesUnder(f: Ref<File>, i: usize): usize[] {
  let found: usize[] = [];
  for (let j = i; j < f.items[i]!.last; j++) if (f.items[j]!.kind !== "") found.push(j);
  return found;
}

// The nodes of a function's body.
function bodyNodes(f: Ref<File>, n: usize): usize[] {
  let found: usize[] = [];
  for (const b of f.items[n]!.bodyItems) for (const x of nodesUnder(f, b)) found.push(x);
  return found;
}

// Whether a node under the item at `i` is an identifier named one of `names`.
function bindsAny(f: Ref<File>, i: usize | undefined, names: Ref<Set<string>>): boolean {
  if (i === undefined) return false;
  for (let j = i; j < f.items[i]!.last; j++) {
    const name = f.items[j]!.name;
    if (f.items[j]!.kind === "ident" && name !== undefined && names.has(name)) return true;
  }
  return false;
}

// The identifiers and shorthand properties under the item at `i`, by name.
function identNames(f: Ref<File>, i: usize | undefined, shorthand: boolean): string[] {
  let found: string[] = [];
  if (i === undefined) return found;
  for (let j = i; j < f.items[i]!.last; j++) {
    const name = f.items[j]!.name;
    if (name !== undefined && (f.items[j]!.kind === "ident" || (shorthand && f.items[j]!.kind === "shorthand"))) found.push(name);
  }
  return found;
}

// The reject rules' hits, in no particular order. `dictionary` says which expressions are
// dictionaries, whose keys a `delete` may remove; without one, none is.
function rejectsIn(f: Ref<File>, dictionary: Ref<Dictionaries> | undefined): Hit[] {
  // A class with its own member named `prototype` reads it as a field, not the JS prototype.
  let ownPrototype = new Set<string>();
  // `Symbol.iterator` as a method's key, or read as `x[Symbol.iterator]`, names an iterable's method.
  let iterating = new Set<usize>();
  for (const n of f.order) {
    const x: Ref<Item> = f.items[n]!;
    const name = x.name;
    if (x.kind === "class" && name !== undefined && x.members.some((m) => OWN_MEMBERS.has(f.items[m]!.kind) && f.items[m]!.name === "prototype")) ownPrototype.add(name);
    const key = x.kind === "method" ? x.nameExpr : x.kind === "index" ? x.index : undefined;
    if (key !== undefined && f.items[key]!.kind === "member" && f.items[key]!.name === "iterator" && named(f, f.items[key]!.object, "Symbol")) iterating.add(f.items[key]!.object!);
  }
  let hits: Hit[] = [];
  for (const n of f.order) {
    const x: Ref<Item> = f.items[n]!;
    const callee = x.callee;
    if (x.kind === "call" && callee !== undefined && (named(f, callee, "eval") || named(f, callee, "Function"))) hits.push({ rule: "R1", action: "reject", start: f.items[callee]!.start, end: f.items[callee]!.end });
    if (x.kind === "new" && callee !== undefined && named(f, callee, "Function")) hits.push({ rule: "R1", action: "reject", start: x.start, end: f.items[callee]!.end });
    if (x.kind === "member" && x.name === "prototype") {
      const object = x.object;
      const own = object !== undefined && f.items[object]!.kind === "ident" && ownPrototype.has(nameAt(f, object)!);
      if (!own) hits.push({ rule: "R2", action: "reject", start: x.start, end: x.end });
    }
    if (x.kind === "call" && callee !== undefined && f.items[callee]!.kind === "member" && named(f, f.items[callee]!.object, "Object")) {
      const method = nameAt(f, callee);
      if (method !== undefined && (method === "defineProperty" || method === "defineProperties" || method === "setPrototypeOf")) hits.push({ rule: "R2", action: "reject", start: f.items[callee]!.end - method.length, end: f.items[callee]!.end });
    }
    if (x.kind === "unary" && x.op === "delete") {
      const operand = x.operand;
      const keyed = operand !== undefined && (f.items[operand]!.kind === "index" || f.items[operand]!.kind === "member") && dictionary !== undefined && dictionary.has(f, f.items[operand]!.object);
      if (!keyed) hits.push({ rule: "R3", action: "reject", start: x.start, end: x.end });
    }
    const use = x.kind === "ident" || x.kind === "shorthand" || x.kind === "ref" ? x.name : undefined;
    if (use === "arguments" && x.kind !== "ref" && !f.bound.has("arguments")) hits.push({ rule: "R5", action: "reject", start: x.start, end: x.end });
    if (use === "Symbol" && !f.bound.has("Symbol") && !iterating.has(n)) hits.push({ rule: "R6", action: "reject", start: x.start, end: x.end });
    if (x.kind === "namespace" && (x.quoted || x.global)) hits.push({ rule: "R7", action: "reject", start: x.start, end: x.end });
  }
  for (const list of f.lists) merged(f, list, hits);
  return hits;
}

function byName(f: Mut<File>) {
  let identPairs: Pairs = { names: [], at: [] };
  let letPairs: Pairs = { names: [], at: [] };
  let callPairs: Pairs = { names: [], at: [] };
  for (const n of f.order) {
    const x: Ref<Item> = f.items[n]!;
    const name = x.name;
    if (x.kind === "ident" && name !== undefined) addTo(identPairs, name, n);
    const callee = x.callee;
    if (x.kind === "call" && callee !== undefined && f.items[callee]!.kind === "ident") addTo(callPairs, nameAt(f, callee)!, n);
    if (x.kind === "let") for (const d of x.declarations) for (const target of identNames(f, f.items[d]!.target, false)) addTo(letPairs, target, n);
    // A function or class declared by name is a declaration of that name too.
    if (((x.kind === "function" && x.macro) || x.kind === "class") && name !== undefined) addTo(letPairs, name, n);
  }
  let idents = grouped(identPairs);
  let lets = grouped(letPairs);
  let calls = grouped(callPairs);
  sortLists(f, idents);
  sortLists(f, lets);
  sortLists(f, calls);
  f.idents = idents;
  f.lets = lets;
  f.calls = calls;
}

// Positions collected by name, grouped once they are all in: a Map's array is copied as it is read
// in Fish, so adding to it one position at a time would copy the whole list each time.
type Pairs = { names: string[]; at: usize[] };

function addTo(pairs: Mut<Pairs>, name: string, n: usize) {
  pairs.names.push(name);
  pairs.at.push(n);
}

// Each name's positions, in the order they were added.
function grouped(pairs: Ref<Pairs>): Map<string, usize[]> {
  let order: usize[] = [];
  for (let i: usize = 0; i < pairs.names.length; i++) order.push(i);
  order.sort((a, b) => (pairs.names[a]! < pairs.names[b]! ? -1 : pairs.names[a]! > pairs.names[b]! ? 1 : (a as i64) - (b as i64)));
  let out = new Map<string, usize[]>();
  let i: usize = 0;
  while (i < order.length) {
    const name = pairs.names[order[i]!]!;
    let list: usize[] = [];
    while (i < order.length && pairs.names[order[i]!]! === name) {
      list.push(pairs.at[order[i]!]!);
      i++;
    }
    out.set(name, list);
  }
  return out;
}

function sortLists(f: Ref<File>, map: Mut<Map<string, usize[]>>) {
  let names: string[] = [...map.keys()];
  for (const name of names) {
    let list = map.get(name);
    if (list === undefined) continue;
    list.sort((a, b) => (f.items[a]!.start < f.items[b]!.start ? -1 : f.items[a]!.start > f.items[b]!.start ? 1 : 0));
    map.set(name, list);
  }
}

// How many times the file binds each name, anywhere: a declaration, a parameter, a caught error or
// an import.
function bindings(f: Ref<File>): Map<string, usize> {
  let names = new Map<string, usize>();
  for (const n of f.order) {
    const x: Ref<Item> = f.items[n]!;
    if (x.kind === "let") for (const d of x.declarations) for (const name of identNames(f, f.items[d]!.target, true)) count(names, name);
    const name = x.name;
    if ((MERGING.has(x.kind) || x.kind === "typeAlias") && name !== undefined) count(names, name);
    for (const p of x.params) for (const bound of identNames(f, f.items[p]!.pattern, true)) count(names, bound);
    for (const p of x.typeParams) count(names, nameAt(f, p)!);
    if (x.kind === "try") for (const bound of identNames(f, x.param, true)) count(names, bound);
    if (x.kind === "import") for (const bound of x.names) count(names, bound);
  }
  return names;
}

function count(names: Mut<Map<string, usize>>, name: string) {
  const had = names.get(name);
  names.set(name, (had === undefined ? 0 : had) + 1);
}

// The declarations in one list of statements that TypeScript would merge with an earlier one of
// the same name, each a hit.
function merged(f: Ref<File>, list: Ref<usize[]>, hits: Mut<Hit[]>) {
  let seen = new Map<string, string[]>();
  for (const s of list) {
    const x: Ref<Item> = f.items[s]!;
    let d: usize = s;
    const body = x.body;
    const declaration = x.declaration;
    if ((x.kind === "export" || x.kind === "declare") && body !== undefined && kindAt(f, body) !== "") d = body;
    else if (x.kind === "exportDefault" && declaration !== undefined && kindAt(f, declaration) !== "") d = declaration;
    const dx: Ref<Item> = f.items[d]!;
    const name = dx.name;
    if (x.kind === "" || dx.kind === "" || !MERGING.has(dx.kind) || name === undefined || dx.quoted || dx.global) continue;
    const had = seen.get(name);
    let before: string[] = had === undefined ? [] : had;
    if (before.some((kind) => merges(kind, dx.kind))) hits.push({ rule: "R7", action: "reject", start: x.start, end: x.end });
    before.push(dx.kind);
    seen.set(name, before);
  }
}

function merges(a: string, b: string): boolean {
  if (a === b) return a === "interface" || a === "namespace" || a === "enum";
  const pair = new Set([a, b]);
  if (pair.has("enum")) return pair.has("namespace");
  const value = (k: string) => k === "class" || k === "function";
  const open = (k: string) => k === "interface" || k === "namespace";
  return (value(a) && open(b)) || (open(a) && value(b));
}

const PRIMITIVES = new Set(["number", "string", "boolean", "bigint", "symbol", "any", "unknown", "never", "void", "null", "undefined", "object", "i8", "i16", "i32", "i64", "u8", "u16", "u32", "u64", "f32", "f64", "isize", "usize"]);
const MUTATORS = new Set(["push", "pop", "shift", "unshift", "splice", "sort", "reverse", "fill", "copyWithin", "set", "delete", "clear", "add"]);
const LOOPS = new Set(["for", "forIn", "forOf", "while", "doWhile"]);
const nullish = (f: Ref<File>, t: usize) => f.items[t]!.kind === "ref" && (f.items[t]!.name === "null" || f.items[t]!.name === "undefined");
const typeName = (f: Ref<File>, t: usize | undefined, name: string) => t !== undefined && f.items[t]!.kind === "ref" && f.items[t]!.name === name;

function jsonCast(f: Ref<File>, n: usize): boolean {
  const x: Ref<Item> = f.items[n]!;
  const call = x.expr;
  if (x.kind !== "as" || call === undefined || f.items[call]!.kind !== "call") return false;
  const callee = f.items[call]!.callee;
  return callee !== undefined && f.items[callee]!.kind === "member" && named(f, f.items[callee]!.object, "JSON") && f.items[callee]!.name === "parse";
}

// The index of the first token starting at or after `at`.
function tokenAt(f: Ref<File>, at: usize): usize {
  let lo: usize = 0;
  let hi = f.tokens.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (f.tokens[mid]!.start < at) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// The first token at or after `at`, and the last one ending at or before it, by index.
function next(f: Ref<File>, at: usize): usize | undefined {
  const i = tokenAt(f, at);
  return i < f.tokens.length ? i : undefined;
}

function previous(f: Ref<File>, at: usize): usize | undefined {
  let i = (tokenAt(f, at) as i64) - 1;
  while (i >= 0 && f.tokens[i as usize]!.end > at) i--;
  return i >= 0 ? (i as usize) : undefined;
}


// A type's span, taken on past the `)` tokens its own tokens leave open: a parenthesized type's
// span stops short of its closing parenthesis.
function closed(f: Ref<File>, start: usize, end: usize): Span {
  let open: i64 = 0;
  let stop = end;
  let i = tokenAt(f, start);
  for (; i < f.tokens.length && f.tokens[i]!.start < end; i++) open += isToken(f.tokens[i]!, "(") ? 1 : isToken(f.tokens[i]!, ")") ? -1 : 0;
  while (open > 0 && i < f.tokens.length && isToken(f.tokens[i]!, ")")) {
    stop = f.tokens[i]!.end;
    i++;
    open--;
  }
  return { start, end: stop };
}

// The span of the type written after the `:` that follows `from`, or undefined when no `:` does;
// `colon` is that token's index.
function annotation(f: Ref<File>, from: usize, type: usize): { colon: usize; type: Span } | undefined {
  const before = previous(f, f.items[type]!.start);
  if (before === undefined || f.tokens[before]!.start < from) return undefined;
  // A parenthesized type's own span starts inside its parentheses, so its first token is the one
  // after the `:`.
  let i = tokenAt(f, from);
  while (i < f.tokens.length && f.tokens[i]!.start < f.items[type]!.start && !isToken(f.tokens[i]!, ":")) i++;
  if (i + 1 >= f.tokens.length || !isToken(f.tokens[i]!, ":")) return undefined;
  return { colon: i, type: closed(f, f.tokens[i + 1]!.start, f.items[type]!.end) };
}

const text = (f: Ref<File>, s: Ref<Span>) => f.src.slice(s.start as i64, s.end as i64);

function autoHit(rule: string, start: usize, end: usize, message: string, edits: Edit[] | undefined): Hit {
  if (edits === undefined) return { rule, action: "auto", start, end, message };
  return { rule, action: "auto", start, end, message, edits };
}

// The auto rules' hits, each with its edits when the fix is certain from the source alone.
function autoFixes(f: Ref<File>, answers: Ref<Map<string, string>>): Hit[] {
  let hits: Hit[] = [];
  const ambient = ambientNodes(f);
  const assigned = assignedNames(f);
  const literals = literalKinds(f, assigned);
  const objects = objectTypes(f);
  const changes = changed(f);
  for (const n of f.order) {
    const x: Ref<Item> = f.items[n]!;
    if (x.kind === "let" && x.keyword === "var" && !ambient.has(n)) hits.push(varHit(f, n, assigned));
    const left = x.left;
    const right = x.right;
    if (x.kind === "binary" && (x.op === "==" || x.op === "!=") && left !== undefined && right !== undefined) {
      const l = evident(f, left, literals);
      const r = evident(f, right, literals);
      let i = tokenAt(f, f.items[left]!.end);
      while (i < f.tokens.length && !isToken(f.tokens[i]!, x.op) && f.tokens[i]!.start < f.items[right]!.start) i++;
      if (l !== undefined && l === r && i < f.tokens.length && isToken(f.tokens[i]!, x.op)) {
        const at = f.tokens[i]!.end;
        hits.push(autoHit("A3", x.start, x.end, `'${x.op}' becomes '${x.op}=', as both sides are ${l === "boolean" ? "booleans" : `${l}s`}`, [{ start: at, end: at, text: "=" }]));
      } else hits.push({ rule: "A3", action: "guided", start: x.start, end: x.end, message: `'${x.op}' converts between types, which Fish doesn't; compare with '${x.op}=' once both sides have the same type` });
    }
    if (jsonCast(f, n)) hits.push(autoHit("A8", x.start, x.end, "'JSON.parse(s) as T' becomes 'JSON.parse<T>(s)', which checks the value as it parses it", jsonEdits(f, n)));
    if (x.kind === "function" && !x.macro && x.hasBody) {
      const edits = arrowEdits(f, n);
      if (edits !== undefined) hits.push(autoHit("A9", x.start, edits[0]!.end, "the function expression becomes an arrow function, as it doesn't use its own 'this'", edits));
    }
    const module = x.module;
    if ((x.kind === "import" || x.kind === "exportAll" || x.kind === "exportNamed") && module !== undefined && /^\.\.?\/.*\.ts$/.test(module) && !module.endsWith(".d.ts") && !x.attributes) {
      const hit = importHit(f, n, module, answers.get(module));
      if (hit !== undefined) hits.push(hit);
    }
    if (x.kind === "union") {
      const hit = optionHit(f, n);
      if (hit !== undefined) hits.push(hit);
    }
    let optionals: { start: usize; type: usize | undefined }[] = [];
    for (const p of x.params) if (f.items[p]!.optional) optionals.push({ start: f.items[p]!.start, type: f.items[p]!.type });
    if ((x.kind === "property" || x.kind === "field") && x.optional) optionals.push({ start: x.start, type: x.type });
    for (const p of optionals) {
      const hit = optionalHit(f, p.start, p.type);
      if (hit !== undefined) hits.push(hit);
    }
    if (isFunction(x.kind) && x.kind !== "constructor" && x.hasBody) append(hits, ownership(f, n, objects, changes.params.get(n)));
    // A class's method has modifiers; an object literal's doesn't, and its `this` is the object.
    if (x.kind === "method" && changes.methods.has(n) && !x.params.some((p) => named(f, f.items[p]!.pattern, "this"))) {
      const hit = receiver(f, n);
      if (hit !== undefined) hits.push(hit);
    }
  }
  append(hits, counters(f));
  return hits;
}

// A8's edits: the type moves from after `as` into the call's type arguments. `as const` names no
// type.
function jsonEdits(f: Ref<File>, n: usize): Edit[] | undefined {
  const call = f.items[n]!.expr!;
  const callee = f.items[call]!.callee!;
  const as = next(f, f.items[call]!.end);
  if (as === undefined || !isToken(f.tokens[as]!, "as")) return undefined;
  const type = next(f, f.tokens[as]!.end);
  if (type === undefined) return undefined;
  const span = closed(f, f.tokens[type]!.start, f.items[f.items[n]!.type!]!.end);
  if (f.items[call]!.typeArgs.length !== 0 || text(f, span) === "const") return undefined;
  const at = f.items[callee]!.end;
  return [{ start: at, end: at, text: `<${text(f, span)}>` }, { start: f.items[call]!.end, end: span.end, text: "" }];
}

// A10: a relative `.ts` import names the file's `.fsh` name instead.
function importHit(f: Ref<File>, n: usize, module: string, target: string | undefined): Hit | undefined {
  const specifier = previous(f, f.items[n]!.end);
  let literal = specifier;
  if (specifier === undefined || f.tokens[specifier]!.kind !== "string") literal = previous(f, specifier === undefined ? 0 : f.tokens[specifier]!.start);
  const fshName = `${module.slice(0, -3)}.fsh`;
  if (target === undefined || target === "keep" || literal === undefined) return undefined;
  const t: Ref<Token> = f.tokens[literal]!;
  if (t.kind !== "string" || t.start < f.items[n]!.start || f.src.slice((t.start + 1) as i64, (t.end - 1) as i64) !== module) return undefined;
  if (target === "rename") return autoHit("A10", t.start, t.end, `'${module}' becomes '${fshName}', the file's Fish name`, [{ start: t.end - 4, end: t.end - 1, text: ".fsh" }]);
  return { rule: "A10", action: "guided", start: t.start, end: t.end, message: `both '${module}' and '${fshName}' are there, so which this imports is yours to choose` };
}

// A2 on an optional parameter or property: the `?` goes, and the type becomes an Option unless it
// is one already.
function optionalHit(f: Ref<File>, start: usize, type: usize | undefined): Hit | undefined {
  if (type === undefined || kindAt(f, type) === "") return undefined;
  const written = annotation(f, start, type);
  if (written === undefined) return undefined;
  const question = previous(f, f.tokens[written.colon]!.start);
  if (question === undefined || !isToken(f.tokens[question]!, "?")) return undefined;
  const t: Ref<Item> = f.items[type]!;
  const wrapped = (t.kind === "union" && t.types.some((m) => nullish(f, m))) || (t.kind === "ref" && t.name === "Option");
  const shown = text(f, written.type);
  const q: Ref<Token> = f.tokens[question]!;
  let edits: Edit[] = [{ start: q.start, end: q.end, text: "" }];
  if (!wrapped) {
    edits.push({ start: written.type.start, end: written.type.start, text: "Option<" });
    edits.push({ start: written.type.end, end: written.type.end, text: ">" });
  }
  return autoHit("A2", q.start, written.type.end, wrapped ? "the '?' goes, as the type's Option says it may be absent" : `the optional '?: ${shown}' becomes ': Option<${shown}>'`, edits);
}

// A1: a `var` becomes `const` when nothing assigns it again, else `let`, but only where `var`'s
// function scoping can't matter; anywhere else it is guided, saying why.
function varHit(f: Ref<File>, n: usize, assigned: Ref<Set<string>>): Hit {
  const x: Ref<Item> = f.items[n]!;
  let names: string[] = [];
  for (const d of x.declarations) for (const name of identNames(f, f.items[d]!.target, false)) names.push(name);
  const why = varScoping(f, n, new Set([...names]));
  const start = x.start;
  const end = x.start + 3;
  if (why !== undefined) return { rule: "A1", action: "guided", start, end, message: `'var' belongs to the whole function, and here that matters: ${why}; rename or move it, then use 'let' or 'const'` };
  const reassigned = x.declarations.some((d) => f.items[d]!.init === undefined) || names.some((name) => assigned.has(name));
  const keyword = reassigned ? "let" : "const";
  return { rule: "A1", action: "auto", start, end, message: `'var' becomes '${keyword}', as ${reassigned ? "it is assigned after its declaration" : "nothing assigns it again"}`, edits: [{ start, end, text: keyword }] };
}

// The nodes holding `n`, innermost first.
function ancestors(f: Ref<File>, n: usize): usize[] {
  let found: usize[] = [];
  let at = f.items[n]!.parent;
  while (at !== undefined) {
    if (f.items[at]!.kind !== "") found.push(at);
    at = f.items[at]!.parent;
  }
  return found;
}

// The innermost function holding `n`.
function functionOf(f: Ref<File>, n: usize): usize | undefined {
  for (const a of ancestors(f, n)) if (isFunction(f.items[a]!.kind)) return a;
  return undefined;
}

const within = (x: Ref<Span>, s: Ref<Span>) => x.start >= s.start && x.end <= s.end;

// The functions between a node and the function `fn`, innermost first.
function between(f: Ref<File>, x: usize, fn: usize | undefined): usize[] {
  let found: usize[] = [];
  for (const a of ancestors(f, x)) {
    if (a === fn) break;
    if (isFunction(f.items[a]!.kind)) found.push(a);
  }
  return found;
}

// Why a `var` can't simply become block scoped, or undefined when it can: declared again in its
// function, used outside its block or before its declaration, or in a loop, where a `let` is a
// new variable each turn, with a value that carries over or a closure capturing it.
function varScoping(f: Ref<File>, n: usize, names: Ref<Set<string>>): string | undefined {
  const x: Ref<Item> = f.items[n]!;
  const chain = ancestors(f, n);
  const fn = functionOf(f, n);
  const scope: Span = fn !== undefined ? spanOf(f, fn) : { start: 0, end: f.src.length };
  // A `let` in a loop's head belongs to the loop; one in a list of statements, to that list, which
  // a `try` or a loop's body is without a node of its own.
  const holder = x.parent;
  let region: Span = { start: scope.start, end: scope.end };
  if (x.listed) region = { start: x.listStart, end: x.listEnd };
  else if (holder !== undefined && kindAt(f, holder) !== "") region = spanOf(f, holder);
  // A declared function's own name belongs to the scope holding it, not to its body.
  let declaredAgain = false;
  for (const name of names) {
    if (inside(f, f.lets.get(name), scope).some((y) => y !== n && y !== fn && functionOf(f, y) === fn)) declaredAgain = true;
  }
  const params: usize[] = fn !== undefined ? [...f.items[fn]!.params] : [];
  if (declaredAgain || params.some((p) => bindsAny(f, f.items[p]!.pattern, names))) return "it is declared again in the same function";
  const targets: usize[] = x.declarations.map((d) => f.items[d]!.target!);
  let uses: usize[] = [];
  for (const name of names) for (const u of inside(f, f.idents.get(name), scope)) if (!targets.some((t) => within(spanOf(f, u), spanOf(f, t)))) uses.push(u);
  if (uses.some((u) => !within(spanOf(f, u), region))) return "it is used outside the block it is declared in";
  if (uses.some((u) => f.items[u]!.start < x.start)) return "it is used before its declaration";
  // A function declared in the scope runs wherever it is called, even before the declaration.
  for (const use of uses) {
    for (const g of between(f, use, fn)) {
      const gname = f.items[g]!.name;
      if (f.items[g]!.kind === "function" && f.items[g]!.macro && gname !== undefined && inside(f, f.calls.get(gname), scope).some((c) => f.items[c]!.start < x.start)) return "a function using it is called before its declaration";
    }
  }
  const stop: i64 = fn !== undefined ? chain.indexOf(fn) : (chain.length as i64);
  const loops = chain.slice(0, stop).filter((l) => LOOPS.has(f.items[l]!.kind));
  if (loops.length === 0) return undefined;
  if (x.declarations.some((d) => f.items[d]!.init === undefined || bindsAny(f, f.items[d]!.init, names))) return "its value carries from one turn of the loop to the next";
  if (uses.some((u) => between(f, u, fn).some((g) => loops.some((l) => within(spanOf(f, g), spanOf(f, l)))))) return "a closure in the loop captures it";
  return undefined;
}

// The nodes of `list`, sorted by where they start, that lie within `span`, found by binary search
// so a check per declaration stays cheap in a large file.
function inside(f: Ref<File>, list: Ref<usize[] | undefined>, span: Ref<Span>): usize[] {
  let found: usize[] = [];
  if (list === undefined) return found;
  let lo: usize = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (f.items[list[mid]!]!.start < span.start) lo = mid + 1;
    else hi = mid;
  }
  for (let i = lo; i < list.length && f.items[list[i]!]!.start < span.end; i++) if (f.items[list[i]!]!.end <= span.end) found.push(list[i]!);
  return found;
}

// A2: a union holding `null` or `undefined` becomes an Option of its other members. Members are
// told apart by the `|` tokens between them, since a parenthesized member's span starts inside
// its parentheses.
function optionHit(f: Ref<File>, n: usize): Hit | undefined {
  const types: Ref<usize[]> = f.items[n]!.types;
  if (!types.some((t) => nullish(f, t)) || types.every((t) => nullish(f, t))) return undefined;
  const whole = closed(f, f.items[n]!.start, f.items[n]!.end);
  const lead = next(f, whole.start);
  if (lead === undefined) return undefined;
  let spans: Span[] = [];
  for (const [at, t] of types.entries()) {
    const i = at as usize;
    // Between a member and the `|` before it there can only be its own opening parentheses.
    let pipe = previous(f, f.items[t]!.start);
    while (pipe !== undefined && isToken(f.tokens[pipe]!, "(")) pipe = previous(f, f.tokens[pipe]!.start);
    let start = whole.start;
    const after = i > 0 ? (pipe === undefined ? undefined : next(f, f.tokens[pipe]!.end)) : isToken(f.tokens[lead]!, "|") ? next(f, f.tokens[lead]!.end) : lead;
    if (after === undefined) return undefined;
    if (i > 0 || isToken(f.tokens[lead]!, "|")) start = f.tokens[after]!.start;
    spans.push({ start, end: i === types.length - 1 ? whole.end : closed(f, start, f.items[t]!.end).end });
  }
  let kept: Span[] = [];
  for (const [i, s] of spans.entries()) if (!nullish(f, types[i as usize]!)) kept.push({ start: s.start, end: s.end });
  const first = kept[0]!.start;
  const last = kept[kept.length - 1]!.end;
  let edits: Edit[] = [{ start: whole.start, end: first, text: "Option<" }];
  // A nullish member between two kept ones goes with the space and `|` before it.
  for (const [at, t] of types.entries()) {
    const i = at as usize;
    if (nullish(f, t) && spans[i]!.start > first && spans[i]!.end < last) edits.push({ start: spans[i - 1]!.end, end: spans[i]!.end, text: "" });
  }
  edits.push({ start: last, end: whole.end, text: ">" });
  const option = `Option<${kept.map((s) => text(f, s)).join(" | ")}>`;
  return { rule: "A2", action: "auto", start: whole.start, end: whole.end, message: `'${text(f, whole)}' becomes '${option}'`, edits };
}


// The names something assigns after their declaration: by `=` and its compound forms, `++` and
// `--`, a destructuring assignment, or a loop head that isn't a declaration.
function assignedNames(f: Ref<File>): Set<string> {
  let names = new Set<string>();
  for (const n of f.order) {
    const x: Ref<Item> = f.items[n]!;
    let targets: usize[] = [];
    if (x.kind === "assign" && x.target !== undefined) targets.push(x.target);
    if (x.kind === "update" && x.operand !== undefined) targets.push(x.operand);
    if (x.kind === "destructure" && x.pattern !== undefined) for (const y of nodesUnder(f, x.pattern)) targets.push(y);
    if ((x.kind === "forOf" || x.kind === "forIn") && x.left !== undefined) targets.push(x.left);
    for (const t of targets) {
      const name = f.items[t]!.name;
      if (f.items[t]!.kind === "ident" && name !== undefined) names.add(name);
    }
  }
  return names;
}

// The kind of literal each name is declared with, for a name the file binds once, without a
// type written, as a `const` or as a variable nothing assigns again.
function literalKinds(f: Ref<File>, assigned: Ref<Set<string>>): Map<string, string> {
  let kinds = new Map<string, string>();
  for (const n of f.order) {
    const x: Ref<Item> = f.items[n]!;
    if (x.kind !== "let") continue;
    for (const d of x.declarations) {
      const target = f.items[d]!.target!;
      const name = f.items[target]!.kind === "ident" ? f.items[target]!.name : undefined;
      const init = f.items[d]!.init;
      if (name === undefined || name === "" || f.items[d]!.type !== undefined || init === undefined || f.bound.get(name) !== 1 || (x.keyword !== "const" && assigned.has(name))) continue;
      const kind = literalKind(f, init);
      if (kind !== undefined) kinds.set(name, kind);
    }
  }
  return kinds;
}

function literalKind(f: Ref<File>, e: usize): string | undefined {
  const x: Ref<Item> = f.items[e]!;
  const operand = kindAt(f, x.operand);
  if (x.kind === "int" || x.kind === "float" || (x.kind === "unary" && x.op === "-" && (operand === "int" || operand === "float"))) return "number";
  if (x.kind === "string" || (x.kind === "template" && x.exprs === 0)) return "string";
  if (x.kind === "bool") return "boolean";
  return undefined;
}

// The type of an operand when the source shows it: a literal, `typeof x`, `.length`, or a name
// declared with a literal.
function evident(f: Ref<File>, e: usize, literals: Ref<Map<string, string>>): string | undefined {
  const x: Ref<Item> = f.items[e]!;
  if (x.kind === "unary" && x.op === "typeof") return "string";
  if (x.kind === "member" && x.name === "length") return "number";
  if (x.kind === "ident") return literals.get(x.name!);
  return literalKind(f, e);
}

// Whether a function expression sits where an arrow function means the same and parses: an
// argument, a variable's initializer, an assignment's value, a return value, a property's value
// or an array's element. As an operand, a callee or an object, an arrow would read otherwise.
function arrowSlot(f: Ref<File>, n: usize): boolean {
  const holder = f.items[n]!.parent;
  if (holder === undefined) return false;
  const kind = f.items[holder]!.kind;
  const key = f.items[n]!.key;
  return ((kind === "call" || kind === "new") && key === "args") || (key === "init" && f.items[holder]!.of === "declarator") || ((kind === "assign" || kind === "return" || kind === "property") && key === "value") || (kind === "array" && key === "elements");
}

// A9: a function expression's edits into an arrow function: `function` and an unused name dropped,
// and `=>` before its body. None when it uses its own `this`, `arguments` or `new.target`, is a
// generator, calls itself by name, is constructed or given a prototype under the name it is
// bound to, or sits where an arrow function would read otherwise.
function arrowEdits(f: Ref<File>, n: usize): Edit[] | undefined {
  const x: Ref<Item> = f.items[n]!;
  if (x.generator || !arrowSlot(f, n)) return undefined;
  const own = x.name;
  let inner: usize[] = [];
  for (const p of x.params) for (const y of nodesUnder(f, p)) inner.push(y);
  for (const y of bodyNodes(f, n)) inner.push(y);
  for (const y of inner) {
    const k = f.items[y]!.kind;
    const name = f.items[y]!.name;
    if (k === "this" || k === "super" || (k === "meta" && name === "new.target") || (k === "ident" && (name === "arguments" || name === "this" || (own !== undefined && name === own)))) return undefined;
  }
  const holder = x.parent!;
  const h: Ref<Item> = f.items[holder]!;
  const bound = x.key === "init" ? h.target : h.kind === "assign" ? h.target : undefined;
  // A function held by an object's property and constructed through it, as `new o.f()`, too.
  const key = h.propKey;
  if (h.kind === "property" && key !== undefined && f.order.some((y) => f.items[y]!.kind === "new" && kindAt(f, f.items[y]!.callee) === "member" && nameAt(f, f.items[y]!.callee) === key)) return undefined;
  const boundName = kindAt(f, bound) === "ident" ? nameAt(f, bound) : undefined;
  if (boundName !== undefined && f.order.some((y) => (f.items[y]!.kind === "new" && named(f, f.items[y]!.callee, boundName)) || (f.items[y]!.kind === "member" && f.items[y]!.name === "prototype" && named(f, f.items[y]!.object, boundName)))) return undefined;
  let i = tokenAt(f, x.start);
  while (i < f.tokens.length && !isToken(f.tokens[i]!, "function")) i++;
  const last = own !== undefined ? i + 1 : i;
  // The body's `{` is the one matching the `}` that ends the function.
  let j = (tokenAt(f, x.end) as i64) - 1;
  for (let depth: i64 = 0; j >= 0; j--) {
    depth += isToken(f.tokens[j as usize]!, "}") ? 1 : isToken(f.tokens[j as usize]!, "{") ? -1 : 0;
    if (depth === 0) break;
  }
  if (i >= f.tokens.length || last >= f.tokens.length || j < 0 || !isToken(f.tokens[j as usize]!, "{")) return undefined;
  const keyword: Ref<Token> = f.tokens[i]!;
  const brace: Ref<Token> = f.tokens[j as usize]!;
  let cut = f.tokens[last]!.end;
  // After `return`, a line break left where `function` was would end the statement there, so the
  // deletion runs on through it; a comment in the way stops the fix.
  const returned = h.kind === "return";
  while (f.src.charAt(cut as i64) === " " || f.src.charAt(cut as i64) === "\t" || (returned && /\s/.test(f.src.charAt(cut as i64)))) cut++;
  if (returned) {
    const after = i + (own !== undefined ? 2 : 1);
    if (after >= f.tokens.length || cut !== f.tokens[after]!.start) return undefined;
  }
  const spaced = brace.start > 0 && /\s/.test(f.src.charAt((brace.start - 1) as i64));
  return [{ start: keyword.start, end: cut, text: "" }, { start: brace.start, end: brace.start, text: spaced ? "=> " : " => " }];
}

// The type names declared in the file as object types: classes and interfaces, and aliases of
// object types; an enum or an alias of anything else isn't one.
function objectTypes(f: Ref<File>): Map<string, boolean> {
  let types = new Map<string, boolean>();
  const none = new Map<string, boolean>();
  const generic = new Set<string>();
  for (const n of f.order) {
    const x: Ref<Item> = f.items[n]!;
    const name = x.name;
    if (name === undefined) continue;
    if (x.kind === "class" || x.kind === "interface") types.set(name, true);
    if (x.kind === "enum") types.set(name, false);
    const type = x.type;
    if (x.kind === "typeAlias") types.set(name, type !== undefined && kindAt(f, type) !== "" && kindAt(f, type) !== "ref" && objectLike(f, type, none, generic));
  }
  return types;
}

// Whether a parameter's type is an object, which a function borrows rather than copies: an
// object type, an array or tuple, or a name that isn't a primitive, an enum or a type parameter.
function objectLike(f: Ref<File>, t: usize, declared: Ref<Map<string, boolean>>, generic: Ref<Set<string>>): boolean {
  const x: Ref<Item> = f.items[t]!;
  if (x.kind === "object" || x.kind === "array" || x.kind === "tuple") return true;
  if (x.kind !== "ref") return false;
  const name = x.name!;
  if (PRIMITIVES.has(name) || generic.has(name) || ["Ref", "Mut", "Option", "Atomic"].includes(name)) return false;
  const known = declared.get(name);
  return known === undefined ? true : known;
}

// What a change has to be rooted at: a parameter by its name, or a method's object, `this` or a
// local holding it.
type Root = { name: string | undefined; aliases: Set<string> };

// What the file's functions change: which parameters, by index, and which methods' receivers.
type Changed = { params: Map<usize, Set<usize>>; methods: Set<usize> };

// Which parameters of the file's functions, by index, and which methods' receivers, the file
// changes: from the syntax, then through calls to the file's own functions and methods, until
// nothing more is found. A parameter or receiver already written `Mut` counts as changed.
function changed(f: Ref<File>): Changed {
  const functions = f.order.filter((n) => isFunction(f.items[n]!.kind) && f.items[n]!.hasBody);
  let byName = new Map<string, usize>();
  for (const n of functions) {
    const x: Ref<Item> = f.items[n]!;
    const name = x.name;
    const holder = x.parent;
    if (x.kind === "function" && x.macro && name !== undefined) byName.set(name, n);
    else if (x.key === "init" && holder !== undefined) {
      const target = f.items[holder]!.target;
      if (kindAt(f, target) === "ident") byName.set(nameAt(f, target)!, n);
    }
  }
  let c: Changed = { params: new Map<usize, Set<usize>>(), methods: new Set<usize>() };
  for (const n of functions) {
    let written = new Set<usize>();
    for (const [i, p] of f.items[n]!.params.entries()) if (typeName(f, f.items[p]!.type, "Mut")) written.add(i as usize);
    c.params.set(n, written);
    if (f.items[n]!.kind === "method" && f.items[n]!.params.some((p) => named(f, f.items[p]!.pattern, "this") && typeName(f, f.items[p]!.type, "Mut"))) c.methods.add(n);
  }
  let bodies = new Map<usize, usize[]>();
  for (const n of functions) bodies.set(n, bodyNodes(f, n));
  let receivers = new Map<usize, usize[]>();
  for (const n of functions) if (f.items[n]!.kind === "method" && f.items[n]!.modifiers && !f.items[n]!.isStatic) receivers.set(n, ownScope(f, n));
  for (let more = true; more; ) {
    more = false;
    for (const [n, body] of bodies) {
      for (const [at, p] of f.items[n]!.params.entries()) {
        const i = at as usize;
        const pattern = f.items[p]!.pattern!;
        const had = c.params.get(n);
        if (f.items[pattern]!.kind !== "ident" || had === undefined || had.has(i)) continue;
        const root: Root = { name: f.items[pattern]!.name, aliases: new Set<string>() };
        if (body.some((x) => changes(f, x, root, c, byName, undefined, false))) {
          let set = had;
          set.add(i);
          c.params.set(n, set);
          more = true;
        }
      }
    }
    for (const [m, body] of receivers) {
      if (c.methods.has(m)) continue;
      let aliases = new Set<string>();
      for (const x of body) {
        if (f.items[x]!.kind !== "let") continue;
        for (const d of f.items[x]!.declarations) {
          const target = f.items[d]!.target;
          if (kindAt(f, target) === "ident" && kindAt(f, f.items[d]!.init) === "this") aliases.add(nameAt(f, target)!);
        }
      }
      const root: Root = { name: undefined, aliases };
      const cls = f.items[m]!.parent;
      if (body.some((x) => changes(f, x, root, c, byName, cls, true))) {
        c.methods.add(m);
        more = true;
      }
    }
  }
  return c;
}

// A method's own nodes: its body without the functions and classes in it that have their own
// `this`; arrow functions share the method's.
function ownScope(f: Ref<File>, n: usize): usize[] {
  let found: usize[] = [];
  for (const b of f.items[n]!.bodyItems) {
    let j = b;
    while (j < f.items[b]!.last) {
      const k = f.items[j]!.kind;
      if (k !== "") found.push(j);
      j = k === "function" || k === "class" ? f.items[j]!.last : j + 1;
    }
  }
  return found;
}

// Whether `r` is where a change has to be rooted.
function rootAt(f: Ref<File>, r: usize | undefined, root: Ref<Root>): boolean {
  if (r === undefined) return false;
  const name = root.name;
  if (name !== undefined) return named(f, r, name);
  const k = f.items[r]!.kind;
  const rname = f.items[r]!.name;
  return k === "this" || (k === "ident" && rname !== undefined && root.aliases.has(rname));
}

// Whether `e` is a field or element of a place rooted at `root`.
function rooted(f: Ref<File>, e: usize | undefined, root: Ref<Root>): boolean {
  let at = e;
  while (at !== undefined && (f.items[at]!.kind === "member" || f.items[at]!.kind === "index")) at = f.items[at]!.object;
  return at !== e && rootAt(f, at, root);
}

const reaches = (f: Ref<File>, e: usize | undefined, root: Ref<Root>) => rootAt(f, e, root) || rooted(f, e, root);

// Whether `x` changes a place rooted at `root`: assigning, incrementing or deleting a field or
// element of it, destructuring into one, `Object.assign` onto it, calling a method known to change
// it, or passing it to one of the file's functions that changes that parameter. A method counts
// as changing when one of that name does, in `cls` when `ownClass` asks for the receiver's.
function changes(f: Ref<File>, x: usize, root: Ref<Root>, c: Ref<Changed>, byName: Ref<Map<string, usize>>, cls: usize | undefined, ownClass: boolean): boolean {
  const it: Ref<Item> = f.items[x]!;
  if (it.kind === "assign") return rooted(f, it.target, root);
  if (it.kind === "update" || (it.kind === "unary" && it.op === "delete")) return rooted(f, it.operand, root);
  if (it.kind === "destructure") {
    const pattern = it.pattern;
    return pattern !== undefined && nodesUnder(f, pattern).some((m) => (f.items[m]!.kind === "member" || f.items[m]!.kind === "index") && rooted(f, m, root));
  }
  const callee = it.callee;
  if (it.kind !== "call" || callee === undefined) return false;
  const ce: Ref<Item> = f.items[callee]!;
  if (ce.kind === "member" && named(f, ce.object, "Object") && ce.name === "assign") return reaches(f, it.args[0], root);
  const method = ce.name;
  if (ce.kind === "member" && method !== undefined) {
    const mutating = [...c.methods].some((m) => f.items[m]!.name === method && (!ownClass || cls === undefined || f.items[m]!.parent === cls));
    if ((MUTATORS.has(method) || mutating) && reaches(f, ce.object, root)) return true;
  }
  const target = ce.kind === "ident" ? byName.get(ce.name!) : undefined;
  if (target === undefined) return false;
  const written = c.params.get(target);
  return it.args.some((a, i) => reaches(f, a, root) && written !== undefined && written.has(i as usize));
}

// A5 and A6: each object parameter used only through its fields and as an argument, borrowed as
// `Mut<T>` when the file finds it changed and `Ref<T>` otherwise, marked for review. A parameter
// used any other way, as a value stored or returned, is the function's to own, and keeps its type.
function ownership(f: Ref<File>, n: usize, declared: Ref<Map<string, boolean>>, changedParams: Set<usize> | undefined): Hit[] {
  let hits: Hit[] = [];
  let generic = new Set<string>();
  for (const p of f.items[n]!.typeParams) generic.add(nameAt(f, p)!);
  const body = bodyNodes(f, n);
  for (const [at, p] of f.items[n]!.params.entries()) {
    const i = at as usize;
    const pi: Ref<Item> = f.items[p]!;
    const pattern = pi.pattern!;
    const type = pi.type;
    // A default would be a temporary the borrow outlives.
    if (f.items[pattern]!.kind !== "ident" || f.items[pattern]!.name === "this" || pi.rest || pi.optional || pi.hasDefault || type === undefined || kindAt(f, type) === "" || !objectLike(f, type, declared, generic)) continue;
    const name = f.items[pattern]!.name!;
    const uses = body.filter((x) => f.items[x]!.kind === "ident" && f.items[x]!.name === name);
    if (uses.length === 0 || body.some((x) => f.items[x]!.kind === "shorthand" && f.items[x]!.name === name)) continue;
    let through = new Set<usize>();
    for (const x of body) {
      const k = f.items[x]!.kind;
      const object = f.items[x]!.object;
      if ((k === "member" || k === "index") && object !== undefined) through.add(object);
      if (k === "call" || k === "new") for (const a of f.items[x]!.args) through.add(a);
    }
    if (!uses.every((u) => through.has(u))) continue;
    const written = annotation(f, f.items[pattern]!.end, type);
    if (written === undefined) continue;
    const mut = changedParams !== undefined && changedParams.has(i);
    const rule = mut ? "A6" : "A5";
    const wrapper = mut ? "Mut" : "Ref";
    const shown = text(f, written.type);
    const message = `'${name}' is ${mut ? "changed" : "only read"} here, so it is borrowed as '${wrapper}<${shown}>'; the marker asks you to confirm it`;
    hits.push({ rule, action: "auto", start: written.type.start, end: written.type.end, message, edits: [{ start: written.type.start, end: written.type.start, text: `${wrapper}<` }, { start: written.type.end, end: written.type.end, text: `> ${MARKER}` }] });
  }
  return hits;
}

// A7: a method changing its object's fields takes `this: Mut<this>`, marked for review, as the
// first parameter. A `this` return type becomes `Mut<this>`, lending the object on to chain.
function receiver(f: Ref<File>, n: usize): Hit | undefined {
  const x: Ref<Item> = f.items[n]!;
  let from = x.start;
  const nameExpr = x.nameExpr;
  if (x.typeParams.length > 0) from = f.items[x.typeParams[x.typeParams.length - 1]!]!.end;
  else if (nameExpr !== undefined) from = f.items[nameExpr]!.end;
  else if (x.decorators.length > 0) from = f.items[x.decorators[x.decorators.length - 1]!]!.end;
  let i = tokenAt(f, from);
  while (i < f.tokens.length && !isToken(f.tokens[i]!, "(")) i++;
  if (i >= f.tokens.length) return undefined;
  const open = f.tokens[i]!.end;
  const at = x.params.length > 0 ? f.items[x.params[0]!]!.start : open;
  const added = `this: Mut<this> ${MARKER}${x.params.length > 0 ? ", " : ""}`;
  const returnType = x.returnType;
  let edits: Edit[] = [{ start: at, end: at, text: added }];
  let returned = false;
  if (returnType !== undefined && kindAt(f, returnType) === "ref" && nameAt(f, returnType) === "this" && f.items[returnType]!.args.length === 0) {
    returned = true;
    edits.push({ start: f.items[returnType]!.start, end: f.items[returnType]!.end, text: "Mut<this>" });
  }
  return { rule: "A7", action: "auto", start: x.start, end: open, message: `the method changes its object's fields, so it takes 'this: Mut<this>'${returned ? " and returns 'Mut<this>'" : ""}; the marker asks you to confirm it`, edits };
}

// A4: a top-level `let` holding an integer, bound nowhere else and not exported, that is updated
// only by `++`, `--`, `+=` or `-=` of an integer in statements of their own and is otherwise read,
// becomes a const `Atomic`.
function counters(f: Ref<File>): Hit[] {
  let hits: Hit[] = [];
  let statements = new Set<usize>();
  let exported = new Set<string>();
  let updated = new Set<string>();
  let usePairs: Pairs = { names: [], at: [] };
  for (const n of f.order) {
    const x: Ref<Item> = f.items[n]!;
    const expr = x.expr;
    if (x.kind === "expr" && expr !== undefined) statements.add(expr);
    if (x.kind === "exportNamed" && x.module === undefined) for (const name of x.names) exported.add(name);
    if (x.kind === "exportDefault" && kindAt(f, x.value) === "ident") exported.add(nameAt(f, x.value)!);
    if (x.kind === "update" && kindAt(f, x.operand) === "ident") updated.add(nameAt(f, x.operand)!);
    if (x.kind === "assign" && kindAt(f, x.target) === "ident") updated.add(nameAt(f, x.target)!);
    const name = x.name;
    if ((x.kind === "ident" || x.kind === "shorthand") && name !== undefined) addTo(usePairs, name, n);
  }
  const uses = grouped(usePairs);
  for (const s of f.top) {
    const x: Ref<Item> = f.items[s]!;
    if (x.kind !== "let" || x.keyword !== "let" || x.declarations.length !== 1) continue;
    const d: Ref<Item> = f.items[x.declarations[0]!]!;
    const target = d.target!;
    const init = d.init;
    if (f.items[target]!.kind !== "ident" || init === undefined || !isInteger(f, init)) continue;
    const name = f.items[target]!.name!;
    if (f.bound.get(name) !== 1 || exported.has(name) || !updated.has(name)) continue;
    const found = uses.get(name);
    let edits = counterEdits(f, name, target, found === undefined ? [] : found, statements);
    if (edits === undefined) continue;
    const shown = text(f, spanOf(f, init));
    const type = d.type;
    const written = type === undefined ? undefined : annotation(f, f.items[target]!.end, type);
    if (type !== undefined && written === undefined) continue;
    edits.push({ start: x.start, end: x.start + 3, text: "const" });
    if (written !== undefined) edits.push({ start: f.tokens[written.colon]!.start, end: written.type.end, text: "" });
    edits.push({ start: f.items[init]!.start, end: f.items[init]!.end, text: `new Atomic(${shown})` });
    hits.push({ rule: "A4", action: "auto", start: x.start, end: f.items[init]!.end, message: `the top-level counter becomes 'const ${name} = new Atomic(${shown})', updated with 'add' and 'sub' and read with 'load()'`, edits });
  }
  return hits;
}

const isInteger = (f: Ref<File>, e: usize) => f.items[e]!.kind === "int" || (f.items[e]!.kind === "unary" && f.items[e]!.op === "-" && kindAt(f, f.items[e]!.operand) === "int");

// The edits turning each use of a counter into an Atomic's, or undefined when one is used any
// other way.
function counterEdits(f: Ref<File>, name: string, declaration: usize, uses: Ref<usize[]>, statements: Ref<Set<usize>>): Edit[] | undefined {
  let edits: Edit[] = [];
  for (const use of uses) {
    if (use === declaration) continue;
    if (f.items[use]!.kind === "shorthand") return undefined;
    const holder = f.items[use]!.parent;
    const key = f.items[use]!.key;
    if (holder === undefined) {
      edits.push({ start: f.items[use]!.start, end: f.items[use]!.end, text: `${name}.load()` });
      continue;
    }
    const h: Ref<Item> = f.items[holder]!;
    if (h.kind === "update" && key === "operand") {
      if (!statements.has(holder)) return undefined;
      edits.push({ start: h.start, end: h.end, text: `${name}.${h.op === "++" ? "add" : "sub"}(1)` });
    } else if (h.kind === "assign" && key === "target") {
      const value = h.value;
      if (!statements.has(holder) || (h.op !== "+=" && h.op !== "-=") || value === undefined || !isInteger(f, value)) return undefined;
      edits.push({ start: h.start, end: h.end, text: `${name}.${h.op === "+=" ? "add" : "sub"}(${text(f, spanOf(f, value))})` });
    } else edits.push({ start: f.items[use]!.start, end: f.items[use]!.end, text: `${name}.load()` });
  }
  return edits;
}

// Each review marker still in the file, as a guided hit: A6 after a `Mut`, A5 after a `Ref`.
function markers(src: string, comments: Ref<Comment[]>): Hit[] {
  let hits: Hit[] = [];
  for (const c of comments) {
    if (c.text !== MARKER) continue;
    const before = src.slice(0, c.start as i64);
    const rule = before.lastIndexOf("Mut<") > before.lastIndexOf("Ref<") ? "A6" : "A5";
    hits.push({ rule, action: "guided", start: c.start, end: c.end, message: "an ownership type the lint inserted: check it, then remove the marker" });
  }
  return hits;
}

// What each guided rule suggests, as the hit's message says it.
const GUIDES: Record<string, string> = {
  G1: "'any' turns type checking off, which Fish doesn't do; choose a concrete type, a union, 'unknown' narrowed with 'typeof' or 'instanceof' before use, or the dynamic 'Json' value",
  G2: "the promise this call gives is dropped, and a Fish future runs only when it is awaited; add 'await', or wrap the call in 'spawn()' to run it on its own",
  G3: "this 'number' counts or indexes, and a Fish 'number' is a float; make it 'i64', or 'usize' for an index",
  G4: "this class extends one that is also used as a type, so a subclass stands in for its base, which Fish's embedded bases don't allow; extract an interface for what they share, and hold the base as a field",
  G5: "'instanceof' tests a class that others extend, and Fish has no subclass checks at run time; 'match' on an interface or an enum instead",
  G6: "indexing with a string key, or testing one with 'in' that isn't written as a literal, reads the object as a dictionary, which a Fish object isn't; declare it as one, '{ [k: string]: T }' or 'Record<string, T>', or use a 'Map<string, T>'",
  G7: "top-level code runs when the module loads, which Fish doesn't do; move it into 'main()', or into a 'Lazy<T>' for a value made once",
  G8: "parsing gives an 'Option' in Fish rather than NaN; 'match' on the parsed 'Option' instead of checking 'isNaN'",
  G9: "'.call', '.apply' and '.bind' choose a function's 'this' at run time; pass the receiver as an argument, or use a closure",
  G10: "'forEach' doesn't wait for an async callback; use 'for...of' with 'await', or spawn a task for each",
  G11: "hold one value, changed through one while the other is still used, which Fish's ownership refuses; share it as 'shared<T>', give one its own '.clone()', or restructure so one name is used at a time",
};

const guideText = (rule: string): string => {
  const text = GUIDES[rule];
  return text === undefined ? "" : text;
};
const guide = (rule: string, start: usize, end: usize): Hit => ({ rule, action: "guided", start, end, message: guideText(rule) });

// A call that parses a number: `parseInt`, `parseFloat` or `Number`, bare or on `Number`.
function parsing(f: Ref<File>, e: usize | undefined): boolean {
  if (e === undefined || f.items[e]!.kind !== "call") return false;
  const callee = f.items[e]!.callee;
  if (named(f, callee, "parseInt") || named(f, callee, "parseFloat") || named(f, callee, "Number")) return true;
  const name = nameAt(f, callee);
  return callee !== undefined && f.items[callee]!.kind === "member" && named(f, f.items[callee]!.object, "Number") && (name === "parseInt" || name === "parseFloat");
}

// Where a call's rule points: a method's own name rather than the start of a long chain.
function callAt(f: Ref<File>, n: usize): usize {
  const callee = f.items[n]!.callee;
  if (callee === undefined || f.items[callee]!.kind !== "member") return f.items[n]!.start;
  const name = f.items[callee]!.name;
  return f.items[callee]!.end - (name === undefined ? 9 : name.length);
}

// The guided rules' hits: each a decision left to a person, with what to do, never an edit.
function guided(f: Ref<File>): Hit[] {
  let hits: Hit[] = [];
  for (const s of f.top) {
    const body = f.items[s]!.body;
    const top = (f.items[s]!.kind === "export" || f.items[s]!.kind === "declare") && body !== undefined && kindAt(f, body) !== "" ? body : s;
    const expr = f.items[top]!.expr;
    if (f.items[top]!.kind === "expr" && !(kindAt(f, expr) === "string") && !callsMain(f, expr)) hits.push(guide("G7", f.items[top]!.start, f.items[top]!.end));
  }
  const scopes = scopesOf(f);
  const dictionary = new Dictionaries(f);
  let extended = new Set<string>();
  let typed = new Set<string>();
  for (const n of f.order) {
    const base = f.items[n]!.kind === "class" ? baseName(f, n) : undefined;
    if (base !== undefined) extended.add(base);
    const name = f.items[n]!.name;
    if (f.items[n]!.kind === "ref" && f.items[n]!.key !== "implements" && name !== undefined) typed.add(name);
  }
  append(hits, dropped(f, scopes));
  append(hits, counts(f, scopes));
  append(hits, aliases(f));
  for (const n of f.order) {
    const x: Ref<Item> = f.items[n]!;
    if (x.kind === "ref" && x.name === "any") hits.push(guide("G1", x.start, x.end));
    const base = x.kind === "class" ? baseName(f, n) : undefined;
    if (base !== undefined && typed.has(base)) hits.push(guide("G4", x.start, x.end));
    if (x.kind === "binary" && x.op === "instanceof" && kindAt(f, x.right) === "ident" && extended.has(nameAt(f, x.right)!)) hits.push(guide("G5", x.start, x.end));
    const index = x.index;
    if (x.kind === "index" && index !== undefined) {
      const k = f.items[index]!.kind;
      if ((k === "string" || k === "template" || (k === "ident" && stringy(f, scopes, index))) && !dictionary.has(f, x.object) && kindAt(f, x.object) !== "meta") hits.push(guide("G6", x.start, x.end));
    }
    if (x.kind === "binary" && x.op === "in" && kindAt(f, x.left) !== "" && kindAt(f, x.left) !== "string" && kindAt(f, x.left) !== "privateName" && !dictionary.has(f, x.right)) hits.push(guide("G6", x.start, x.end));
    // A call signature in an interface is a `call` too, without arguments.
    const callee = x.callee;
    if (x.kind !== "call" || x.of !== "expr" || callee === undefined) continue;
    const ce: Ref<Item> = f.items[callee]!;
    const first = x.args.length > 0 ? x.args[0] : undefined;
    const isNaN = named(f, callee, "isNaN") || (ce.kind === "member" && named(f, ce.object, "Number") && ce.name === "isNaN");
    if (isNaN && (parsing(f, first) || (kindAt(f, first) === "ident" && parsing(f, initOf(f, scopes, first!))))) hits.push(guide("G8", callAt(f, n), x.end));
    if (ce.kind !== "member") continue;
    if (ce.name === "call" || ce.name === "apply" || ce.name === "bind") hits.push(guide("G9", callAt(f, n), x.end));
    const fk = kindAt(f, first);
    if (ce.name === "forEach" && (fk === "arrow" || fk === "function") && f.items[first!]!.async) hits.push(guide("G10", callAt(f, n), x.end));
  }
  return hits;
}

// What a name used given to `isNaN` holds, read from the declarator it resolves to.
function initOf(f: Ref<File>, scopes: Ref<Scopes>, use: usize): usize | undefined {
  const b = resolve(f, scopes, use);
  return b !== undefined && b.kind === "let" ? f.items[b.declarator]!.init : undefined;
}

// Whether a name used as an index holds a string, as the binding it resolves to says.
function stringy(f: Ref<File>, scopes: Ref<Scopes>, use: usize): boolean {
  const b = resolve(f, scopes, use);
  if (b === undefined) return false;
  if (b.kind === "param") return typeName(f, f.items[b.param]!.type, "string");
  if (b.kind !== "let") return false;
  const holder = f.items[b.let]!.parent;
  const d: Ref<Item> = f.items[b.declarator]!;
  const init = d.init;
  return (holder !== undefined && f.items[holder]!.kind === "forIn" && f.items[b.let]!.key === "left") || typeName(f, d.type, "string") || (init !== undefined && (literalKind(f, init) === "string" || f.items[init]!.kind === "template"));
}

// `main()` at the top level, or `main().catch(...)`, which a Fish program's `main` replaces.
function callsMain(f: Ref<File>, e: usize | undefined): boolean {
  if (e === undefined || f.items[e]!.kind !== "call") return false;
  const callee = f.items[e]!.callee;
  if (named(f, callee, "main")) return true;
  const name = nameAt(f, callee);
  return callee !== undefined && f.items[callee]!.kind === "member" && (name === "catch" || name === "then") && callsMain(f, f.items[callee]!.object);
}

// The class extended, by name, seeing through type arguments as in `extends Base<string>`.
function baseName(f: Ref<File>, n: usize): string | undefined {
  let base = f.items[n]!.extends;
  if (base !== undefined && f.items[base]!.kind === "instantiation") base = f.items[base]!.expr;
  return kindAt(f, base) === "ident" ? nameAt(f, base) : undefined;
}

// What a name is bound to: a variable's declarator in its `let`, a parameter of a function, or a
// declared function.
type Binding = { kind: "let" | "param" | "function"; declarator: usize; let: usize; param: usize; fn: usize };
// Each scope's bindings, by the item holding the scope and the name: a statement list's under what
// holds it, a loop head's under its loop, the file's under `root`, and a function's parameters
// under the function.
type Scopes = { held: Map<string, Binding>; root: Map<string, Binding> };

const scopeKey = (scope: usize, name: string) => `${scope} ${name}`;

function bind(scopes: Mut<Scopes>, scope: usize | undefined, name: string, b: Binding) {
  if (scope === undefined) {
    if (!scopes.root.has(name)) scopes.root.set(name, b);
    return;
  }
  const key = scopeKey(scope, name);
  if (!scopes.held.has(key)) scopes.held.set(key, b);
}

function scopesOf(f: Ref<File>): Scopes {
  let scopes: Scopes = { held: new Map<string, Binding>(), root: new Map<string, Binding>() };
  for (const n of f.order) {
    const x: Ref<Item> = f.items[n]!;
    if (x.kind === "let") for (const d of x.declarations) for (const name of identNames(f, f.items[d]!.target, false)) bind(scopes, x.parent, name, { kind: "let", declarator: d, let: n, param: 0, fn: 0 });
    const name = x.name;
    if (x.kind === "function" && x.macro && name !== undefined) bind(scopes, x.parent, name, { kind: "function", declarator: 0, let: 0, param: 0, fn: n });
    if (isFunction(x.kind) && x.hasBody) for (const p of x.params) for (const bound of identNames(f, f.items[p]!.pattern, false)) bind(scopes, n, bound, { kind: "param", declarator: 0, let: 0, param: p, fn: n });
  }
  return scopes;
}

// The binding a name's use resolves to: the innermost scope holding it that binds the name.
function resolve(f: Ref<File>, scopes: Ref<Scopes>, use: usize): Binding | undefined {
  const name = f.items[use]!.name;
  if (name === undefined) return undefined;
  let at = f.items[use]!.parent;
  while (at !== undefined) {
    const found = scopes.held.get(scopeKey(at, name));
    if (found !== undefined) return found;
    at = f.items[at]!.parent;
  }
  return scopes.root.get(name);
}

// Which expressions are dictionaries, as far as their syntax tells: a name declared with
// `{ [k: string]: V }`, `Record<string, V>` or a type alias of the file naming one, or a field of
// `this` its class declares so. Fish reads, writes, deletes and tests their keys.
class Dictionaries {
  scopes: Scopes;
  aliases: Set<string>;
  fields: Map<usize, Set<string>>;

  constructor(f: Ref<File>) {
    this.scopes = scopesOf(f);
    this.aliases = new Set<string>();
    this.fields = new Map<usize, Set<string>>();
    for (const n of f.order) {
      const x: Ref<Item> = f.items[n]!;
      if (x.kind === "typeAlias" && x.typeParams.length === 0 && this.dict(f, x.type)) this.aliases.add(x.name!);
    }
    for (const n of f.order) {
      if (f.items[n]!.kind !== "class") continue;
      let names = new Set<string>();
      for (const m of f.items[n]!.members) {
        const name = f.items[m]!.name;
        if (f.items[m]!.kind === "field" && name !== undefined && this.dict(f, f.items[m]!.type)) names.add(name);
      }
      this.fields.set(n, names);
    }
  }

  // Whether a type is a dictionary's.
  dict(f: Ref<File>, t: usize | undefined): boolean {
    if (t === undefined || f.items[t]!.kind === "") return false;
    const x: Ref<Item> = f.items[t]!;
    const index = x.kind === "object" && x.members.length > 0 ? x.members[0] : undefined;
    if (index !== undefined && f.items[index]!.kind === "index" && x.members.length === 1) {
      const params: Ref<usize[]> = f.items[index]!.params;
      return !f.items[index]!.readonly && params.length > 0 && typeName(f, f.items[params[0]!]!.type, "string");
    }
    return x.kind === "ref" && ((x.name === "Record" && x.args.length === 2 && typeName(f, x.args[0], "string")) || this.aliases.has(x.name!));
  }

  has(f: Ref<File>, o: usize | undefined): boolean {
    if (o === undefined) return false;
    const x: Ref<Item> = f.items[o]!;
    if (x.kind === "member") {
      if (kindAt(f, x.object) !== "this") return false;
      const cls = classOf(f, o);
      const names = cls === undefined ? undefined : this.fields.get(cls);
      return names !== undefined && names.has(x.name!);
    }
    if (x.kind !== "ident") return false;
    const b = resolve(f, this.scopes, o);
    if (b === undefined) return false;
    if (b.kind === "param") return this.dict(f, f.items[b.param]!.type);
    if (b.kind === "let") return this.dict(f, f.items[b.declarator]!.type);
    return false;
  }
}

// The innermost class holding `n`.
function classOf(f: Ref<File>, n: usize): usize | undefined {
  let at = f.items[n]!.parent;
  while (at !== undefined) {
    if (f.items[at]!.kind === "class") return at;
    at = f.items[at]!.parent;
  }
  return undefined;
}

// G2: a call whose promise is dropped: a statement of its own, not awaited, returned, assigned or
// given to `void`, of what the file declares giving a promise. A plain call counts through the
// binding its name resolves to; a method call only when its receiver is known from the syntax:
// `this` in the method's class, a name annotated with the class, interface or type, or a local
// made with `new` of the class or with the object literal.
function dropped(f: Ref<File>, scopes: Ref<Scopes>): Hit[] {
  // Each type or object literal's methods that give a promise, by name.
  let owners = new Map<usize, Set<string>>();
  let types = new Map<string, usize>();
  for (const n of f.order) {
    const x: Ref<Item> = f.items[n]!;
    let members: usize[] | undefined = undefined;
    const type = x.type;
    if (x.kind === "class" || x.kind === "interface") members = [...x.members];
    else if (x.kind === "typeAlias" && type !== undefined && f.items[type]!.kind === "object") members = [...f.items[type]!.members];
    else if (x.kind === "object" && x.of !== "typeNode") members = [...x.props];
    if (members === undefined) continue;
    const name = x.name;
    if (name !== undefined) types.set(name, n);
    let names = new Set<string>();
    for (const m of members) {
      const mi: Ref<Item> = f.items[m]!;
      const mname = mi.name !== undefined ? mi.name : mi.nameExpr !== undefined ? undefined : mi.propKey;
      const value = mi.kind === "property" && mi.value !== undefined && kindAt(f, mi.value) !== "" ? mi.value : m;
      if (mname !== undefined && (mi.kind === "method" || mi.kind === "property") && f.items[value]!.promised) names.add(mname);
    }
    owners.set(n, names);
  }
  let hits: Hit[] = [];
  for (const n of f.order) {
    const x: Ref<Item> = f.items[n]!;
    const call = x.expr;
    if (x.kind !== "expr" || call === undefined || f.items[call]!.kind !== "call") continue;
    const callee = f.items[call]!.callee;
    if (callee !== undefined && gives(f, scopes, owners, types, callee, call)) hits.push(guide("G2", f.items[call]!.start, f.items[call]!.end));
  }
  return hits;
}

// The type or object literal a binding holds, as far as its annotation or initializer says.
function ownerOf(f: Ref<File>, types: Ref<Map<string, usize>>, b: Binding | undefined): usize | undefined {
  if (b === undefined) return undefined;
  let type = b.kind === "param" ? f.items[b.param]!.type : b.kind === "let" ? f.items[b.declarator]!.type : undefined;
  // A borrow of the type is the type for this.
  if (type !== undefined && f.items[type]!.kind === "ref" && (f.items[type]!.name === "Ref" || f.items[type]!.name === "Mut")) type = f.items[type]!.args.length > 0 ? f.items[type]!.args[0] : undefined;
  if (type !== undefined && f.items[type]!.kind === "ref") return types.get(f.items[type]!.name!);
  const init = b.kind === "let" ? f.items[b.declarator]!.init : undefined;
  if (init === undefined) return undefined;
  const callee = f.items[init]!.callee;
  if (f.items[init]!.kind === "new" && kindAt(f, callee) === "ident") return types.get(nameAt(f, callee)!);
  return f.items[init]!.kind === "object" ? init : undefined;
}

// Whether calling `callee` gives a promise the file declares.
function gives(f: Ref<File>, scopes: Ref<Scopes>, owners: Ref<Map<usize, Set<string>>>, types: Ref<Map<string, usize>>, callee: usize, call: usize): boolean {
  const ce: Ref<Item> = f.items[callee]!;
  if (ce.kind === "ident") {
    const b = resolve(f, scopes, callee);
    if (b === undefined) return false;
    if (b.kind === "function") return f.items[b.fn]!.promised;
    const init = b.kind === "let" ? f.items[b.declarator]!.init : undefined;
    return init !== undefined && (f.items[init]!.kind === "arrow" || f.items[init]!.kind === "function") && f.items[init]!.promised;
  }
  if (ce.kind !== "member") return false;
  const object = ce.object!;
  let owner: usize | undefined = undefined;
  if (f.items[object]!.kind === "this") {
    for (const a of ancestors(f, call)) {
      if (f.items[a]!.kind === "class") {
        owner = a;
        break;
      }
    }
  } else if (f.items[object]!.kind === "ident") owner = ownerOf(f, types, resolve(f, scopes, object));
  if (owner === undefined) return false;
  const names = owners.get(owner);
  return names !== undefined && names.has(ce.name!);
}

const COMPARES = new Set(["<", "<=", ">", ">=", "===", "!==", "==", "!="]);

// G3: a binding declared with a number or annotated `number` that the code uses as an array
// index, or compares with a `.length` as a loop counter does. Each such use is resolved to its
// binding once, and each binding reported once, at its name.
function counts(f: Ref<File>, scopes: Ref<Scopes>): Hit[] {
  let seen = new Set<usize>();
  let hits: Hit[] = [];
  for (const list of f.idents.values()) {
    for (const use of list) {
      const holder = f.items[use]!.parent;
      if (holder === undefined) continue;
      const h: Ref<Item> = f.items[holder]!;
      const key = f.items[use]!.key;
      const other = key === "left" ? h.right : key === "right" ? h.left : undefined;
      const counting = (h.kind === "index" && key === "index") || (h.kind === "binary" && COMPARES.has(h.op) && kindAt(f, other) === "member" && nameAt(f, other) === "length");
      if (!counting) continue;
      const b = resolve(f, scopes, use);
      if (b === undefined) continue;
      let target: usize | undefined = undefined;
      if (b.kind === "let") {
        const d: Ref<Item> = f.items[b.declarator]!;
        const init = d.init;
        const numeric = typeName(f, d.type, "number") || (d.type === undefined && init !== undefined && literalKind(f, init) === "number");
        if (numeric) target = d.target;
      } else if (b.kind === "param" && f.items[b.fn]!.hasBody && typeName(f, f.items[b.param]!.type, "number")) target = f.items[b.param]!.pattern;
      if (target === undefined || f.items[target]!.kind !== "ident" || seen.has(target)) continue;
      seen.add(target);
      hits.push(guide("G3", f.items[target]!.start, f.items[target]!.end));
    }
  }
  return hits;
}

const VALUES = new Set(["object", "array", "new", "call"]);
// Past any offset a file can have, for a scope without its text.
const BEYOND: usize = 9007199254740991;

// G11's state while it looks through a file: whether each name is declared only with a value
// that isn't a primitive, and each name's changes, in source order, worked out once per name.
type AliasCache = { known: Map<string, boolean>; changes: Map<string, usize[]> };

// G11: a plain local alias, `const b = a` or `b = a`, of a value that isn't a primitive, after
// which one name changes it while the other is still used. `a` counts when the file declares it
// only with an object, an array, a `new` or a call; uses are those in the alias's scope.
function aliases(f: Ref<File>): Hit[] {
  let hits: Hit[] = [];
  let cache: AliasCache = { known: new Map<string, boolean>(), changes: new Map<string, usize[]>() };
  for (const n of f.order) {
    const x: Ref<Item> = f.items[n]!;
    if (x.kind === "let") {
      for (const d of x.declarations) {
        const target = f.items[d]!.target!;
        const init = f.items[d]!.init;
        if (f.items[target]!.kind === "ident" && init !== undefined && f.items[init]!.kind === "ident") {
          const hit = aliasHit(f, cache, nameAt(f, target)!, nameAt(f, init)!, { start: f.items[target]!.start, end: f.items[init]!.end }, n);
          if (hit !== undefined) hits.push(hit);
        }
      }
    }
    if (x.kind === "assign" && x.op === "=" && kindAt(f, x.target) === "ident" && kindAt(f, x.value) === "ident") {
      const hit = aliasHit(f, cache, nameAt(f, x.target)!, nameAt(f, x.value)!, { start: x.start, end: x.end }, n);
      if (hit !== undefined) hits.push(hit);
    }
  }
  return hits;
}

function valued(f: Ref<File>, cache: Mut<AliasCache>, name: string): boolean {
  const known = cache.known.get(name);
  if (known !== undefined) return known;
  let inits: (usize | undefined)[] = [];
  const lets = f.lets.get(name);
  if (lets !== undefined) {
    for (const n of lets) {
      if (f.items[n]!.kind !== "let") {
        inits.push(undefined);
        continue;
      }
      for (const d of f.items[n]!.declarations) if (named(f, f.items[d]!.target, name)) inits.push(f.items[d]!.init);
    }
  }
  const value = inits.length > 0 && inits.every((init) => init !== undefined && VALUES.has(f.items[init]!.kind));
  cache.known.set(name, value);
  return value;
}

function changesOf(f: Ref<File>, cache: Mut<AliasCache>, name: string): usize[] {
  const had = cache.changes.get(name);
  if (had !== undefined) return had;
  let found: usize[] = [];
  const uses = f.idents.get(name);
  if (uses !== undefined) {
    for (const u of uses) {
      const m = mutation(f, u);
      if (m !== undefined) found.push(m);
    }
  }
  found.sort((a, b) => (f.items[a]!.start < f.items[b]!.start ? -1 : f.items[a]!.start > f.items[b]!.start ? 1 : 0));
  cache.changes.set(name, found.slice());
  return found;
}

// The first node of `list`, sorted by start, starting at or after `from` and inside `scope`,
// found by binary search and a walk that stops at the first.
function firstIn(f: Ref<File>, list: Ref<usize[]>, from: usize, scope: Ref<Span>): usize | undefined {
  let lo: usize = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (f.items[list[mid]!]!.start < from) lo = mid + 1;
    else hi = mid;
  }
  for (let i = lo; i < list.length && f.items[list[i]!]!.start < scope.end; i++) if (f.items[list[i]!]!.end <= scope.end) return list[i]!;
  return undefined;
}

function aliasHit(f: Ref<File>, cache: Mut<AliasCache>, alias: string, value: string, at: Span, node: usize): Hit | undefined {
  if (alias === value || !valued(f, cache, value)) return undefined;
  const fn = functionOf(f, node);
  const scope: Span = fn !== undefined ? spanOf(f, fn) : { start: 0, end: f.src.length > 0 ? f.src.length : BEYOND };
  if (changedThenUsed(f, cache, alias, value, at, scope) || changedThenUsed(f, cache, value, alias, at, scope)) return { rule: "G11", action: "guided", start: at.start, end: at.end, message: `'${alias}' and '${value}' ${guideText("G11")}` };
  return undefined;
}

// Whether `changing` is changed after `at` and `other` used after that change, within `scope`.
function changedThenUsed(f: Ref<File>, cache: Mut<AliasCache>, changing: string, other: string, at: Ref<Span>, scope: Ref<Span>): boolean {
  const change = firstIn(f, changesOf(f, cache, changing), at.end, scope);
  if (change === undefined) return false;
  const uses = f.idents.get(other);
  return uses !== undefined && firstIn(f, uses, f.items[change]!.end, scope) !== undefined;
}

// The node changing what the name at `use` holds, if it does: an assignment, update or `delete`
// through a member or element of it, a known mutating method called on it, or `Object.assign` onto it.
function mutation(f: Ref<File>, use: usize): usize | undefined {
  let top = use;
  let holder = f.items[use]!.parent;
  while (holder !== undefined && (f.items[holder]!.kind === "member" || f.items[holder]!.kind === "index") && f.items[top]!.key === "object") {
    top = holder;
    holder = f.items[top]!.parent;
  }
  if (holder === undefined) return undefined;
  const h: Ref<Item> = f.items[holder]!;
  const key = f.items[top]!.key;
  if (top !== use) {
    if (h.kind === "assign" && key === "target") return holder;
    if ((h.kind === "update" || (h.kind === "unary" && h.op === "delete")) && key === "operand") return holder;
    const name = f.items[top]!.name;
    if (f.items[top]!.kind === "member" && name !== undefined && MUTATORS.has(name) && h.kind === "call" && key === "callee") return holder;
  }
  const callee = h.callee;
  if (h.kind === "call" && key === "args" && h.args.length > 0 && h.args[0] === use && callee !== undefined && f.items[callee]!.kind === "member" && named(f, f.items[callee]!.object, "Object") && f.items[callee]!.name === "assign") return holder;
  return undefined;
}
