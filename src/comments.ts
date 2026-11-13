// Attaching comments to the tree as Prettier attaches them: each comment finds the innermost node
// enclosing it and its nearest preceding and following children, and is then placed as a
// leading, trailing or dangling comment by Prettier's own-line, end-of-line and remaining rules.

import type { Comment } from "./lexer.ts";
import type { Stmt } from "./parser.ts";
import { nextId, type Ids } from "./ids.ts";
import { forEachNamedChild, nodeIdOf, type AnyNode } from "./walk.ts";

export type Placement = "leading" | "trailing" | "dangling";
// `beforeArrow` marks a comment dangling just before an arrow's `=>`, printed there rather than
// in its parameters.
// `ownLine` says whether the comment starts its line.
// `node` is the id of what it is attached to, and `ancestors` the ids of the nodes enclosing it,
// innermost first, which the printer falls back on if `node` never prints it. `index` is its place
// in `Attachment.all`.
export type Placed = {
  comment: Comment; placement: Placement; printed: boolean; ownLine: boolean; node: usize; ancestors: usize[]; beforeArrow: boolean; index: usize;
};

// A braced statement list the tree keeps only as an array: a function's body, an `if`'s
// branches, a class's members. Its span runs from `{` to `}`, found in the source, and its id is
// its own, apart from every node's.
export type Block = { id: usize; start: usize; end: usize };

export type Attachment = {
  // Each node's comments by its id, as indices into `all`, in source order.
  byNode: Map<usize, usize[]>;
  // The block standing for each braced list, by `blockKey` of the node holding it and its field,
  // so the printer finds what attached to it.
  blocks: Map<string, Block>;
  all: Placed[];
  root: Block;
  // Each comment's start by its end, for reading the source backwards past them.
  commentStarts: Map<usize, usize>;
  // Whether the program holds a pipe, which the printer reads as a binary `|>`.
  hasPipes: boolean;
};

// The key of the block for the list in field `field` of the node `owner` names.
export function blockKey(owner: usize, field: string): string {
  return `${owner} ${field}`;
}

// A node as attachment sees it, or a block: its tag and kind where it has one, its fields by
// name, each the shapes it holds, and its children in source order. `stmts` marks a statement
// list, and `block` the shape of the block standing for it.
type Field = { name: string; items: usize[]; stmts: boolean; block: i64 };
type Shape = { id: usize; of: string; kind: string; start: usize; end: usize; fields: Field[]; children: usize[] };

// The tree laid out as shapes, each child before the node holding it, the root last.
class Tree {
  src: string;
  commentAt: Map<usize, usize>;
  commentStarts: Map<usize, usize>;
  shapes: Shape[];
  blocks: Map<string, Block>;
  // The next character past whitespace and comments, by where the search starts.
  next: Map<usize, string>;
  hasPipes: boolean;
  constructor(src: string, comments: Ref<Comment[]>) {
    this.src = src;
    let at = new Map<usize, usize>();
    let starts = new Map<usize, usize>();
    for (const c of comments) {
      at.set(c.start, c.end);
      starts.set(c.end, c.start);
    }
    this.commentAt = at;
    this.commentStarts = starts;
    this.shapes = [];
    this.blocks = new Map<string, Block>();
    this.next = new Map<usize, string>();
    this.hasPipes = false;
  }
}

// Fields that hold a package's declarations, which aren't source.
const skipped = new Set(["js", "jsClass", "jsSource"]);

// Arrays of statements that a block holds, by the field they sit in; a bare body (`if (a) b;`)
// is its statement alone.
const bodyFields = new Set(["body", "then", "else", "block", "handler", "finalizer"]);

// The fields of a class, an interface and an enum written before their members, after which an
// empty member list, which the walk doesn't give, goes.
const beforeMembers = new Set(["decorators", "typeParams", "extends", "implements"]);

function spanOf(n: Ref<AnyNode>): [usize, usize] {
  switch (n.of) {
    case "typeNode": return [n.node.start, n.node.end];
    case "expr": return [n.node.start, n.node.end];
    case "stmt": return [n.node.start, n.node.end];
    case "tupleElement": return [n.node.start, n.node.end];
    case "typeMember": return [n.node.start, n.node.end];
    case "objectProp": return [n.node.start, n.node.end];
    case "classNode": return [n.node.start, n.node.end];
    case "classMember": return [n.node.start, n.node.end];
    case "param": return [n.node.start, n.node.end];
    case "pattern": return [n.node.start, n.node.end];
    case "matchArm": return [n.node.start, n.node.end];
    case "patternProp": return [n.node.start, n.node.end];
    case "specifier": return [n.node.start, n.node.end];
    case "enumMember": return [n.node.start, n.node.end];
    case "switchCase": return [n.node.start, n.node.end];
    case "declarator": return [n.node.start, n.node.end];
    case "typeParam": return [n.node.start, n.node.end];
    case "typeAlias": return [n.node.start, n.node.end];
    case "interface": return [n.node.start, n.node.end];
    case "func": return [n.node.start, n.node.end];
    default: return [0, 0];
  }
}

// A node's kind, or "" for the node types that have none.
function kindOf(n: Ref<AnyNode>): string {
  switch (n.of) {
    case "typeNode": return n.node.kind;
    case "expr": return n.node.kind;
    case "stmt": return n.node.kind;
    case "typeMember": return n.node.kind;
    case "objectProp": return n.node.kind;
    case "classMember": return n.node.kind;
    case "pattern": return n.node.kind;
    case "typeAlias": return n.node.kind;
    case "interface": return n.node.kind;
    case "func": return n.node.kind;
    default: return "";
  }
}

// Lays out `n` and everything under it in `t`, giving its shape.
function build(t: Mut<Tree>, ids: Mut<Ids>, n: AnyNode): usize {
  const [start, end] = spanOf(n);
  const kind = kindOf(n);
  const id = nodeIdOf(n) as usize;
  const of: string = n.of;
  if (of === "expr" && kind === "pipe") t.hasPipes = true;
  let fields: Field[] = [];
  forEachNamedChild(n, (name, c) => {
    if (skipped.has(name)) return;
    if (c.of === "stmts") {
      let items: usize[] = [];
      for (const s of c.node) items.push(build(t, ids, { of: "stmt", node: s }));
      fields.push({ name, items, stmts: true, block: -1 });
      return;
    }
    const item = build(t, ids, c);
    const last = fields.length - 1;
    if (fields.length > 0 && fields[last]!.name === name && !fields[last]!.stmts) fields[last]!.items.push(item);
    else fields.push({ name, items: [item], stmts: false, block: -1 });
  });
  if ((of === "stmt" || of === "expr") && (kind === "class" || kind === "interface" || kind === "enum") && !fields.some((f) => f.name === "members")) {
    let at: usize = 0;
    for (let i: usize = 0; i < fields.length; i++) if (beforeMembers.has(fields[i]!.name)) at = i + 1;
    fields.splice(at as i64, 0, { name: "members", items: [], stmts: false, block: -1 });
  }
  // A node's children as Prettier's getSortedChildNodes gives them: a list the source braces is
  // replaced by its block.
  let found: usize[] = [];
  let laid: Field[] = [];
  const owner: Owner = { id, of, kind, start, end };
  while (fields.length > 0) {
    const f = fields.shift()!;
    const braced = f.stmts || f.name === "members" ? bracedList(t, ids, owner, f, found) : -1;
    if (braced >= 0) found.push(braced as usize);
    else {
      // An empty statement holds a comment only in a list, as in `for (;;);`.
      for (const i of f.items) if (f.stmts || t.shapes[i]!.kind !== "empty") found.push(i);
    }
    laid.push({ name: f.name, items: f.items, stmts: f.stmts, block: braced });
  }
  const children = sorted(t, found);
  t.shapes.push({ id, of, kind, start, end, fields: laid, children });
  return t.shapes.length - 1;
}

