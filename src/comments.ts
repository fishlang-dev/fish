// Attaching comments to the tree as Prettier attaches them: each comment finds the innermost node
// enclosing it and its nearest preceding and following children, and is then placed as a
// leading, trailing or dangling comment by Prettier's own-line, end-of-line and remaining rules.

import type { Comment } from "./lexer.ts";
import type { Stmt } from "./parser.ts";

export type Placement = "leading" | "trailing" | "dangling";
// `beforeArrow` marks a comment dangling just before an arrow's `=>`, printed there rather than
// in its parameters.
// `ownLine` says whether the comment starts its line.
// `node` is what it is attached to, and `ancestors` the nodes enclosing it, innermost first, which
// the printer falls back on if `node` never prints it.
export type Placed = {
  comment: Comment; placement: Placement; printed: boolean; ownLine: boolean; node: object; ancestors: object[]; beforeArrow?: boolean;
};

// A node as attachment sees it: anything with a span, plus the blocks the tree has no node for.
type Node = { start: number; end: number; kind?: string } & Record<string, unknown>;

// A braced statement list the tree keeps only as an array: a function's body, an `if`'s
// branches, a class's members. Its span runs from `{` to `}`, found in the source.
export type Block = { kind: "$block"; body: unknown[]; start: number; end: number };

export type Attachment = {
  // Each node's comments, in source order.
  byNode: Map<object, Placed[]>;
  // The block standing for each braced list, so the printer finds what attached to it.
  blocks: Map<unknown[], Block>;
  all: Placed[];
  root: Block;
  // Each comment's start by its end, for reading the source backwards past them.
  commentStarts: Map<number, number>;
};

const isNode = (v: unknown): v is Node =>
  typeof v === "object" && v !== null && !Array.isArray(v) && typeof (v as Node).start === "number" && typeof (v as Node).end === "number";

// Fields that hold a package's declarations or what a macro gave, which aren't source.
const skipped = new Set(["js", "jsClass", "jsSource", "derives"]);

// Arrays of statements that a block holds, by the field they sit in; a bare body (`if (a) b;`)
// is its statement alone.
const bodyFields = new Set(["body", "then", "else", "block", "handler", "finalizer"]);