type Owner = { id: usize; of: string; kind: string; start: usize; end: usize };

// `xs` in source order, the earlier first, then the shorter, as a stable sort keeps them.
function sorted(t: Ref<Tree>, xs: Ref<usize[]>): usize[] {
  // Children mostly come in source order already, and then need no sort.
  let inOrder = true;
  for (let i: usize = 1; i < xs.length && inOrder; i++) {
    const a: Ref<Shape> = t.shapes[xs[i - 1]!]!;
    const b: Ref<Shape> = t.shapes[xs[i]!]!;
    if (a.start > b.start || (a.start === b.start && a.end > b.end)) inOrder = false;
  }
  if (inOrder) return xs.slice();
  let keyed: [usize, usize, usize][] = [];
  for (const i of xs) keyed.push([t.shapes[i]!.start, t.shapes[i]!.end, i]);
  keyed.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  let out: usize[] = [];
  for (const k of keyed) out.push(k[2]);
  return out;
}

// The block standing for the list `f` of `owner`, when the source braces it, or -1.
function bracedList(t: Mut<Tree>, ids: Mut<Ids>, owner: Ref<Owner>, f: Ref<Field>, siblings: Ref<usize[]>): i64 {
  const ownerKind = owner.kind;
  const statements = f.stmts && bodyFields.has(f.name) && ownerKind !== "block" && ownerKind !== "$block" && owner.of !== "switchCase";
  const members = f.name === "members" && (ownerKind === "class" || ownerKind === "interface" || ownerKind === "enum");
  if (!statements && !members) return -1;
  const count = f.items.length;
  // A bare body, written without braces, is its statement alone.
  if (statements && count === 1) {
    const before = ownerKind === "doWhile" ? "do" : f.name === "else" ? "else" : ")";
    const isMember = owner.of === "classMember" || owner.of === "param";
    if (follows(t.src, t.shapes[f.items[0]!]!.start, before, t.commentStarts) && ownerKind !== "function" && ownerKind !== "arrow" && !isMember) return -1;
  }
  // The `{` follows whatever of the owner comes before the list.
  const limit = count > 0 ? t.shapes[f.items[0]!]!.start : owner.end;
  let from = owner.start;
  for (const s of siblings) {
    const e = t.shapes[s]!.end;
    if (e <= limit && e > from) from = e;
  }
  const open = scanFor(t, from, "{", false);
  if (open < 0) return -1;
  const close = scanFor(t, count > 0 ? t.shapes[f.items[count - 1]!]!.end : (open as usize) + 1, "}", true);
  if (close < 0) return -1;
  let inside: usize[] = [];
  for (const i of f.items) if (t.shapes[i]!.kind !== "empty") inside.push(i);
  const children = sorted(t, inside);
  const id = nextId(ids);
  const block: Block = { id, start: open as usize, end: (close as usize) + 1 };
  t.blocks.set(blockKey(owner.id, f.name), block);
  t.shapes.push({ id, of: "$block", kind: "$block", start: open as usize, end: (close as usize) + 1, fields: [{ name: "body", items: f.items.slice(), stmts: f.stmts, block: -1 }], children });
  return (t.shapes.length - 1) as i64;
}

// The position of `ch` from `from` on, past whitespace, comments, string literals and, when
// `separators`, the `;` and `,` that end members; -1 if something else comes first that
// can't come before it.
function scanFor(t: Ref<Tree>, from: usize, ch: string, separators: boolean): i64 {
  const src = t.src;
  let i = from;
  while (i < src.length) {
    const commentEnd = t.commentAt.get(i);
    if (commentEnd !== undefined) {
      i = commentEnd;
      continue;
    }
    const c = src.charAt(i as i64);
    if (c === ch) return i as i64;
    if (separators) {
      if (/\s|[;,]/.test(c)) i++;
      else return -1;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      i++;
      while (i < src.length && src.charAt(i as i64) !== c) i += src.charAt(i as i64) === "\\" ? 2 : 1;
    }
    i++;
  }
  return -1;
}

// Whether `word` ends just before `at`, past whitespace, opening parentheses and the comments
// `commentStarts` gives the start of by their end.
export function follows(src: string, at: usize, word: string, commentStarts: Ref<Map<usize, usize>>): boolean {
  let i = at;
  while (true) {
    while (i > 0 && /[\s(]/.test(src.charAt((i - 1) as i64))) i--;
    const start = commentStarts.get(i);
    if (start === undefined) break;
    i = start;
  }
  return i >= word.length && src.slice((i - word.length) as i64, i as i64) === word;
}

// Prettier's hasNewline: a line break right after `at`, or right before it going `backwards`,
// past spaces and tabs.
export function hasNewline(src: string, at: usize, backwards = false): boolean {
  if (backwards) {
    let i = (at as i64) - 1;
    while (i >= 0 && (src.charAt(i as i64) === " " || src.charAt(i as i64) === "\t")) i--;
    return i >= 0 && (src.charAt(i as i64) === "\n" || src.charAt(i as i64) === "\r");
  }
  let i = at;
  while (i < src.length && (src.charAt(i as i64) === " " || src.charAt(i as i64) === "\t")) i++;
  return i < src.length && (src.charAt(i as i64) === "\n" || src.charAt(i as i64) === "\r");
}

function hasNewlineInRange(src: string, from: usize, to: usize): boolean {
  for (let i = from; i < to; i++) if (src.charAt(i as i64) === "\n") return true;
  return false;
}

// Prettier's isNextLineEmpty: past the rest of the line (`,` and `;`, block comments and a line
// comment), whether the next line is blank.
export function isNextLineEmpty(src: string, at: usize): boolean {
  let i = at;
  let previous: i64 = -1;
  while ((i as i64) !== previous) {
    previous = i as i64;
    while (i < src.length && /[,; \t]/.test(src.charAt(i as i64))) i++;
    if (src.startsWith("/*", i as i64)) {
      const close = src.indexOf("*/", (i + 2) as i64);
      if (close !== -1) i = (close as usize) + 2;
    }
    while (i < src.length && (src.charAt(i as i64) === " " || src.charAt(i as i64) === "\t")) i++;
  }
  if (src.startsWith("//", i as i64)) while (i < src.length && src.charAt(i as i64) !== "\n" && src.charAt(i as i64) !== "\r") i++;
  if (src.charAt(i as i64) === "\r" && src.charAt((i + 1) as i64) === "\n") i += 2;
  else if (src.charAt(i as i64) === "\n" || src.charAt(i as i64) === "\r") i++;
  else return false;
  return hasNewline(src, i);
}

// Prettier's isPreviousLineEmpty: whether the line before the one holding `at` is blank.
export function isPreviousLineEmpty(src: string, at: usize): boolean {
  let i = (at as i64) - 1;
  while (i >= 0 && (src.charAt(i as i64) === " " || src.charAt(i as i64) === "\t")) i--;
  if (i < 0 || src.charAt(i as i64) !== "\n") return false;
  i--;
  if (i >= 0 && src.charAt(i as i64) === "\r") i--;
  while (i >= 0 && (src.charAt(i as i64) === " " || src.charAt(i as i64) === "\t")) i--;
  return i >= 0 && src.charAt(i as i64) === "\n";
}

// The next character past whitespace and comments, remembered per comment end in `t`, so each
// comment in a long run is skipped once rather than once per comment before it.
function nextCharacter(t: Mut<Tree>, at: usize): string {
  const src = t.src;
  let path: usize[] = [];
  let i = at;
  let found = "";
  while (true) {
    const known = t.next.get(i);
    if (known !== undefined) {
      found = known;
      break;
    }
    path.push(i);
    while (i < src.length && /\s/.test(src.charAt(i as i64))) i++;
    if (src.startsWith("//", i as i64)) {
      while (i < src.length && src.charAt(i as i64) !== "\n") i++;
    } else if (src.startsWith("/*", i as i64)) {
      const close = src.indexOf("*/", (i + 2) as i64);
      i = close === -1 ? src.length : (close as usize) + 2;
    } else {
      found = src.charAt(i as i64);
      break;
    }
  }
  for (const p of path) t.next.set(p, found);
  return found;
}

function onlySpaces(text: string): boolean {
  return !/[\S\n\u2028\u2029]/.test(text);
}

// The innermost shape enclosing a comment, and its nearest children before and after it; -1
// for none. `ancestors` are the shapes enclosing it, innermost first.
type Decorated = { enclosing: i64; preceding: i64; following: i64; ancestors: usize[] };

/** @throws {Error} */
function decorate(t: Ref<Tree>, node: usize, comment: Ref<Comment>, enclosing: i64, ancestors: usize[]): Decorated {
  const children: Ref<usize[]> = t.shapes[node]!.children;
  let preceding: i64 = -1;
  let following: i64 = -1;
  let left: usize = 0;
  let right = children.length;
  while (left < right) {
    const middle = (left + right) >> 1;
    const child = children[middle]!;
    const c: Ref<Shape> = t.shapes[child]!;
    if (c.start <= comment.start && comment.end <= c.end) {
      let inner = [child];
      for (const a of ancestors) inner.push(a);
      return decorate(t, child, comment, child as i64, inner);
    }
    if (c.end <= comment.start) {
      preceding = child as i64;
      left = middle + 1;
    } else if (comment.end <= c.start) {
      following = child as i64;
      right = middle;
    } else {
      throw new Error(`a comment at ${comment.start} overlaps a node at ${c.start}`);
    }
  }
  // In a template literal, a comment belongs with the substitution it sits in.
  if (enclosing >= 0 && t.shapes[enclosing as usize]!.of === "expr" && t.shapes[enclosing as usize]!.kind === "template") {
    let opens: i64[] = [];
    for (const x of itemsOf(t, enclosing, "exprs")) opens.push(t.src.lastIndexOf("${", t.shapes[x]!.start as i64));
    const index = substitution(opens, comment.start as i64);
    if (preceding >= 0 && substitution(opens, t.shapes[preceding as usize]!.start as i64) !== index) preceding = -1;
    if (following >= 0 && substitution(opens, t.shapes[following as usize]!.start as i64) !== index) following = -1;
  }
  return { enclosing, preceding, following, ancestors };
}

// Which of a template's substitutions, opening at `opens`, holds `at`.
function substitution(opens: Ref<i64[]>, at: i64): i64 {
  let n: i64 = 0;
  for (const o of opens) if (o < at) n++;
  return n - 1;
}

// Prettier's own-line and end-of-line tests, which look past neighbouring comments that share
// the preceding (or following) node with only spaces between. Each run is measured once from its
// end, so a long run of comments stays linear.
function placements(decorated: Ref<Decorated[]>, comments: Ref<Comment[]>, src: string): string[] {
  const n = decorated.length;
  let runStart: usize[] = [];
  for (let i: usize = 0; i < n; i++) {
    const shares = i > 0 && sharesRun(decorated[i - 1]!.preceding, decorated[i]!.preceding, comments[i - 1]!, comments[i]!, src);
    runStart.push(shares ? runStart[i - 1]! : comments[i]!.start);
  }
  let runEnd: usize[] = [];
  for (let i: usize = 0; i < n; i++) runEnd.push(0);
  for (let i = n; i > 0; i--) {
    const k = i - 1;
    const shares = k + 1 < n && sharesRun(decorated[k]!.following, decorated[k + 1]!.following, comments[k]!, comments[k + 1]!, src);
    runEnd[k] = shares ? runEnd[k + 1]! : comments[k]!.end;
  }
  let out: string[] = [];
  for (let i: usize = 0; i < n; i++) out.push(hasNewline(src, runStart[i]!, true) ? "ownLine" : hasNewline(src, runEnd[i]!) ? "endOfLine" : "remaining");
  return out;
}

function sharesRun(a: i64, b: i64, first: Ref<Comment>, second: Ref<Comment>, src: string): boolean {
  return a >= 0 && a === b && onlySpaces(src.slice(first.end as i64, second.start as i64));
}

function copyComment(c: Ref<Comment>): Comment {
  return { kind: c.kind, text: c.text, start: c.start, end: c.end };
}

// What placing comments collects: each comment's placement, by the node it is attached to.
class Attacher {
  tree: Tree;
  all: Placed[];
  byNode: Map<usize, usize[]>;
  // Each comment's enclosing nodes' ids, and where its placement is in `all`, by its index.
  ancestorsOf: usize[][];
  placedOf: Map<usize, usize>;
  root: usize;
  constructor(tree: Tree, root: usize) {
    this.tree = tree;
    this.all = [];
    this.byNode = new Map<usize, usize[]>();
    this.ancestorsOf = [];
    this.placedOf = new Map<usize, usize>();
    this.root = root;
  }

  add(this: Mut<this>, node: i64, ci: usize, comment: Ref<Comment>, placement: Placement, beforeArrow = false) {
    const id = this.tree.shapes[node as usize]!.id;
    const ownLine = hasNewline(this.tree.src, comment.start, true);
    const at = this.all.length;
    this.all.push({ comment: copyComment(comment), placement, printed: false, ownLine, node: id, ancestors: this.ancestorsOf[ci]!.slice(), beforeArrow, index: at });
    this.placedOf.set(ci, at);
    let list = listOf(this.byNode, id);
    list.push(at);
    this.byNode.set(id, list);
  }
}

// The comment being placed, and where it sits.
type Context = { e: i64; p: i64; f: i64; ci: usize; comment: Comment; placement: string; isLast: boolean };

function put(a: Mut<Attacher>, c: Ref<Context>, node: i64, placement: Placement, beforeArrow = false) {
  a.add(node, c.ci, c.comment, placement, beforeArrow);
}

/** @throws {Error} */
export function attach(program: Ref<Stmt[]>, comments: Ref<Comment[]>, src: string, ids: Mut<Ids>): Attachment {
  let t = new Tree(src, comments);
  let items: usize[] = [];
  for (const s of program) items.push(build(t, ids, { of: "stmt", node: s }));
  let inside: usize[] = [];
  for (const i of items) if (t.shapes[i]!.kind !== "empty") inside.push(i);
  const children = sorted(t, inside);
  const rootId = nextId(ids);
  t.shapes.push({ id: rootId, of: "$block", kind: "$block", start: 0, end: src.length, fields: [{ name: "body", items, stmts: true, block: -1 }], children });
  const root = t.shapes.length - 1;
  let decorated: Decorated[] = [];
  let ancestorsOf: usize[][] = [];
  for (const comment of comments) {
    const d = decorate(t, root, comment, root as i64, [root]);
    let shown: usize[] = [];
    for (const x of d.ancestors) shown.push(t.shapes[x]!.id);
    ancestorsOf.push(shown);
    decorated.push(d);
  }
  const placed = placements(decorated, comments, src);
  let a = new Attacher(t, root);
  a.ancestorsOf = ancestorsOf;
  let ties: usize[] = [];
  for (let index: usize = 0; index < decorated.length; index++) {
    const d: Ref<Decorated> = decorated[index]!;
    const c: Context = { e: d.enclosing, p: d.preceding, f: d.following, ci: index, comment: copyComment(comments[index]!), placement: placed[index]!, isLast: index === comments.length - 1 };
    const fallback: i64 = c.e >= 0 ? c.e : root as i64;
    if (c.placement === "ownLine") {
      if (handleOwnLine(a, c)) continue;
      if (c.f >= 0) put(a, c, c.f, "leading");
      else if (c.p >= 0) put(a, c, c.p, "trailing");
      else put(a, c, fallback, "dangling");
    } else if (c.placement === "endOfLine") {
      if (handleEndOfLine(a, c)) continue;
      if (c.p >= 0) put(a, c, c.p, "trailing");
      else if (c.f >= 0) put(a, c, c.f, "leading");
      else put(a, c, fallback, "dangling");
    } else {
      if (handleRemaining(a, c)) continue;
      if (c.p >= 0 && c.f >= 0) {
        if (ties.length > 0 && decorated[ties[ties.length - 1]!]!.following !== c.f) {
          breakTies(a, ties, decorated, comments);
          ties = [];
        }
        ties.push(index);
      } else if (c.p >= 0) put(a, c, c.p, "trailing");
      else if (c.f >= 0) put(a, c, c.f, "leading");
      else put(a, c, fallback, "dangling");
    }
  }
  breakTies(a, ties, decorated, comments);
  // A comment that would trail the node before a gap, after one in the same gap that leads the
  // node after it, leads that node too, so the two keep their order.
  for (let i: usize = 1; i < decorated.length; i++) {
    const before: Ref<Decorated> = decorated[i - 1]!;
    const d: Ref<Decorated> = decorated[i]!;
    if (d.preceding !== before.preceding || d.following < 0 || d.following !== before.following || d.preceding < 0) continue;
    const previous = a.placedOf.get(i - 1)!;
    const current = a.placedOf.get(i)!;
    const followingId = a.tree.shapes[d.following as usize]!.id;
    const precedingId = a.tree.shapes[d.preceding as usize]!.id;
    if (a.all[previous]!.placement === "leading" && a.all[previous]!.node === followingId && a.all[current]!.placement === "trailing" && a.all[current]!.node === precedingId) {
      const from = listOf(a.byNode, precedingId);
      a.byNode.set(precedingId, from.filter((x) => x !== current));
      a.all[current]!.node = followingId;
      a.all[current]!.placement = "leading";
      let to = listOf(a.byNode, followingId);
      to.push(current);
      a.byNode.set(followingId, to);
    }
  }
  let keys: usize[] = [];
  for (const k of a.byNode.keys()) keys.push(k);
  for (const k of keys) a.byNode.set(k, inSourceOrder(a.all, listOf(a.byNode, k)));
  const rootShape: Ref<Shape> = a.tree.shapes[root]!;
  const rootBlock: Block = { id: rootShape.id, start: rootShape.start, end: rootShape.end };
  return { byNode: a.byNode, blocks: a.tree.blocks, all: a.all, root: rootBlock, commentStarts: a.tree.commentStarts, hasPipes: a.tree.hasPipes };
}

// The comments `byNode` holds for `id`, none when it holds none.
function listOf(byNode: Ref<Map<usize, usize[]>>, id: usize): usize[] {
  const list = byNode.get(id);
  if (list === undefined) return [];
  return list;
}

// Indices into `all` sorted by where their comments start, ties kept in order.
function inSourceOrder(all: Ref<Placed[]>, list: usize[]): usize[] {
  let keyed: [usize, usize][] = [];
  for (const i of list) keyed.push([all[i]!.comment.start, i]);
  keyed.sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
  let out: usize[] = [];
  for (const k of keyed) out.push(k[1]);
  return out;
}

// Comments between the same two nodes, which the ones before the gap's last run of
// parentheses and whitespace trail and the rest lead.
function breakTies(a: Mut<Attacher>, ties: Ref<usize[]>, decorated: Ref<Decorated[]>, comments: Ref<Comment[]>) {
  if (ties.length === 0) return;
  const first: Ref<Decorated> = decorated[ties[0]!]!;
  const preceding = first.preceding;
  const following = first.following;
  let gapEnd = a.tree.shapes[following as usize]!.start;
  let firstLeading = ties.length;
  for (; firstLeading > 0; firstLeading--) {
    const comment: Ref<Comment> = comments[ties[firstLeading - 1]!]!;
    if (!/^[\s(]*$/.test(a.tree.src.slice(comment.end as i64, gapEnd as i64))) break;
    gapEnd = comment.start;
  }
  for (let i: usize = 0; i < ties.length; i++) {
    const ci = ties[i]!;
    if (i < firstLeading) a.add(preceding, ci, comments[ci]!, "trailing");
    else a.add(following, ci, comments[ci]!, "leading");
  }
}

// Moves each comment `moves` names, by its index in `all`, to lead the node with the id beside
// it, for a comment its first node didn't print. Done as one batch, filtering and sorting each
// touched list once, since a file can lose thousands of comments to the same node.
export function moveToLeading(attachment: Mut<Attachment>, moves: Ref<[usize, usize][]>) {
  let moved = new Set<usize>();
  let touched = new Set<usize>();
  for (const m of moves) {
    moved.add(m[0]);
    touched.add(attachment.all[m[0]]!.node);
  }
  for (const n of touched) attachment.byNode.set(n, listOf(attachment.byNode, n).filter((p) => !moved.has(p)));
  let targets = new Set<usize>();
  for (const m of moves) {
    const p = m[0];
    const node = m[1];
    attachment.all[p]!.node = node;
    attachment.all[p]!.placement = "leading";
    attachment.all[p]!.beforeArrow = false;
    let to = listOf(attachment.byNode, node);
    to.push(p);
    attachment.byNode.set(node, to);
    targets.add(node);
  }
  for (const n of targets) attachment.byNode.set(n, inSourceOrder(attachment.all, listOf(attachment.byNode, n)));
}

function kindAt(t: Ref<Tree>, i: i64): string {
  return i < 0 ? "" : t.shapes[i as usize]!.kind;
}

function ofAt(t: Ref<Tree>, i: i64): string {
  return i < 0 ? "" : t.shapes[i as usize]!.of;
}

function startAt(t: Ref<Tree>, i: i64): usize {
  return t.shapes[i as usize]!.start;
}

function endAt(t: Ref<Tree>, i: i64): usize {
  return t.shapes[i as usize]!.end;
}

function fieldAt(t: Ref<Tree>, s: i64, name: string): i64 {
  if (s < 0) return -1;
  const fields: Ref<Field[]> = t.shapes[s as usize]!.fields;
  for (let i: usize = 0; i < fields.length; i++) if (fields[i]!.name === name) return i as i64;
  return -1;
}

// The node in `s`'s field `name`, or -1 when it holds none.
function one(t: Ref<Tree>, s: i64, name: string): i64 {
  const f = fieldAt(t, s, name);
  if (f < 0) return -1;
  const field: Ref<Field> = t.shapes[s as usize]!.fields[f as usize]!;
  return field.stmts || field.items.length === 0 ? -1 : field.items[0]! as i64;
}

// The nodes `s`'s field `name` holds, in order.
function itemsOf(t: Ref<Tree>, s: i64, name: string): usize[] {
  const f = fieldAt(t, s, name);
  if (f < 0) return [];
  return t.shapes[s as usize]!.fields[f as usize]!.items.slice();
}

function includes(xs: Ref<usize[]>, x: i64): boolean {
  return x >= 0 && xs.includes(x as usize);
}

// The block standing for `s`'s list `name`, or -1.
function blockOf(t: Ref<Tree>, s: i64, name: string): i64 {
  const f = fieldAt(t, s, name);
  return f < 0 ? -1 : t.shapes[s as usize]!.fields[f as usize]!.block;
}

// The node standing for `owner`'s field `key`: its block, or its bare statement.
function bodyOf(t: Ref<Tree>, owner: i64, key: string): i64 {
  const f = fieldAt(t, owner, key);
  if (f < 0) return -1;
  const field: Ref<Field> = t.shapes[owner as usize]!.fields[f as usize]!;
  if (!field.stmts) return field.items.length > 0 ? field.items[0]! as i64 : -1;
  if (field.block >= 0) return field.block;
  return field.items.length === 1 ? field.items[0]! as i64 : -1;
}

function isBlockComment(c: Ref<Comment>): boolean {
  return c.kind === "block";
}

function isBlockNode(t: Ref<Tree>, n: i64): boolean {
  return kindAt(t, n) === "$block" || kindAt(t, n) === "block";
}

// A comment moved into a block: before its first statement, or dangling when it is empty.
function intoBlock(a: Mut<Attacher>, c: Ref<Context>, block: i64) {
  let first: i64 = -1;
  for (const s of itemsOf(a.tree, block, "body")) {
    if (a.tree.shapes[s]!.kind !== "empty") {
      first = s as i64;
      break;
    }
  }
  if (first >= 0) put(a, c, first, "leading");
  else put(a, c, block, "dangling");
}

// Comments in an `if`: before `else` they trail the branch or dangle on the `if`, and in front of
// a branch they lead it.
function handleIf(a: Mut<Attacher>, c: Ref<Context>): boolean {
  const e = c.e;
  const p = c.p;
  const f = c.f;
  const src = a.tree.src;
  if (kindAt(a.tree, e) !== "if" || f < 0) return false;
  if (nextCharacter(a.tree, c.comment.end) === ")") {
    if (p >= 0) put(a, c, p, "trailing");
    else put(a, c, e, "dangling");
    return true;
  }
  const consequent = bodyOf(a.tree, e, "then");
  if (f === consequent) {
    put(a, c, f, "leading");
    return true;
  }
  if (p >= 0 && p === consequent && f === bodyOf(a.tree, e, "else")) {
    const elseAt = src.indexOf("else", (endAt(a.tree, p)) as i64);
    if ((c.comment.start as i64) >= elseAt) put(a, c, f, "leading");
    else if (!isBlockNode(a.tree, p) && (!isBlockComment(c.comment) || !hasNewlineInRange(src, c.comment.start, c.comment.end)) && !hasNewlineInRange(src, endAt(a.tree, p), c.comment.start)) {
      put(a, c, p, "trailing");
    } else put(a, c, e, "dangling");
    return true;
  }
  return false;
}

function handleWhile(a: Mut<Attacher>, c: Ref<Context>): boolean {
  if (kindAt(a.tree, c.e) !== "while" || c.f < 0) return false;
  if (nextCharacter(a.tree, c.comment.end) === ")") {
    if (c.p >= 0) put(a, c, c.p, "trailing");
    else put(a, c, c.e, "dangling");
    return true;
  }
  if (c.f === bodyOf(a.tree, c.e, "body")) {
    put(a, c, c.f, "leading");
    return true;
  }
  return false;
}

// An arm's comment after `=>` leads its body, as after an arrow's.
function handleArmBody(a: Mut<Attacher>, c: Ref<Context>): boolean {
  const f = c.f;
  if (ofAt(a.tree, c.e) !== "matchArm" || f < 0 || f !== one(a.tree, c.e, "body") || (c.comment.start as i64) < a.tree.src.lastIndexOf("=>", (startAt(a.tree, f)) as i64)) return false;
  if (isBlockNode(a.tree, f)) intoBlock(a, c, f);
  else put(a, c, f, "leading");
  return true;
}

// In a `match` with no arms, a comment dangles inside its braces.
function handleEmptyMatch(a: Mut<Attacher>, c: Ref<Context>): boolean {
  const e = c.e;
  if (kindAt(a.tree, e) === "match" && itemsOf(a.tree, e, "arms").length === 0 && c.f < 0 && c.p >= 0 && c.p === one(a.tree, e, "subject") && nextCharacter(a.tree, c.comment.end) === "}") {
    put(a, c, e, "dangling");
    return true;
  }
  return false;
}

function handleEmptySwitch(a: Mut<Attacher>, c: Ref<Context>): boolean {
  const e = c.e;
  if (kindAt(a.tree, e) === "switch" && itemsOf(a.tree, e, "cases").length === 0 && c.f < 0 && c.p >= 0 && c.p === one(a.tree, e, "discriminant") && nextCharacter(a.tree, c.comment.end) === "}") {
    put(a, c, e, "dangling");
    return true;
  }
  return false;
}

// In a `try`, a comment ahead of a block moves into it; one after a `catch` binding trails it.
function handleTry(a: Mut<Attacher>, c: Ref<Context>): boolean {
  const e = c.e;
  const p = c.p;
  const f = c.f;
  if (kindAt(a.tree, e) !== "try" || f < 0) return false;
  if (p >= 0 && (p === one(a.tree, e, "param") || p === one(a.tree, e, "paramType")) && f === bodyOf(a.tree, e, "handler")) {
    put(a, c, p, "trailing");
    return true;
  }
  if (isBlockNode(a.tree, f)) {
    intoBlock(a, c, f);
    return true;
  }
  const handler = bodyOf(a.tree, e, "handler");
  if (f === one(a.tree, e, "param") && handler >= 0) {
    intoBlock(a, c, handler);
    return true;
  }
  return false;
}

function handleForBody(a: Mut<Attacher>, c: Ref<Context>): boolean {
  const k = kindAt(a.tree, c.e);
  const f = c.f;
  if ((k === "for" || k === "forIn" || k === "forOf") && f >= 0 && f === bodyOf(a.tree, c.e, "body")) {
    if ((c.comment.start as i64) > a.tree.src.lastIndexOf(")", (startAt(a.tree, f)) as i64)) {
      put(a, c, f, "leading");
      return true;
    }
  }
  return false;
}

function handleLabeled(a: Mut<Attacher>, c: Ref<Context>): boolean {
  if (kindAt(a.tree, c.e) !== "labeled") return false;
  put(a, c, c.e, "leading");
  return true;
}

// Around a class's header, a comment after its decorators trails the last of them, and one just
// before the body moves into it.
function handleClass(a: Mut<Attacher>, c: Ref<Context>): boolean {
  const e = c.e;
  const p = c.p;
  const f = c.f;
  const k = kindAt(a.tree, e);
  if (k !== "class" && k !== "interface") return false;
  const decorators = itemsOf(a.tree, e, "decorators");
  if (decorators.length > 0 && !includes(decorators, f)) {
    put(a, c, decorators[decorators.length - 1]! as i64, "trailing");
    return true;
  }
  const body = blockOf(a.tree, e, "members");
  if (body >= 0 && f === body) {
    intoBlock(a, c, body);
    return true;
  }
  if (f >= 0) {
    // An interface's `extends` is a list, which isn't a node, so only a class has a heritage.
    let heritage: usize[] = [];
    if (k === "class") {
      heritage = itemsOf(a.tree, e, "extends");
      for (const x of itemsOf(a.tree, e, "implements")) heritage.push(x);
    }
    if (includes(heritage, f)) {
      if (p >= 0) put(a, c, p, "trailing");
      else put(a, c, e, "dangling");
      return true;
    }
  }
  return false;
}

function handleMember(a: Mut<Attacher>, c: Ref<Context>): boolean {
  const e = c.e;
  const p = c.p;
  if (ofAt(a.tree, e) !== "classMember") return false;
  if (c.f < 0 && c.placement === "remaining") {
    const target = nextCharacter(a.tree, c.comment.end) === "(" && p >= 0 ? p : e;
    put(a, c, target, "trailing");
    return true;
  }
  if (p >= 0 && includes(itemsOf(a.tree, e, "decorators"), p) && (!isBlockComment(c.comment) || c.placement === "ownLine")) {
    put(a, c, p, "trailing");
    return true;
  }
  return false;
}

// `default:` followed by a comment keeps it on the `default:` line.
function handleDefaultCase(a: Mut<Attacher>, c: Ref<Context>): boolean {
  const e = c.e;
  const f = c.f;
  if (ofAt(a.tree, e) !== "switchCase" || one(a.tree, e, "test") >= 0 || f < 0) return false;
  const body = itemsOf(a.tree, e, "body");
  if (body.length === 0 || f !== (body[0]! as i64)) return false;
  if (kindAt(a.tree, f) === "block" && !isBlockComment(c.comment)) intoBlock(a, c, f);
  else put(a, c, e, "dangling");
  return true;
}

// A comment after the end of an expression statement's expression trails the statement.
function handleTrailingStatement(a: Mut<Attacher>, c: Ref<Context>): boolean {
  const e = c.e;
  const p = c.p;
  if (c.f >= 0 || e < 0 || p < 0) return false;
  const k = kindAt(a.tree, e);
  if (k === "expr" && one(a.tree, e, "expr") === p) {
    put(a, c, e, "trailing");
    return true;
  }
  const sequence = kindAt(a.tree, p) === "sequence";
  const assign = kindAt(a.tree, p) === "assign";
  const holder = (k === "arrow" && one(a.tree, e, "body") === p) || (one(a.tree, e, "init") === p && !(k === "for" || ofAt(a.tree, e) === "switchCase")) ||
    (k === "return" && one(a.tree, e, "value") === p) || (k === "assign" && one(a.tree, e, "value") === p);
  if ((sequence || assign) && holder) {
    const exprs = itemsOf(a.tree, p, "exprs");
    const target = sequence ? exprs[exprs.length - 1]! as i64 : one(a.tree, p, "value");
    put(a, c, target, "trailing");
    return true;
  }
  return false;
}

// After a declarator's or parameter's `:`, a comment leads the type, as it sits in Prettier's
// type annotation node.
function handleTypeAnnotation(a: Mut<Attacher>, c: Ref<Context>): boolean {
  const e = c.e;
  const f = c.f;
  const of = ofAt(a.tree, e);
  if (e < 0 || f < 0 || one(a.tree, e, "type") !== f || !(of === "param" || of === "declarator" || of === "classMember")) return false;
  const colon = a.tree.src.lastIndexOf(":", (startAt(a.tree, f)) as i64);
  if (colon === -1 || (c.comment.start as i64) < colon) return false;
  put(a, c, f, "leading");
  return true;
}

// A comment ahead of a function's or method's parameter list, around a name the tree keeps no
// node for, leads the whole function rather than moving past its parameters.
function handleFunctionHead(a: Mut<Attacher>, c: Ref<Context>): boolean {
  const e = c.e;
  const p = c.p;
  const f = c.f;
  const of = ofAt(a.tree, e);
  const k = kindAt(a.tree, e);
  const head = ((of === "expr" || of === "stmt") && k === "function") || (of === "objectProp" && (k === "method" || k === "get" || k === "set")) ||
    (of === "classMember" && (k === "method" || k === "constructor" || k === "get" || k === "set"));
  if (!head) return false;
  const decorators = itemsOf(a.tree, e, "decorators");
  const typeParams = itemsOf(a.tree, e, "typeParams");
  if (p >= 0 && !includes(decorators, p) && !includes(typeParams, p)) return false;
  let from = startAt(a.tree, e);
  for (const d of decorators) if (a.tree.shapes[d]!.end > from) from = a.tree.shapes[d]!.end;
  for (const x of typeParams) if (a.tree.shapes[x]!.end > from) from = a.tree.shapes[x]!.end;
  const open = scanFor(a.tree, from, "(", false);
  if (open < 0 || (c.comment.end as i64) > open || (f >= 0 && (startAt(a.tree, f) as i64) < open)) return false;
  put(a, c, e, "leading");
  return true;
}

// A file of nothing but comments keeps them, the last dangling.
function handleEmptyProgram(a: Mut<Attacher>, c: Ref<Context>): boolean {
  const root = a.root as i64;
  if (itemsOf(a.tree, root, "body").length !== 0) return false;
  put(a, c, root, c.isLast ? "dangling" : "leading");
  return true;
}

// A line comment right before a function's body moves into it.
function handleBeforeBody(a: Mut<Attacher>, c: Ref<Context>): boolean {
  const e = c.e;
  const f = c.f;
  const src = a.tree.src;
  if (isBlockComment(c.comment) || e < 0 || f < 0 || kindAt(a.tree, f) !== "$block") return false;
  const isFunction = kindAt(a.tree, e) === "function" || ofAt(a.tree, e) === "classMember" || hasParams(a.tree, e);
  if (!isFunction || blockOf(a.tree, e, "body") !== f) return false;
  let i = c.comment.end;
  while (i < src.length && /\s/.test(src.charAt(i as i64))) i++;
  if (i !== startAt(a.tree, f)) return false;
  intoBlock(a, c, f);
  return true;
}

// Whether `n` has parameters, as functions, methods and signatures do.
function hasParams(t: Ref<Tree>, n: i64): boolean {
  const of = ofAt(t, n);
  const k = kindAt(t, n);
  if (of === "expr") return k === "function" || k === "arrow";
  if (of === "stmt" || of === "typeNode") return k === "function";
  if (of === "typeMember") return k !== "property";
  if (of === "objectProp") return k === "method" || k === "get" || k === "set";
  if (of === "classMember") return k !== "field" && k !== "staticBlock";
  return false;
}

// What kind of node `n` is where kinds are shared between expressions, statements, types and
// patterns. A call signature in a type counts as a call with no arguments, as Prettier reads it.
function isCall(t: Ref<Tree>, n: i64): boolean {
  const of = ofAt(t, n);
  const k = kindAt(t, n);
  return (of === "expr" && (k === "call" || k === "new" || k === "import")) || (of === "typeMember" && k === "call");
}

function isFunctionLike(t: Ref<Tree>, n: i64): boolean {
  return hasParams(t, n) && kindAt(t, n) !== "index";
}

function isUnion(t: Ref<Tree>, n: i64): boolean {
  return ofAt(t, n) === "typeNode" && kindAt(t, n) === "union";
}

function isLineLike(c: Ref<Comment>, src: string): boolean {
  return !isBlockComment(c) || !hasNewlineInRange(src, c.start, c.end);
}

// Whether `comment` lies inside `(` and `)` with nothing but whitespace and comments around it.
function insideEmptyParens(t: Ref<Tree>, node: i64, comment: Ref<Comment>): boolean {
  const src = t.src;
  if (comment.start <= startAt(t, node) || comment.end >= endAt(t, node)) return false;
  let before = comment.start;
  while (true) {
    while (before > 0 && /\s/.test(src.charAt((before - 1) as i64))) before--;
    const start = t.commentStarts.get(before);
    if (start === undefined) break;
    before = start;
  }
  let after = comment.end;
  while (true) {
    while (after < src.length && /\s/.test(src.charAt(after as i64))) after++;
    const end = t.commentAt.get(after);
    if (end === undefined) break;
    after = end;
  }
  return before > 0 && src.charAt((before - 1) as i64) === "(" && src.charAt(after as i64) === ")";
}

// A comment inside the empty `()` of a call or a function dangles on it.
function handleEmptyParens(a: Mut<Attacher>, c: Ref<Context>): boolean {
  const e = c.e;
  if (e < 0) return false;
  if (isCall(a.tree, e) && itemsOf(a.tree, e, "args").length === 0 && insideEmptyParens(a.tree, e, c.comment)) {
    put(a, c, e, "dangling");
    return true;
  }
  if (isFunctionLike(a.tree, e) && itemsOf(a.tree, e, "params").length === 0 && insideEmptyParens(a.tree, e, c.comment)) {
    put(a, c, e, "dangling");
    return true;
  }
  return false;
}

// In a conditional, a comment on its own line, or with nothing before it, leads the branch after it.
function handleConditional(a: Mut<Attacher>, c: Ref<Context>): boolean {
  const p = c.p;
  const sameLine = p >= 0 && !hasNewlineInRange(a.tree.src, endAt(a.tree, p), c.comment.start);
  if ((p < 0 || !sameLine) && kindAt(a.tree, c.e) === "conditional" && c.f >= 0) {
    put(a, c, c.f, "leading");
    return true;
  }
  return false;
}

// A comment before a parameter list's `)` trails the last parameter.
function handleLastParameter(a: Mut<Attacher>, c: Ref<Context>): boolean {
  const p = c.p;
  if (p >= 0 && isFunctionLike(a.tree, c.e) && includes(itemsOf(a.tree, c.e, "params"), p) && nextCharacter(a.tree, c.comment.end) === ")") {
    put(a, c, p, "trailing");
    return true;
  }
  return false;
}

// `a // c` above `.b`: the comment leads the lookup, so a member chain keeps it with `.b`.
function handleMemberProperty(a: Mut<Attacher>, c: Ref<Context>): boolean {
  if (kindAt(a.tree, c.e) === "member" && c.p >= 0 && c.p === one(a.tree, c.e, "object") && c.f < 0) {
    put(a, c, c.e, "leading");
    return true;
  }
  return false;
}

// Before an index's `[`, a comment trails the object, as one at the end of the object's line
// does, so formatting again doesn't move it inside the brackets.
function handleBeforeIndex(a: Mut<Attacher>, c: Ref<Context>): boolean {
  const p = c.p;
  if (kindAt(a.tree, c.e) !== "index" || p < 0 || p !== one(a.tree, c.e, "object")) return false;
  const open = a.tree.src.indexOf("[", (endAt(a.tree, p)) as i64);
  if (open === -1 || (c.comment.start as i64) > open) return false;
  put(a, c, p, "trailing");
  return true;
}

// Inside `<...>` type arguments, a comment before the first leads it.
function handleTypeArguments(a: Mut<Attacher>, c: Ref<Context>): boolean {
  const e = c.e;
  const f = c.f;
  const k = kindAt(a.tree, e);
  let args: usize[] = [];
  if (ofAt(a.tree, e) === "expr" && (k === "tagged" || k === "call" || k === "new" || k === "instantiation")) args = itemsOf(a.tree, e, "typeArgs");
  else if (k === "ref") args = itemsOf(a.tree, e, "args");
  else return false;
  if (f < 0 || args.length === 0 || (args[0]! as i64) !== f) return false;
  const open = a.tree.src.lastIndexOf("<", (startAt(a.tree, f)) as i64);
  if (open === -1 || (c.comment.start as i64) < open) return false;
  put(a, c, f, "leading");
  return true;
}

function handleUnion(a: Mut<Attacher>, c: Ref<Context>): boolean {
  if ((isUnion(a.tree, c.e) || kindAt(a.tree, c.e) === "or") && c.p >= 0) {
    put(a, c, c.p, "trailing");
    return true;
  }
  return false;
}

// Around an import or export specifier list.
function handleSpecifiers(a: Mut<Attacher>, c: Ref<Context>): boolean {
  const e = c.e;
  const p = c.p;
  const src = a.tree.src;
  if (ofAt(a.tree, e) === "specifier") {
    put(a, c, e, "leading");
    return true;
  }
  // The default or namespace name has no node; a comment after it trails the import.
  const k = kindAt(a.tree, e);
  const declaration = k === "import" && (ofAt(a.tree, e) === "stmt" || ofAt(a.tree, e) === "typeNode");
  if (declaration && p < 0 && (c.comment.start as i64) < src.indexOf("{", (startAt(a.tree, e)) as i64)) {
    put(a, c, e, "trailing");
    return true;
  }
  if (ofAt(a.tree, p) === "specifier" && (k === "import" || k === "exportNamed") && hasNewline(src, c.comment.end)) {
    put(a, c, p, "trailing");
    return true;
  }
  return false;
}

function handleDefaultPattern(a: Mut<Attacher>, c: Ref<Context>): boolean {
  if (ofAt(a.tree, c.e) === "pattern" && kindAt(a.tree, c.e) === "default") {
    put(a, c, c.e, "leading");
    return true;
  }
  return false;
}

// A comment before a mapped type's `[` dangles inside its braces.
function handleMapped(a: Mut<Attacher>, c: Ref<Context>): boolean {
  if (kindAt(a.tree, c.e) === "mapped" && (c.comment.end as i64) < a.tree.src.indexOf("[", (startAt(a.tree, c.e)) as i64)) {
    put(a, c, c.e, "dangling");
    return true;
  }
  return false;
}

// Between a mapped type's parts, a comment leads the part after it, so formatting again keeps it
// there.
function handleMappedParts(a: Mut<Attacher>, c: Ref<Context>): boolean {
  if (kindAt(a.tree, c.e) !== "mapped" || c.f < 0) return false;
  put(a, c, c.f, "leading");
  return true;
}

// Between `x as` and its type a comment trails the expression, or leads the type.
function handleAsExpression(a: Mut<Attacher>, c: Ref<Context>): boolean {
  const e = c.e;
  const p = c.p;
  const f = c.f;
  const k = kindAt(a.tree, e);
  if (k !== "as" && k !== "satisfies") return false;
  const src = a.tree.src;
  const onExpr = p >= 0 && p === one(a.tree, e, "expr");
  // After the `as` itself, a comment leads the type, so formatting again doesn't move it.
  if (onExpr && f >= 0 && src.slice((endAt(a.tree, p)) as i64, c.comment.start as i64).includes(k)) {
    put(a, c, f, "leading");
    return true;
  }
  if (onExpr && !isLineLike(c.comment, src)) {
    if (f >= 0) put(a, c, f, "leading");
    else put(a, c, e, "trailing");
    return true;
  }
  return false;
}

// A one-line block comment just before a union leads its first member.
function unionLead(t: Ref<Tree>, f: i64, c: Ref<Context>): boolean {
  if (!isUnion(t, f) || !isBlockComment(c.comment) || hasNewlineInRange(t.src, c.comment.start, c.comment.end)) return false;
  return /^[ \t]*$/.test(t.src.slice(c.comment.end as i64, (startAt(t, f)) as i64));
}

function firstOf(t: Ref<Tree>, n: i64, name: string): i64 {
  const xs = itemsOf(t, n, name);
  return xs.length > 0 ? xs[0]! as i64 : -1;
}

function handleBeforeUnion(a: Mut<Attacher>, c: Ref<Context>): boolean {
  if (!unionLead(a.tree, c.f, c)) return false;
  const first = firstOf(a.tree, c.f, "types");
  put(a, c, first, "leading");
  return true;
}

// `/** @type {T} */ (x)`: a type cast comment leads what follows it.
function handleTypeCast(a: Mut<Attacher>, c: Ref<Context>): boolean {
  if (c.f >= 0 && isBlockComment(c.comment) && c.comment.text.charAt(2) === "*" && /@(?:type|satisfies)\b/.test(c.comment.text)) {
    put(a, c, c.f, "leading");
    return true;
  }
  return false;
}

// `f( // c` before the first argument leads that argument.
function handleCallOpen(a: Mut<Attacher>, c: Ref<Context>): boolean {
  const e = c.e;
  const p = c.p;
  const args = itemsOf(a.tree, e, "args");
  if (!isCall(a.tree, e) || p < 0 || p !== one(a.tree, e, "callee") || args.length === 0) return false;
  const open = a.tree.src.indexOf("(", (endAt(a.tree, p)) as i64);
  if (open === -1 || (c.comment.start as i64) <= open || c.comment.end > a.tree.shapes[args[0]!]!.start) return false;
  put(a, c, args[0]! as i64, "leading");
  return true;
}

function handleObjectProperty(a: Mut<Attacher>, c: Ref<Context>): boolean {
  if (ofAt(a.tree, c.e) !== "objectProp" || kindAt(a.tree, c.e) !== "property") return false;
  put(a, c, c.e, "leading");
  return true;
}

// After `=` in an assignment, declarator or type alias, an end-of-line comment before an object,
// array or template, or any block comment, leads the value.
function handleAssignment(a: Mut<Attacher>, c: Ref<Context>): boolean {
  const e = c.e;
  const f = c.f;
  if (f < 0) return false;
  const k = kindAt(a.tree, e);
  const fk = kindAt(a.tree, f);
  const fo = ofAt(a.tree, f);
  const lead = unionLead(a.tree, f, c) ? firstOf(a.tree, f, "types") : f;
  const assignmentLike = ofAt(a.tree, e) === "declarator" || k === "assign";
  const equals = k === "typeAlias" ? a.tree.src.indexOf("=", startAt(a.tree, e) as i64) : -1;
  if (assignmentLike && c.placement === "endOfLine" &&
    ((fo === "expr" && (fk === "object" || fk === "array")) || fk === "template" || fk === "tagged" || (fo === "typeNode" && fk === "object") || isBlockComment(c.comment))) {
    put(a, c, lead, "leading");
    return true;
  }
  if (k === "typeAlias" && (c.comment.start as i64) >= equals) {
    put(a, c, lead, "leading");
    return true;
  }
  return false;
}

// A comment after a union inside an array type, an intersection or a union trails its last member.
function handleAfterUnion(a: Mut<Attacher>, c: Ref<Context>): boolean {
  const e = c.e;
  const p = c.p;
  const k = kindAt(a.tree, e);
  if (isUnion(a.tree, p) && ((ofAt(a.tree, e) === "typeNode" && k === "array" && c.f < 0) || k === "intersection" || isUnion(a.tree, e))) {
    const types = itemsOf(a.tree, p, "types");
    put(a, c, types[types.length - 1]! as i64, "trailing");
    return true;
  }
  return false;
}

// After `=>`, a comment moves into the body.
function handleArrowBody(a: Mut<Attacher>, c: Ref<Context>): boolean {
  const e = c.e;
  const f = c.f;
  if (kindAt(a.tree, e) !== "arrow" || f < 0 || c.p < 0) return false;
  const body = bodyOfArrow(a.tree, e);
  if (body < 0 || (c.comment.end as i64) < a.tree.src.lastIndexOf("=>", (startAt(a.tree, body)) as i64)) return false;
  if (isBlockNode(a.tree, f)) intoBlock(a, c, f);
  else put(a, c, f, "leading");
  return true;
}

// An arrow's body: its block when it is a list of statements, else its expression.
function bodyOfArrow(t: Ref<Tree>, e: i64): i64 {
  const f = fieldAt(t, e, "body");
  if (f < 0) return -1;
  const field: Ref<Field> = t.shapes[e as usize]!.fields[f as usize]!;
  if (field.stmts) return field.block;
  return field.items.length > 0 ? field.items[0]! as i64 : -1;
}

// A comment just before an arrow's `=>` dangles there.
function handleBeforeArrow(a: Mut<Attacher>, c: Ref<Context>): boolean {
  if (kindAt(a.tree, c.e) !== "arrow") return false;
  const src = a.tree.src;
  let i = c.comment.end;
  while (i < src.length && /\s/.test(src.charAt(i as i64))) i++;
  if (!src.startsWith("=>", i as i64)) return false;
  put(a, c, c.e, "dangling", true);
  return true;
}

function handlePropertySignatureUnion(a: Mut<Attacher>, c: Ref<Context>): boolean {
  if (ofAt(a.tree, c.e) === "typeMember" && kindAt(a.tree, c.e) === "property" && (isUnion(a.tree, c.f) || kindAt(a.tree, c.f) === "intersection")) {
    put(a, c, c.f, "leading");
    return true;
  }
  return false;
}

// `f /* c */ (` in a function trails what comes before the `(`.
function handleBeforeParams(a: Mut<Attacher>, c: Ref<Context>): boolean {
  const e = c.e;
  const of = ofAt(a.tree, e);
  const k = kindAt(a.tree, e);
  const fn = ((of === "expr" || of === "stmt") && k === "function") || of === "classMember" || (of === "objectProp" && k === "method");
  if (c.p < 0 || !fn || nextCharacter(a.tree, c.comment.end) !== "(") return false;
  put(a, c, c.p, "trailing");
  return true;
}

// A comment before a bodiless signature's `;` trails the signature.
function handleSignatureEnd(a: Mut<Attacher>, c: Ref<Context>): boolean {
  const e = c.e;
  const p = c.p;
  const of = ofAt(a.tree, e);
  const k = kindAt(a.tree, e);
  const bodiless = fieldAt(a.tree, e, "body") < 0;
  const signature = (of === "typeMember" && k === "method") || (of === "stmt" && k === "function" && bodiless) || (of === "classMember" && bodiless);
  if (c.f >= 0 || !signature) return false;
  const returns = fieldAt(a.tree, e, "returns") >= 0 ? one(a.tree, e, "returns") : one(a.tree, e, "returnType");
  if ((p >= 0 && p === returns) || nextCharacter(a.tree, c.comment.end) !== ";") return false;
  put(a, c, e, "trailing");
  return true;
}

// Each placement's handlers, in the order Prettier's estree printer tries them.
function handleOwnLine(a: Mut<Attacher>, c: Ref<Context>): boolean {
  return handleFunctionHead(a, c) || handleTypeAnnotation(a, c) || handleTypeArguments(a, c) || handleEmptyParens(a, c) || handleConditional(a, c) ||
    handleLastParameter(a, c) || handleBeforeBody(a, c) || handleMemberProperty(a, c) || handleBeforeIndex(a, c) || handleIf(a, c) || handleWhile(a, c) ||
    handleEmptySwitch(a, c) || handleEmptyMatch(a, c) || handleArmBody(a, c) || handleTry(a, c) || handleClass(a, c) || handleForBody(a, c) ||
    handleUnion(a, c) || handleEmptyProgram(a, c) || handleSpecifiers(a, c) || handleDefaultPattern(a, c) || handleMember(a, c) || handleLabeled(a, c) ||
    handleMapped(a, c) || handleMappedParts(a, c) || handleAsExpression(a, c) || handleBeforeUnion(a, c);
}

function handleEndOfLine(a: Mut<Attacher>, c: Ref<Context>): boolean {
  return handleFunctionHead(a, c) || handleTypeAnnotation(a, c) || handleTypeArguments(a, c) || handleEmptyParens(a, c) || handleTypeCast(a, c) ||
    handleLastParameter(a, c) || handleBeforeBody(a, c) || handleConditional(a, c) || handleSpecifiers(a, c) || handleIf(a, c) || handleWhile(a, c) ||
    handleEmptySwitch(a, c) || handleEmptyMatch(a, c) || handleArmBody(a, c) || handleTry(a, c) || handleClass(a, c) || handleForBody(a, c) ||
    handleLabeled(a, c) || handleCallOpen(a, c) || handleObjectProperty(a, c) || handleEmptyProgram(a, c) || handleAssignment(a, c) ||
    handleDefaultCase(a, c) || handleAfterUnion(a, c) || handleMapped(a, c) || handleMappedParts(a, c) || handleArrowBody(a, c) ||
    handleTrailingStatement(a, c) || handlePropertySignatureUnion(a, c) || handleAsExpression(a, c);
}

function handleRemaining(a: Mut<Attacher>, c: Ref<Context>): boolean {
  return handleFunctionHead(a, c) || handleTypeAnnotation(a, c) || handleTypeArguments(a, c) || handleEmptyParens(a, c) || handleIf(a, c) ||
    handleWhile(a, c) || handleEmptySwitch(a, c) || handleEmptyMatch(a, c) || handleArmBody(a, c) || handleForBody(a, c) || handleMember(a, c) ||
    handleEmptyProgram(a, c) || handleAssignment(a, c) || handleMapped(a, c) || handleMappedParts(a, c) || handleBeforeArrow(a, c) ||
    handleBeforeParams(a, c) || handleSignatureEnd(a, c) || handleTrailingStatement(a, c) || handleAsExpression(a, c) || handleBeforeUnion(a, c);
}