export function attach(program: Stmt[], comments: Comment[], src: string): Attachment {
  const commentStarts = new Map(comments.map((c) => [c.end, c.start]));
  const ctx: Ctx = { src, comments, commentAt: new Map(comments.map((c) => [c.start, c.end])), commentStarts, blocks: new Map(), children: new Map(), next: new Map() };
  const root: Block = { kind: "$block", body: program, start: 0, end: src.length };
  ctx.blocks.set(program, root);
  const byNode = new Map<object, Placed[]>();
  const all: Placed[] = [];
  const ancestorsOf = new Map<Comment, object[]>();
  const add = (node: object, comment: Comment, placement: Placement, beforeArrow = false) => {
    const placed: Placed = {
      comment, placement, printed: false, ownLine: hasNewline(src, comment.start, true), node, ancestors: ancestorsOf.get(comment) ?? [root],
      ...(beforeArrow && { beforeArrow }),
    };
    all.push(placed);
    const list = byNode.get(node) ?? [];
    list.push(placed);
    byNode.set(node, list);
  };
  const decorated = comments.map((comment) => {
    const d = decorate(root, comment, ctx, root, [root]);
    ancestorsOf.set(comment, d.ancestors);
    return { comment, ...d };
  });
  const ties: typeof decorated = [];
  const breakTies = () => {
    if (ties.length === 0) return;
    const { precedingNode, followingNode } = ties[0]!;
    let gapEnd = followingNode!.start;
    let firstLeading = ties.length;
    for (; firstLeading > 0; firstLeading--) {
      const { comment } = ties[firstLeading - 1]!;
      if (!/^[\s(]*$/.test(src.slice(comment.end, gapEnd))) break;
      gapEnd = comment.start;
    }
    ties.forEach(({ comment }, i) => add(i < firstLeading ? precedingNode! : followingNode!, comment, i < firstLeading ? "trailing" : "leading"));
    ties.length = 0;
  };
  const placed = placements(decorated, src);
  decorated.forEach((d, index) => {
    const placement = placed[index]!;
    const context: Context = { ...d, src, placement, root, isLast: index === comments.length - 1, add, ctx };
    if (placement === "ownLine") {
      if (handleOwnLine(context)) return;
      if (d.followingNode) add(d.followingNode, d.comment, "leading");
      else if (d.precedingNode) add(d.precedingNode, d.comment, "trailing");
      else add(d.enclosingNode ?? root, d.comment, "dangling");
    } else if (placement === "endOfLine") {
      if (handleEndOfLine(context)) return;
      if (d.precedingNode) add(d.precedingNode, d.comment, "trailing");
      else if (d.followingNode) add(d.followingNode, d.comment, "leading");
      else add(d.enclosingNode ?? root, d.comment, "dangling");
    } else {
      if (handleRemaining(context)) return;
      if (d.precedingNode && d.followingNode) {
        const last = ties[ties.length - 1];
        if (last && last.followingNode !== d.followingNode) breakTies();
        ties.push(d);
      } else if (d.precedingNode) add(d.precedingNode, d.comment, "trailing");
      else if (d.followingNode) add(d.followingNode, d.comment, "leading");
      else add(d.enclosingNode ?? root, d.comment, "dangling");
    }
  });
  breakTies();
  // A comment that would trail the node before a gap, after one in the same gap that leads the
  // node after it, leads that node too, so the two keep their order.
  const placedOf = new Map(all.map((p) => [p.comment, p]));
  for (let i = 1; i < decorated.length; i++) {
    const before = decorated[i - 1]!;
    const d = decorated[i]!;
    const previous = placedOf.get(before.comment)!;
    const current = placedOf.get(d.comment)!;
    if (d.precedingNode === before.precedingNode && d.followingNode && d.followingNode === before.followingNode &&
      previous.placement === "leading" && previous.node === d.followingNode && current.placement === "trailing" && current.node === d.precedingNode) {
      const from = byNode.get(current.node)!;
      from.splice(from.indexOf(current), 1);
      current.node = d.followingNode;
      current.placement = "leading";
      byNode.get(d.followingNode)!.push(current);
    }
  }
  for (const list of byNode.values()) list.sort((a, b) => a.comment.start - b.comment.start);
  return { byNode, blocks: ctx.blocks, all, root, commentStarts };
}

// Moves `placed` to lead `node`, for a comment its first node didn't print.
// Each comment in `moves` becomes a leading comment of its node. Done as one batch, filtering and
// sorting each touched list once, since a file can lose thousands of comments to the same node.
export function moveToLeading(attachment: Attachment, moves: [Placed, object][]) {
  const moved = new Set(moves.map(([p]) => p));
  const touched = new Set<object>();
  for (const [p] of moves) touched.add(p.node);
  for (const n of touched) attachment.byNode.set(n, attachment.byNode.get(n)!.filter((p) => !moved.has(p)));
  const targets = new Set<Placed[]>();
  for (const [p, node] of moves) {
    p.node = node;
    p.placement = "leading";
    p.beforeArrow = undefined;
    let to = attachment.byNode.get(node);
    if (!to) attachment.byNode.set(node, (to = []));
    to.push(p);
    targets.add(to);
  }
  for (const to of targets) to.sort((a, b) => a.comment.start - b.comment.start);
}

type Ctx = {
  src: string;
  comments: Comment[];
  commentAt: Map<number, number>;
  commentStarts: Map<number, number>;
  blocks: Map<unknown[], Block>;
  children: Map<object, Node[]>;
  // The next character past whitespace and comments, by where the search starts.
  next: Map<number, string>;
};

type Decorated = { enclosingNode: Node | undefined; precedingNode: Node | undefined; followingNode: Node | undefined; ancestors: Node[] };

function decorate(node: Node, comment: Comment, ctx: Ctx, enclosing: Node | undefined, ancestors: Node[]): Decorated {
  const children = childNodes(node, ctx);
  let precedingNode: Node | undefined;
  let followingNode: Node | undefined;
  let left = 0;
  let right = children.length;
  while (left < right) {
    const middle = (left + right) >> 1;
    const child = children[middle]!;
    if (child.start <= comment.start && comment.end <= child.end) return decorate(child, comment, ctx, child, [child, ...ancestors]);
    if (child.end <= comment.start) {
      precedingNode = child;
      left = middle + 1;
    } else if (comment.end <= child.start) {
      followingNode = child;
      right = middle;
    } else {
      throw new Error(`a comment at ${comment.start} overlaps a node at ${child.start}`);
    }
  }
  // In a template literal, a comment belongs with the substitution it sits in.
  if (enclosing?.kind === "template" && Array.isArray(enclosing.exprs)) {
    const exprs = enclosing.exprs as Node[];
    const opens = exprs.map((x) => ctx.src.lastIndexOf("${", x.start));
    const substitution = (at: number) => opens.filter((o) => o < at).length - 1;
    const index = substitution(comment.start);
    if (precedingNode && substitution(precedingNode.start) !== index) precedingNode = undefined;
    if (followingNode && substitution(followingNode.start) !== index) followingNode = undefined;
  }
  return { enclosingNode: enclosing, precedingNode, followingNode, ancestors };
}

// A node's children in source order, as Prettier's getSortedChildNodes gives them: a child that
// can't hold a comment is replaced by its own children.
function childNodes(node: Node, ctx: Ctx): Node[] {
  const cached = ctx.children.get(node);
  if (cached) return cached;
  const found: Node[] = [];
  const take = (v: unknown) => {
    if (!isNode(v)) return;
    if (v.kind === "empty") return;
    found.push(v);
  };
  if (node.kind === "$block") {
    (node.body as unknown[]).forEach(take);
  } else {
    for (const [key, value] of Object.entries(node)) {
      if (skipped.has(key)) continue;
      if (Array.isArray(value)) {
        const braced = bracedList(node, key, value, ctx, found);
        if (braced) found.push(braced);
        else for (const v of value) {
          // An empty statement holds a comment only as a body, as in `for (;;);`.
          if (isNode(v) && v.kind === "empty" && bodyFields.has(key)) found.push(v);
          else take(v);
        }
      } else {
        take(value);
      }
    }
  }
  found.sort((a, b) => a.start - b.start || a.end - b.end);
  ctx.children.set(node, found);
  return found;
}

// The block standing for `list` in `owner.key`, when the source braces it.
function bracedList(owner: Node, key: string, list: unknown[], ctx: Ctx, siblings: Node[]): Block | undefined {
  const known = ctx.blocks.get(list);
  if (known) return known;
  const ownerKind = owner.kind;
  const statements = bodyFields.has(key) && ownerKind !== "block" && ownerKind !== "$block" && !isSwitchCase(owner);
  const members = key === "members" && (ownerKind === "class" || ownerKind === "interface" || ownerKind === "enum");
  if (!statements && !members) return undefined;
  const first = list.find(isNode);
  // A bare body, written without braces, is its statement alone.
  if (statements && first && list.length === 1) {
    const before = ownerKind === "doWhile" ? "do" : key === "else" ? "else" : ")";
    if (follows(ctx.src, first.start, before, ctx.commentStarts) && ownerKind !== "function" && ownerKind !== "arrow" && !isMember(owner)) return undefined;
  }
  // The `{` follows whatever of the owner comes before the list.
  const limit = first ? first.start : owner.end;
  let from = owner.start;
  for (const s of siblings) if (s.end <= limit) from = Math.max(from, s.end);
  const open = scanFor(ctx, from, "{");
  if (open === undefined) return undefined;
  const items = list.filter(isNode);
  const last = items[items.length - 1];
  const close = scanFor(ctx, last ? last.end : open + 1, "}", true);
  if (close === undefined) return undefined;
  const block: Block = { kind: "$block", body: list, start: open, end: close + 1 };
  ctx.blocks.set(list, block);
  return block;
}

const isSwitchCase = (n: Node) => n.kind === undefined && "test" in n && Array.isArray(n.body);
const isMember = (n: Node) => "modifiers" in n && "decorators" in n;

// The position of `ch` from `from` on, past whitespace, comments, string literals and, when
// `separators`, the `;` and `,` that end members; undefined if something else comes first that
// can't come before it.
function scanFor(ctx: Ctx, from: number, ch: string, separators = false): number | undefined {
  const src = ctx.src;
  let i = from;
  while (i < src.length) {
    const commentEnd = ctx.commentAt.get(i);
    if (commentEnd !== undefined) {
      i = commentEnd;
      continue;
    }
    const c = src[i]!;
    if (c === ch) return i;
    if (separators) {
      if (/\s|[;,]/.test(c)) i++;
      else return undefined;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      i++;
      while (i < src.length && src[i] !== c) i += src[i] === "\\" ? 2 : 1;
    }
    i++;
  }
  return undefined;
}

// Whether `word` ends just before `at`, past whitespace, opening parentheses and the comments
// `commentStarts` gives the start of by their end.
export function follows(src: string, at: number, word: string, commentStarts?: Map<number, number>): boolean {
  let i = at;
  for (;;) {
    while (i > 0 && /[\s(]/.test(src[i - 1]!)) i--;
    const start = commentStarts?.get(i);
    if (start === undefined) break;
    i = start;
  }
  return src.slice(i - word.length, i) === word;
}

type Context = Decorated & {
  comment: Comment;
  src: string;
  placement: "ownLine" | "endOfLine" | "remaining";
  root: Block;
  isLast: boolean;
  add: (node: object, comment: Comment, placement: Placement, beforeArrow?: boolean) => void;
  ctx: Ctx;
};

const isBlockComment = (c: Comment) => c.kind === "block";

// Prettier's hasNewline: a line break right after `at`, or right before it going `backwards`,
// past spaces and tabs.
export function hasNewline(src: string, at: number, backwards = false): boolean {
  if (backwards) {
    let i = at - 1;
    while (i >= 0 && (src[i] === " " || src[i] === "\t")) i--;
    return i >= 0 && (src[i] === "\n" || src[i] === "\r");
  }
  let i = at;
  while (i < src.length && (src[i] === " " || src[i] === "\t")) i++;
  return i < src.length && (src[i] === "\n" || src[i] === "\r");
}

function hasNewlineInRange(src: string, from: number, to: number): boolean {
  for (let i = from; i < to; i++) if (src[i] === "\n") return true;
  return false;
}

// Prettier's isNextLineEmpty: past the rest of the line (`,` and `;`, block comments and a line
// comment), whether the next line is blank.
export function isNextLineEmpty(src: string, at: number): boolean {
  let i = at;
  let previous = -1;
  while (i !== previous) {
    previous = i;
    while (i < src.length && /[,; \t]/.test(src[i]!)) i++;
    if (src.startsWith("/*", i)) {
      const close = src.indexOf("*/", i + 2);
      if (close !== -1) i = close + 2;
    }
    while (i < src.length && (src[i] === " " || src[i] === "\t")) i++;
  }
  if (src.startsWith("//", i)) while (i < src.length && src[i] !== "\n" && src[i] !== "\r") i++;
  if (src[i] === "\r" && src[i + 1] === "\n") i += 2;
  else if (src[i] === "\n" || src[i] === "\r") i++;
  else return false;
  return hasNewline(src, i);
}

// Prettier's isPreviousLineEmpty: whether the line before the one holding `at` is blank.
export function isPreviousLineEmpty(src: string, at: number): boolean {
  let i = at - 1;
  while (i >= 0 && (src[i] === " " || src[i] === "\t")) i--;
  if (src[i] !== "\n") return false;
  i--;
  if (src[i] === "\r") i--;
  while (i >= 0 && (src[i] === " " || src[i] === "\t")) i--;
  return src[i] === "\n";
}

// The next character past whitespace and comments, remembered per comment end in `ctx`, so each
// comment in a long run is skipped once rather than once per comment before it.
function nextCharacter({ src, next }: Ctx, at: number): string {
  const path: number[] = [];
  let i = at;
  let found: string | undefined;
  for (;;) {
    found = next.get(i);
    if (found !== undefined) break;
    path.push(i);
    while (i < src.length && /\s/.test(src[i]!)) i++;
    if (src.startsWith("//", i)) {
      while (i < src.length && src[i] !== "\n") i++;
    } else if (src.startsWith("/*", i)) {
      const close = src.indexOf("*/", i + 2);
      i = close === -1 ? src.length : close + 2;
    } else {
      found = src[i] ?? "";
      break;
    }
  }
  for (const p of path) next.set(p, found);
  return found;
}

const onlySpaces = (text: string) => !/[\S\n\u2028\u2029]/.test(text);

// Prettier's own-line and end-of-line tests, which look past neighbouring comments that share
// the preceding (or following) node with only spaces between. Each run is measured once from its
// end, so a long run of comments stays linear.
function placements(decorated: (Decorated & { comment: Comment })[], src: string): ("ownLine" | "endOfLine" | "remaining")[] {
  const sharesRun = (a: Decorated & { comment: Comment }, b: Decorated & { comment: Comment }, side: "precedingNode" | "followingNode") =>
    a[side] !== undefined && a[side] === b[side] && onlySpaces(src.slice(a.comment.end, b.comment.start));
  const runStart: number[] = [];
  decorated.forEach((d, i) => (runStart[i] = i > 0 && sharesRun(decorated[i - 1]!, d, "precedingNode") ? runStart[i - 1]! : d.comment.start));
  const runEnd: number[] = [];
  for (let i = decorated.length - 1; i >= 0; i--) {
    const d = decorated[i]!;
    runEnd[i] = i + 1 < decorated.length && sharesRun(d, decorated[i + 1]!, "followingNode") ? runEnd[i + 1]! : d.comment.end;
  }
  return decorated.map((_, i) => (hasNewline(src, runStart[i]!, true) ? "ownLine" : hasNewline(src, runEnd[i]!) ? "endOfLine" : "remaining"));
}

const isBlockNode = (n: Node | undefined) => n?.kind === "$block" || n?.kind === "block";

// A comment moved into a block: before its first statement, or dangling when it is empty.
function intoBlock(c: Context, block: Node) {
  const first = ((block.body as unknown[]) ?? []).find((s) => isNode(s) && s.kind !== "empty");
  if (first) c.add(first as Node, c.comment, "leading");
  else c.add(block, c.comment, "dangling");
}

// The node standing for `owner[key]`: its block, or its bare statement.
function bodyOf(c: Context, owner: Node, key: string): Node | undefined {
  const list = owner[key];
  if (!Array.isArray(list)) return isNode(list) ? list : undefined;
  return c.ctx.blocks.get(list) ?? (list.length === 1 && isNode(list[0]) ? list[0] : undefined);
}

// Comments in an `if`: before `else` they trail the branch or dangle on the `if`, and in front of
// a branch they lead it.
function handleIf(c: Context): boolean {
  const { enclosingNode: e, precedingNode: p, followingNode: f, comment, src } = c;
  if (e?.kind !== "if" || !f) return false;
  if (nextCharacter(c.ctx, comment.end) === ")") {
    if (p) c.add(p, comment, "trailing");
    else c.add(e, comment, "dangling");
    return true;
  }
  const consequent = bodyOf(c, e, "then");
  if (f === consequent) {
    c.add(f, comment, "leading");
    return true;
  }
  if (p === consequent && f === bodyOf(c, e, "else")) {
    const elseAt = src.indexOf("else", p!.end);
    if (comment.start >= elseAt) c.add(f, comment, "leading");
    else if (!isBlockNode(p) && (!isBlockComment(comment) || !hasNewlineInRange(src, comment.start, comment.end)) && !hasNewlineInRange(src, p!.end, comment.start)) {
      c.add(p!, comment, "trailing");
    } else c.add(e, comment, "dangling");
    return true;
  }
  return false;
}

function handleWhile(c: Context): boolean {
  const { enclosingNode: e, precedingNode: p, followingNode: f, comment } = c;
  if (e?.kind !== "while" || !f) return false;
  if (nextCharacter(c.ctx, comment.end) === ")") {
    if (p) c.add(p, comment, "trailing");
    else c.add(e, comment, "dangling");
    return true;
  }
  if (f === bodyOf(c, e, "body")) {
    c.add(f, comment, "leading");
    return true;
  }
  return false;
}

// An arm's comment after `=>` leads its body, as after an arrow's.
function handleArmBody(c: Context): boolean {
  const { enclosingNode: e, followingNode: f, comment, src } = c;
  if (!e || !("pattern" in e) || !("guard" in e) || !f || f !== e.body || comment.start < src.lastIndexOf("=>", f.start)) return false;
  if (isBlockNode(f)) intoBlock(c, f);
  else c.add(f, comment, "leading");
  return true;
}

// In a `match` with no arms, a comment dangles inside its braces.
function handleEmptyMatch(c: Context): boolean {
  const { enclosingNode: e, precedingNode: p, followingNode: f, comment } = c;
  if (e?.kind === "match" && (e.arms as unknown[]).length === 0 && !f && p === e.subject && nextCharacter(c.ctx, comment.end) === "}") {
    c.add(e, comment, "dangling");
    return true;
  }
  return false;
}

function handleEmptySwitch(c: Context): boolean {
  const { enclosingNode: e, precedingNode: p, followingNode: f, comment } = c;
  if (e?.kind === "switch" && (e.cases as unknown[]).length === 0 && !f && p === e.discriminant && nextCharacter(c.ctx, comment.end) === "}") {
    c.add(e, comment, "dangling");
    return true;
  }
  return false;
}

// In a `try`, a comment ahead of a block moves into it; one after a `catch` binding trails it.
function handleTry(c: Context): boolean {
  const { enclosingNode: e, precedingNode: p, followingNode: f, comment } = c;
  if (e?.kind !== "try" || !f) return false;
  if (p && (p === e.param || p === e.paramType) && f === bodyOf(c, e, "handler")) {
    c.add(p, comment, "trailing");
    return true;
  }
  if (isBlockNode(f)) {
    intoBlock(c, f);
    return true;
  }
  const handler = bodyOf(c, e, "handler");
  if (f === e.param && handler) {
    intoBlock(c, handler);
    return true;
  }
  return false;
}

function handleForBody(c: Context): boolean {
  const { enclosingNode: e, followingNode: f, comment, src } = c;
  if ((e?.kind === "for" || e?.kind === "forIn" || e?.kind === "forOf") && f && f === bodyOf(c, e, "body")) {
    if (comment.start > src.lastIndexOf(")", f.start)) {
      c.add(f, comment, "leading");
      return true;
    }
  }
  return false;
}

function handleLabeled(c: Context): boolean {
  if (c.enclosingNode?.kind !== "labeled") return false;
  c.add(c.enclosingNode, c.comment, "leading");
  return true;
}

// Around a class's header, a comment after its decorators trails the last of them, and one just
// before the body moves into it.
function handleClass(c: Context): boolean {
  const { enclosingNode: e, precedingNode: p, followingNode: f, comment } = c;
  if (e?.kind !== "class" && e?.kind !== "interface") return false;
  const decorators = (e.decorators as Node[] | undefined) ?? [];
  if (decorators.length > 0 && !decorators.includes(f as Node)) {
    c.add(decorators[decorators.length - 1]!, comment, "trailing");
    return true;
  }
  const members = e.members as unknown[];
  const body = c.ctx.blocks.get(members);
  if (body && f === body) {
    intoBlock(c, body);
    return true;
  }
  if (f) {
    const heritage = [e.extends, ...((e.implements as Node[] | undefined) ?? [])].filter(isNode);
    if (heritage.includes(f)) {
      if (p) c.add(p, comment, "trailing");
      else c.add(e, comment, "dangling");
      return true;
    }
  }
  return false;
}

const isClassMember = (n: Node | undefined) => n !== undefined && isMember(n) && n.kind !== undefined;

function handleMember(c: Context): boolean {
  const { enclosingNode: e, precedingNode: p, followingNode: f, comment, placement } = c;
  if (isClassMember(e) && !f && placement === "remaining") {
    c.add(nextCharacter(c.ctx, comment.end) === "(" && p ? p : e!, comment, "trailing");
    return true;
  }
  if (isClassMember(e) && p && (e!.decorators as Node[]).includes(p) && (!isBlockComment(comment) || placement === "ownLine")) {
    c.add(p, comment, "trailing");
    return true;
  }
  return false;
}

// `default:` followed by a comment keeps it on the `default:` line.
function handleDefaultCase(c: Context): boolean {
  const { enclosingNode: e, followingNode: f, comment } = c;
  if (!e || !isSwitchCase(e) || e.test !== undefined || !f || f !== (e.body as Node[])[0]) return false;
  if (f.kind === "block" && !isBlockComment(comment)) intoBlock(c, f);
  else c.add(e, comment, "dangling");
  return true;
}

// A comment after the end of an expression statement's expression trails the statement.
function handleTrailingStatement(c: Context): boolean {
  const { enclosingNode: e, precedingNode: p, followingNode: f, comment } = c;
  if (f || !e || !p) return false;
  if (e.kind === "expr" && e.expr === p) {
    c.add(e, comment, "trailing");
    return true;
  }
  const sequence = p.kind === "sequence";
  const assign = p.kind === "assign";
  if ((sequence || assign) && ((e.kind === "arrow" && e.body === p) || ("init" in e && e.init === p && !("test" in e)) || (e.kind === "return" && e.value === p) || (e.kind === "assign" && e.value === p))) {
    const target = sequence ? (p.exprs as Node[])[(p.exprs as Node[]).length - 1]! : (p.value as Node);
    c.add(target, comment, "trailing");
    return true;
  }
  return false;
}

// After a declarator's or parameter's `:`, a comment leads the type, as it sits in Prettier's
// type annotation node.
function handleTypeAnnotation(c: Context): boolean {
  const { enclosingNode: e, followingNode: f, comment, src } = c;
  if (!e || !f || e.type !== f || !("pattern" in e || "target" in e || isClassMember(e))) return false;
  const colon = src.lastIndexOf(":", f.start);
  if (colon === -1 || comment.start < colon) return false;
  c.add(f, comment, "leading");
  return true;
}

// A comment ahead of a function's or method's parameter list, around a name the tree keeps no
// node for, leads the whole function rather than moving past its parameters.
function handleFunctionHead(c: Context): boolean {
  const { enclosingNode: e, precedingNode: p, followingNode: f, comment } = c;
  if (!e || !Array.isArray(e.params) || e.kind === "arrow" || "returns" in e || e.kind === "index") return false;
  if (!("macro" in e) && !(e.kind === "function" && "body" in e) && !isClassMember(e) && !(e.kind === "method" || e.kind === "get" || e.kind === "set")) return false;
  const decorators = (e.decorators as Node[] | undefined) ?? [];
  const typeParams = ((e.typeParams as Node[] | undefined) ?? []).filter(isNode);
  if (p && !decorators.includes(p) && !typeParams.includes(p)) return false;
  const from = Math.max(e.start, ...decorators.map((d) => d.end), ...typeParams.map((t) => t.end));
  const open = scanFor(c.ctx, from, "(");
  if (open === undefined || comment.end > open || (f && f.start < open)) return false;
  c.add(e, comment, "leading");
  return true;
}

// A file of nothing but comments keeps them, the last dangling.
function handleEmptyProgram(c: Context): boolean {
  if ((c.root.body as unknown[]).length !== 0) return false;
  c.add(c.root, c.comment, c.isLast ? "dangling" : "leading");
  return true;
}

// A line comment right before a function's body moves into it.
function handleBeforeBody(c: Context): boolean {
  const { enclosingNode: e, followingNode: f, comment, src } = c;
  if (isBlockComment(comment) || !e || !f || f.kind !== "$block") return false;
  const isFunction = e.kind === "function" || isClassMember(e) || ("params" in e && "body" in e && Array.isArray(e.body));
  if (!isFunction || c.ctx.blocks.get(e.body as unknown[]) !== f) return false;
  let i = comment.end;
  while (i < src.length && /\s/.test(src[i]!)) i++;
  if (i !== f.start) return false;
  intoBlock(c, f);
  return true;
}

// What kind of node `n` is where kinds are shared between expressions, statements, types and
// patterns.
const isCall = (n: Node | undefined) => (n?.kind === "call" || n?.kind === "new" || (n?.kind === "import" && !("module" in n))) && Array.isArray(n.args ?? []);
const isFunctionLike = (n: Node | undefined): boolean =>
  n !== undefined && Array.isArray(n.params) && n.kind !== "index" && (n.kind !== undefined || isClassMember(n));
const isObjectExpression = (n: Node | undefined) => n?.kind === "object" && Array.isArray(n.props) && !("rest" in n);
const isArrayExpression = (n: Node | undefined) => n?.kind === "array" && Array.isArray(n.elements) && !("rest" in n);
const isTypeLiteral = (n: Node | undefined) => n?.kind === "object" && Array.isArray(n.members);
const isUnion = (n: Node | undefined) => n?.kind === "union" && Array.isArray(n.types);
const isConditional = (n: Node | undefined) => n?.kind === "conditional";
const isLineLike = (c: Comment, src: string) => !isBlockComment(c) || !hasNewlineInRange(src, c.start, c.end);
const isProperty = (n: Node | undefined) => n?.kind === "property" && "key" in n && "value" in n;
const isPropertySignature = (n: Node | undefined) => n?.kind === "property" && "readonly" in n && "name" in n;
const isAssignmentLike = (n: Node | undefined) => n !== undefined && ((n.kind === undefined && "target" in n && "init" in n) || n.kind === "assign" || n.kind === "typeAlias");

// Whether `comment` lies inside `(` and `)` with nothing but whitespace and comments around it.
function insideEmptyParens(node: Node, comment: Comment, c: Context): boolean {
  const { src, ctx } = c;
  if (comment.start <= node.start || comment.end >= node.end) return false;
  let before = comment.start;
  for (;;) {
    while (before > 0 && /\s/.test(src[before - 1]!)) before--;
    const start = ctx.commentStarts.get(before);
    if (start === undefined) break;
    before = start;
  }
  let after = comment.end;
  for (;;) {
    while (after < src.length && /\s/.test(src[after]!)) after++;
    const end = ctx.commentAt.get(after);
    if (end === undefined) break;
    after = end;
  }
  return src[before - 1] === "(" && src[after] === ")";
}

// A comment inside the empty `()` of a call or a function dangles on it.
function handleEmptyParens(c: Context): boolean {
  const { enclosingNode: e, comment, src } = c;
  if (!e) return false;
  if (isCall(e) && ((e.args as unknown[] | undefined) ?? []).length === 0 && insideEmptyParens(e, comment, c)) {
    c.add(e, comment, "dangling");
    return true;
  }
  if (isFunctionLike(e) && (e.params as unknown[]).length === 0 && insideEmptyParens(e, comment, c)) {
    c.add(e, comment, "dangling");
    return true;
  }
  return false;
}

// In a conditional, a comment on its own line, or with nothing before it, leads the branch after it.
function handleConditional(c: Context): boolean {
  const { enclosingNode: e, precedingNode: p, followingNode: f, comment, src } = c;
  const sameLine = p !== undefined && !hasNewlineInRange(src, p.end, comment.start);
  if ((!p || !sameLine) && isConditional(e) && f) {
    c.add(f, comment, "leading");
    return true;
  }
  return false;
}

// A comment before a parameter list's `)` trails the last parameter.
function handleLastParameter(c: Context): boolean {
  const { enclosingNode: e, precedingNode: p, comment } = c;
  if (p && isFunctionLike(e) && (e!.params as unknown[]).includes(p) && nextCharacter(c.ctx, comment.end) === ")") {
    c.add(p, comment, "trailing");
    return true;
  }
  return false;
}

// `a // c` above `.b`: the comment leads the lookup, so a member chain keeps it with `.b`.
function handleMemberProperty(c: Context): boolean {
  const { enclosingNode: e, precedingNode: p, followingNode: f, comment } = c;
  if (e?.kind === "member" && p === e.object && !f) {
    c.add(e, comment, "leading");
    return true;
  }
  return false;
}

// Before an index's `[`, a comment trails the object, as one at the end of the object's line
// does, so formatting again doesn't move it inside the brackets.
function handleBeforeIndex(c: Context): boolean {
  const { enclosingNode: e, precedingNode: p, comment, src } = c;
  if (e?.kind !== "index" || !p || p !== e.object) return false;
  const open = src.indexOf("[", p.end);
  if (open === -1 || comment.start > open) return false;
  c.add(p, comment, "trailing");
  return true;
}

// Inside `<...>` type arguments, a comment before the first leads it.
function handleTypeArguments(c: Context): boolean {
  const { enclosingNode: e, followingNode: f, comment, src } = c;
  const args = (e?.typeArgs ?? (e?.kind === "ref" ? e.args : undefined)) as Node[] | undefined;
  if (!args || !f || args[0] !== f) return false;
  const open = src.lastIndexOf("<", f.start);
  if (open === -1 || comment.start < open) return false;
  c.add(f, comment, "leading");
  return true;
}

function handleUnion(c: Context): boolean {
  const { enclosingNode: e, precedingNode: p, comment } = c;
  if ((isUnion(e) || e?.kind === "or") && p) {
    c.add(p, comment, "trailing");
    return true;
  }
  return false;
}

// Around an import or export specifier list.
function handleSpecifiers(c: Context): boolean {
  const { enclosingNode: e, precedingNode: p, comment, src } = c;
  const isSpecifier = (n: Node | undefined) => n !== undefined && n.kind === undefined && "alias" in n && "typeOnly" in n;
  if (isSpecifier(e)) {
    c.add(e!, comment, "leading");
    return true;
  }
  // The default or namespace name has no node; a comment after it trails the import.
  if (e?.kind === "import" && "module" in e && !p && comment.start < src.indexOf("{", e.start)) {
    c.add(e, comment, "trailing");
    return true;
  }
  if (isSpecifier(p) && (e?.kind === "import" || e?.kind === "exportNamed") && hasNewline(src, comment.end)) {
    c.add(p!, comment, "trailing");
    return true;
  }
  return false;
}

function handleDefaultPattern(c: Context): boolean {
  if (c.enclosingNode?.kind === "default" && "target" in c.enclosingNode) {
    c.add(c.enclosingNode, c.comment, "leading");
    return true;
  }
  return false;
}

// A comment before a mapped type's `[` dangles inside its braces.
function handleMapped(c: Context): boolean {
  const { enclosingNode: e, comment, src } = c;
  if (e?.kind === "mapped" && comment.end < src.indexOf("[", e.start)) {
    c.add(e, comment, "dangling");
    return true;
  }
  return false;
}

// Between a mapped type's parts, a comment leads the part after it, so formatting again keeps it
// there.
function handleMappedParts(c: Context): boolean {
  const { enclosingNode: e, followingNode: f, comment } = c;
  if (e?.kind !== "mapped" || !f) return false;
  c.add(f, comment, "leading");
  return true;
}

// Between `x as` and its type a comment trails the expression, or leads the type.
function handleAsExpression(c: Context): boolean {
  const { enclosingNode: e, precedingNode: p, followingNode: f, comment, src } = c;
  // After the `as` itself, a comment leads the type, so formatting again doesn't move it.
  const afterKeyword = (e?.kind === "as" || e?.kind === "satisfies") && p !== undefined && p === e.expr && f !== undefined && src.slice(p.end, comment.start).includes(e.kind);
  if (afterKeyword) {
    c.add(f!, comment, "leading");
    return true;
  }
  if ((e?.kind === "as" || e?.kind === "satisfies") && p === e.expr && !isLineLike(comment, src)) {
    if (f) c.add(f, comment, "leading");
    else c.add(e, comment, "trailing");
    return true;
  }
  return false;
}

// A one-line block comment just before a union leads its first member.
function unionLead(f: Node | undefined, c: Context): boolean {
  if (!isUnion(f) || !isBlockComment(c.comment) || hasNewlineInRange(c.src, c.comment.start, c.comment.end)) return false;
  return /^[ \t]*$/.test(c.src.slice(c.comment.end, f!.start));
}

function handleBeforeUnion(c: Context): boolean {
  if (!unionLead(c.followingNode, c)) return false;
  c.add((c.followingNode!.types as Node[])[0]!, c.comment, "leading");
  return true;
}

// `/** @type {T} */ (x)`: a type cast comment leads what follows it.
function handleTypeCast(c: Context): boolean {
  const { followingNode: f, comment } = c;
  if (f && isBlockComment(comment) && comment.text[2] === "*" && /@(?:type|satisfies)\b/.test(comment.text)) {
    c.add(f, comment, "leading");
    return true;
  }
  return false;
}

// `f( // c` before the first argument leads that argument.
function handleCallOpen(c: Context): boolean {
  const { enclosingNode: e, precedingNode: p, comment, src } = c;
  const args = (e?.args as Node[] | undefined) ?? [];
  if (!isCall(e) || !p || p !== e!.callee || args.length === 0) return false;
  const open = src.indexOf("(", p!.end);
  if (open === -1 || comment.start <= open || comment.end > args[0]!.start) return false;
  c.add(args[0]!, comment, "leading");
  return true;
}

function handleObjectProperty(c: Context): boolean {
  if (!isProperty(c.enclosingNode)) return false;
  c.add(c.enclosingNode!, c.comment, "leading");
  return true;
}

// After `=` in an assignment, declarator or type alias, an end-of-line comment before an object,
// array or template, or any block comment, leads the value.
function handleAssignment(c: Context): boolean {
  const { enclosingNode: e, followingNode: f, comment, placement, src } = c;
  if (!f) return false;
  const lead = () => {
    c.add(unionLead(f, c) ? (f.types as Node[])[0]! : f, comment, "leading");
    return true;
  };
  if (isAssignmentLike(e) && e!.kind !== "typeAlias" && placement === "endOfLine" &&
    (isObjectExpression(f) || isArrayExpression(f) || f.kind === "template" || f.kind === "tagged" || isTypeLiteral(f) || isBlockComment(comment))) {
    return lead();
  }
  if (e?.kind === "typeAlias" && comment.start >= src.indexOf("=", e.start)) return lead();
  return false;
}

// A comment after a union inside an array type, an intersection or a union trails its last member.
function handleAfterUnion(c: Context): boolean {
  const { enclosingNode: e, precedingNode: p, followingNode: f, comment } = c;
  if (isUnion(p) && ((e?.kind === "array" && "element" in e && !f) || e?.kind === "intersection" || isUnion(e))) {
    const types = p!.types as Node[];
    c.add(types[types.length - 1]!, comment, "trailing");
    return true;
  }
  return false;
}

// After `=>`, a comment moves into the body.
function handleArrowBody(c: Context): boolean {
  const { enclosingNode: e, precedingNode: p, followingNode: f, comment, src } = c;
  if (e?.kind !== "arrow" || !f || !p) return false;
  const body = Array.isArray(e.body) ? c.ctx.blocks.get(e.body) : (e.body as Node);
  if (!body || comment.end < src.lastIndexOf("=>", body.start)) return false;
  if (isBlockNode(f)) intoBlock(c, f);
  else c.add(f, comment, "leading");
  return true;
}

// A comment just before an arrow's `=>` dangles there.
function handleBeforeArrow(c: Context): boolean {
  const { enclosingNode: e, comment, src } = c;
  if (e?.kind !== "arrow") return false;
  let i = comment.end;
  while (i < src.length && /\s/.test(src[i]!)) i++;
  if (!src.startsWith("=>", i)) return false;
  c.add(e, comment, "dangling", true);
  return true;
}

function handlePropertySignatureUnion(c: Context): boolean {
  const { enclosingNode: e, followingNode: f, comment } = c;
  if (isPropertySignature(e) && (isUnion(f) || f?.kind === "intersection")) {
    c.add(f!, comment, "leading");
    return true;
  }
  return false;
}

// `f /* c */ (` in a function trails what comes before the `(`.
function handleBeforeParams(c: Context): boolean {
  const { enclosingNode: e, precedingNode: p, comment } = c;
  if (nextCharacter(c.ctx, comment.end) !== "(" || !p || !((e?.kind === "function" && "body" in e) || isClassMember(e) || (e?.kind === "method" && "body" in e))) return false;
  c.add(p, comment, "trailing");
  return true;
}

// A comment before a bodiless signature's `;` trails the signature.
function handleSignatureEnd(c: Context): boolean {
  const { enclosingNode: e, precedingNode: p, followingNode: f, comment } = c;
  const signature = (e?.kind === "method" && "returns" in e) || (e?.kind === "function" && "macro" in e && e.body === undefined) || (isClassMember(e) && e!.body === undefined);
  if (f || !signature || (p && p === (e!.returns ?? e!.returnType)) || nextCharacter(c.ctx, comment.end) !== ";") return false;
  c.add(e!, comment, "trailing");
  return true;
}

// Each placement's handlers, in the order Prettier's estree printer tries them.
function handleOwnLine(c: Context): boolean {
  return [
    handleFunctionHead, handleTypeAnnotation, handleTypeArguments, handleEmptyParens, handleConditional, handleLastParameter, handleBeforeBody, handleMemberProperty, handleBeforeIndex, handleIf, handleWhile,
    handleEmptySwitch, handleEmptyMatch, handleArmBody, handleTry, handleClass, handleForBody, handleUnion, handleEmptyProgram, handleSpecifiers, handleDefaultPattern,
    handleMember, handleLabeled, handleMapped, handleMappedParts, handleAsExpression, handleBeforeUnion,
  ].some((h) => h(c));
}

function handleEndOfLine(c: Context): boolean {
  return [
    handleFunctionHead, handleTypeAnnotation, handleTypeArguments, handleEmptyParens, handleTypeCast, handleLastParameter, handleBeforeBody, handleConditional, handleSpecifiers, handleIf, handleWhile,
    handleEmptySwitch, handleEmptyMatch, handleArmBody, handleTry, handleClass, handleForBody, handleLabeled, handleCallOpen, handleObjectProperty, handleEmptyProgram,
    handleAssignment, handleDefaultCase, handleAfterUnion, handleMapped, handleMappedParts, handleArrowBody, handleTrailingStatement,
    handlePropertySignatureUnion, handleAsExpression,
  ].some((h) => h(c));
}

function handleRemaining(c: Context): boolean {
  return [
    handleFunctionHead, handleTypeAnnotation, handleTypeArguments, handleEmptyParens, handleIf, handleWhile, handleEmptySwitch, handleEmptyMatch, handleArmBody, handleForBody, handleMember, handleEmptyProgram, handleAssignment,
    handleMapped, handleMappedParts, handleBeforeArrow, handleBeforeParams, handleSignatureEnd, handleTrailingStatement, handleAsExpression, handleBeforeUnion,
  ].some((h) => h(c));
}
