// Fish source printed in the one official style, Prettier's defaults: the program is turned into
// a document (src/doc.fsh) and laid out at 80 columns.

import { CompileError } from "./diag.fsh";
import { dup, nextId, type Ids } from "./nodes.fsh";
import { quoteTree, type QuoteField, type QuoteValue } from "./walk.fsh";
import { cloneTypeMember } from "./rebuild.fsh";
import {
  align, conditionalGroup, fill, group, ifBreak, indent, indentIfBreak, join, label, lineSuffix, newBreakParent, newHardline,
  newLine, newLineSuffixBoundary, newLiteralline, newSoftline, print, type Doc,
} from "./doc.fsh";
import { attach, blockKey, follows, hasNewline, isNextLineEmpty, isPreviousLineEmpty, moveToLeading, type Attachment, type Placed, type Placement } from "./comments.fsh";
import { lexer, type Comment, type Token } from "./lexer.fsh";
import {
  parseWithComments, type BinaryOp, type Declarator, type Expr, type ObjectProp, type Param, type Pattern, type PropertyName, type Stmt, type SwitchCase, type PatternProp, type TypeMember, type MatchArm, type ClassMember, type ClassNode, type Interface, type Specifier, type Modifier,
  type TypeNode, type TypeParam,
} from "./parser.fsh";

// `src` formatted, ending in one newline, with line endings as `\n`; a parse error is a
// CompileError at its place in `src`.
/** @throws {CompileError | Error} */
export function format(src: string): string {
  let ids: Ids = { last: 0 };
  const parsed = parseWithComments(src, ids);
  // Prettier prints `\n` line endings whatever the source used; the source is read the same way.
  if (!src.includes("\r")) return printProgram(parsed.program, src, parsed.comments, ids);
  const lf = src.replace(/\r\n?/g, "\n");
  const again = parseWithComments(lf, ids);
  return printProgram(again.program, lf, again.comments, ids);
}

// The printer underneath `format`: `src` gives what the tree doesn't keep, such as a literal's
// text as written, and `comments` are placed as Prettier places them. `ids` is the counter the
// program's nodes were numbered from, which the nodes printing makes are numbered from too.
/** @throws {Error | CompileError} */
export function printProgram(program: Ref<Stmt[]>, src: string, comments: Ref<Comment[]>, ids: Mut<Ids>): string {
  // Prettier's output isn't always stable: an object it breaks gains a newline after its `{`,
  // which the keep-expanded rule then honors, so a second run can lay a chain out differently.
  // Printing the output again until it stops changing makes formatting idempotent.
  // Each round's output must still mean what the source did.
  const meaning = programShape(program);
  let out = printOnce(program, src, comments, ids);
  for (let round = 0; round < 3; round++) {
    const again = reparse(out, ids);
    assertSameProgram(meaning, again.program);
    const reprinted = printOnce(again.program, out, again.comments, ids);
    if (reprinted === out) return out;
    out = reprinted;
  }
  throw new Error("the formatter's output kept changing when formatted again");
}

// The program as its meaning reads, for checking that formatting kept it: the tree, as
// `quoteTree` gives it, with what printing legitimately changes taken out (shared with the corpus
// test).
// - `start`, `end` and `id`, which move with the layout;
// - empty statements, which Prettier drops from statement lists (as a body, `;` stays);
// - `args` of `new C`, which Prettier prints as `new C()`;
// - a regex's flags, which Prettier sorts and whose order means nothing;
// - a numeric key's text, as `0X10` and `2.50` print as `0x10` and `2.5` and name the same key;
// - `a && (b && c)`, and the same for `||`, `??` and `|>`, which Prettier prints without the
//   parentheses; each of these operators is associative, so the left-nested tree means the same.
function normalize(v: Ref<QuoteValue>): QuoteValue {
  switch (v.kind) {
    case "list": {
      let items: QuoteValue[] = [];
      for (const x of v.items) if (!isEmptyStatement(x)) items.push(normalize(x));
      return { kind: "list", items };
    }
    case "bigint": return { kind: "text", value: `${v.value}n` };
    case "node": return { kind: "node", of: v.of, fields: normalizeNode(v.fields) };
    case "record": return { kind: "record", fields: normalizeFields(v.fields) };
    case "none": return { kind: "none" };
    case "text": return { kind: "text", value: v.value };
    case "boolean": return { kind: "boolean", value: v.value };
    case "int": return { kind: "int", value: v.value };
    case "float": return { kind: "float", value: v.value };
  }
  return { kind: "none" };
}

function isEmptyStatement(v: Ref<QuoteValue>): boolean {
  return v.kind === "node" && fieldText(v.fields, "kind") === "empty";
}

function normalizeFields(fields: Ref<QuoteField[]>): QuoteField[] {
  let out: QuoteField[] = [];
  for (const f of fields) {
    if (f.name === "start" || f.name === "end" || f.name === "id") continue;
    out.push({ name: f.name, value: normalize(f.value) });
  }
  return out;
}

function normalizeNode(fields: Ref<QuoteField[]>): QuoteField[] {
  const kind = fieldText(fields, "kind");
  let out: QuoteField[] = [];
  for (const f of fields) {
    if (f.name === "start" || f.name === "end" || f.name === "id") continue;
    const v: Ref<QuoteValue> = f.value;
    if (kind === "new" && f.name === "args" && v.kind === "none") out.push({ name: "args", value: { kind: "list", items: [] } });
    else if (kind === "regex" && f.name === "flags" && v.kind === "text") {
      let flags = [...v.value];
      flags.sort();
      out.push({ name: "flags", value: { kind: "text", value: flags.join("") } });
    } else if ((f.name === "key" || f.name === "name") && v.kind === "text" && /^\.?\d/.test(v.value)) {
      const key = Number(v.value.replace(/_/g, ""));
      out.push({ name: f.name, value: { kind: "text", value: key === null ? "NaN" : `${key}` } });
    } else out.push({ name: f.name, value: normalize(v) });
  }
  return kind === "binary" || kind === "pipe" ? leftNested(out) : out;
}

// A copy of `v`, for rearranging a normalized tree.
function copyQuote(v: Ref<QuoteValue>): QuoteValue {
  switch (v.kind) {
    case "none": return { kind: "none" };
    case "text": return { kind: "text", value: v.value };
    case "boolean": return { kind: "boolean", value: v.value };
    case "int": return { kind: "int", value: v.value };
    case "bigint": return { kind: "bigint", value: v.value };
    case "float": return { kind: "float", value: v.value };
    case "list": return { kind: "list", items: copyQuotes(v.items) };
    case "node": return { kind: "node", of: v.of, fields: copyFields(v.fields) };
    case "record": return { kind: "record", fields: copyFields(v.fields) };
  }
  return { kind: "none" };
}

function copyQuotes(items: Ref<QuoteValue[]>): QuoteValue[] {
  let out: QuoteValue[] = [];
  for (const x of items) out.push(copyQuote(x));
  return out;
}

function copyFields(fields: Ref<QuoteField[]>): QuoteField[] {
  let out: QuoteField[] = [];
  for (const f of fields) out.push({ name: f.name, value: copyQuote(f.value) });
  return out;
}

function fieldText(fields: Ref<QuoteField[]>, name: string): string {
  for (const f of fields) if (f.name === name && f.value.kind === "text") return f.value.value;
  return "";
}

// A copy of the fields of the node in field `name`, when it holds one.
function nodeFields(fields: Ref<QuoteField[]>, name: string): QuoteField[] | undefined {
  for (const f of fields) if (f.name === name && f.value.kind === "node") return copyFields(f.value.fields);
  return undefined;
}

// `fields` with field `name` holding `value` in place of what it held.
function withField(fields: Ref<QuoteField[]>, name: string, value: QuoteValue): QuoteField[] {
  let out: QuoteField[] = [];
  let given = value;
  for (const f of fields) {
    if (f.name === name) {
      out.push({ name, value: given });
      given = { kind: "none" };
    } else out.push({ name: f.name, value: copyQuote(f.value) });
  }
  return out;
}

// Whether `inner` continues the chain `outer` starts: the same pipe, or the same logical operator.
function chains(outer: Ref<QuoteField[]>, inner: Ref<QuoteField[]>): boolean {
  const kind = fieldText(outer, "kind");
  if (fieldText(inner, "kind") !== kind) return false;
  if (kind === "pipe") return true;
  const op = fieldText(outer, "op");
  return (op === "&&" || op === "||" || op === "??") && fieldText(inner, "op") === op;
}

function leftNested(node: QuoteField[]): QuoteField[] {
  const kind = fieldText(node, "kind");
  const [leftName, rightName] = kind === "binary" ? ["left", "right"] : kind === "pipe" ? ["value", "body"] : ["", ""];
  if (leftName === "") return node;
  const right = nodeFields(node, rightName);
  if (right === undefined || !chains(node, right)) return node;
  // `a op (b op c)` becomes `(a op b) op c`.
  const innerLeft = nodeFields(right, leftName);
  const innerRight = nodeFields(right, rightName);
  if (innerLeft === undefined || innerRight === undefined) return node;
  const left = leftNested(withField(node, rightName, { kind: "node", of: "expr", fields: innerLeft }));
  const rotated = withField(withField(node, leftName, { kind: "node", of: "expr", fields: left }), rightName, { kind: "node", of: "expr", fields: innerRight });
  return leftNested(rotated);
}

// A normalized tree as text, so two trees compare as strings.
function shown(v: Ref<QuoteValue>): string {
  let out: string[] = [];
  show(v, out);
  return out.join("");
}

function show(v: Ref<QuoteValue>, out: Mut<string[]>): void {
  switch (v.kind) {
    case "none": out.push("null"); return;
    case "text": out.push(JSON.stringify(v.value)); return;
    case "boolean": out.push(v.value ? "true" : "false"); return;
    case "int": out.push(`${v.value}`); return;
    case "bigint": out.push(`${v.value}n`); return;
    case "float": out.push(`${v.value}`); return;
    case "list": {
      out.push("[");
      for (let i: usize = 0; i < v.items.length; i++) {
        if (i > 0) out.push(",");
        show(v.items[i]!, out);
      }
      out.push("]");
      return;
    }
    case "node":
      out.push(v.of);
      showFields(v.fields, out);
      return;
    case "record":
      showFields(v.fields, out);
      return;
  }
}

function showFields(fields: Ref<QuoteField[]>, out: Mut<string[]>): void {
  out.push("{");
  for (let i: usize = 0; i < fields.length; i++) {
    if (i > 0) out.push(",");
    out.push(fields[i]!.name);
    out.push(":");
    show(fields[i]!.value, out);
  }
  out.push("}");
}

export function programShape(program: Ref<Stmt[]>): string {
  return shown(normalize(quoteTree({ of: "stmts", node: program })));
}

// Throws an internal error when `after` doesn't mean what `before` does, so a printer bug can't
// ship a changed program as formatted output.
/** @throws {Error} */
export function assertSameProgram(before: string, after: Ref<Stmt[]>) {
  const shape = programShape(after);
  if (shape === before) return;
  let i: usize = 0;
  while (i < shape.length && i < before.length && shape.charAt(i as i64) === before.charAt(i as i64)) i++;
  const from = i > 80 ? (i - 80) as i64 : 0;
  throw new Error(`the formatter changed the program's meaning: ${before.slice(from, (i + 40) as i64)} became ${shape.slice(from, (i + 40) as i64)}`);
}

// The formatter's own output parsed again; failing to parse is the formatter's bug, not the user's.
// Anything else it throws is passed on.
/** @throws {Error | CompileError} */
function reparse(out: string, ids: Mut<Ids>): { program: Stmt[]; comments: Comment[] } {
  try {
    return parseWithComments(out, ids);
  } catch (e) {
    if (e instanceof CompileError) throw new Error(`the formatter produced output that doesn't parse: ${e.message} at offset ${e.start}`);
    throw e;
  }
}

/** @throws {Error | CompileError} */
function printOnce(program: Ref<Stmt[]>, src: string, comments: Ref<Comment[]>, ids: Mut<Ids>): string {
  let attached = attach(program, comments, src, ids);
  for (let attempt = 0; ; attempt++) {
    let printer = new Printer(attached, ids.last);
    for (let i: usize = 0; i < printer.attached.all.length; i++) printer.attached.all[i]!.printed = false;
    const out = printer.render(program, src);
    ids.last = printer.ids.last;
    attached = printer.attached;
    let lost: usize[] = [];
    for (let i: usize = 0; i < attached.all.length; i++) if (!attached.all[i]!.printed) lost.push(i);
    if (lost.length === 0) return out;
    const first: Ref<Comment> = attached.all[lost[0]!]!.comment;
    if (attempt > 0) throw new Error(`the formatter lost the comment at offset ${first.start}: ${first.text}`);
    // A comment on a node that has no place to print it leads the nearest enclosing node that
    // printed, rather than being lost.
    let moves: [usize, usize][] = [];
    for (const i of lost) moves.push([i, nearestPrinted(attached.all[i]!, printer.visited, attached.root.id)]);
    moveToLeading(attached, moves);
  }
}

// The innermost of `p`'s enclosing nodes that printed its own comments, other than its own node.
function nearestPrinted(p: Ref<Placed>, visited: Ref<Set<usize>>, root: usize): usize {
  for (const a of p.ancestors) if (a !== p.node && visited.has(a)) return a;
  return root;
}

// The character at `i` of `src`, or "" past its end.
function charAt(src: string, i: usize): string {
  return src.charAt(i as i64);
}

// Whether the source has a blank line after the `,` that follows an element ending at `end`.
function blankAfterElement(src: string, end: usize): boolean {
  let i = end;
  while (i < src.length && charAt(src, i) !== ",") {
    if (src.startsWith("/*", i as i64)) {
      const close = src.indexOf("*/", (i + 2) as i64);
      // An unclosed comment runs to the end, as `-1 + 2` reads past it.
      i = close === -1 ? 1 : (close + 2) as usize;
    } else if (src.startsWith("//", i as i64)) while (i < src.length && charAt(src, i) !== "\n") i++;
    else i++;
  }
  return isNextLineEmpty(src, i);
}

function placedCopy(p: Ref<Placed>): Placed {
  return { comment: { kind: p.comment.kind, text: p.comment.text, start: p.comment.start, end: p.comment.end }, placement: p.placement, printed: p.printed, ownLine: p.ownLine, node: p.node, ancestors: p.ancestors.slice(), beforeArrow: p.beforeArrow, index: p.index };
}

// A comment as Prettier prints it: a line comment as written, a block comment shaped like JSDoc
// re-indented, and any other block comment as written.
function commentDoc(p: Ref<Placed>): Doc {
  const c: Ref<Comment> = p.comment;
  if (c.kind !== "block") return c.text.trimEnd();
  const value = c.text.slice(2, -2);
  const lines = jsdocLines(value);
  if (lines.length === 0) {
    let written: Doc[] = [];
    for (const l of value.split("\n")) written.push(l);
    return ["/*", join(newLiteralline(), written), "*/"];
  }
  // ponytail: Markdown's two-space line break inside JSDoc isn't kept, as Prettier keeps it.
  let parts: Doc[] = [];
  for (let i: usize = 0; i < lines.length; i++) {
    const l = lines[i]!;
    if (i === 0) parts.push([l.trimEnd(), newHardline()]);
    else if (i === lines.length - 1) parts.push([" ", l]);
    else parts.push([" ", l.trimEnd(), newHardline()]);
  }
  return ["/", parts, "/"];
}

// A block comment's lines when every one of them starts with `*`, as JSDoc's do.
function jsdocLines(value: string): string[] {
  if (!value.includes("\n")) return [];
  const lines = `*${value}*`.split("\n").map((l) => l.trimStart());
  return lines.every((l) => l.startsWith("*")) ? lines : [];
}

// `printed` is the comment's own document.
function leadingComment(p: Ref<Placed>, src: string, printed: Doc): Doc {
  const c: Ref<Comment> = p.comment;
  // A comment printed here can't come before a line comment still waiting to end the line.
  let parts: Doc[] = [newLineSuffixBoundary(), printed];
  if (c.kind === "block") parts.push(hasNewline(src, c.end) ? (hasNewline(src, c.start, true) ? newHardline() : newLine()) : " ");
  else parts.push(newHardline());
  let i = c.end;
  while (charAt(src, i) === " " || charAt(src, i) === "\t") i++;
  if (charAt(src, i) === "\r" && charAt(src, i + 1) === "\n") i += 2;
  else if (charAt(src, i) === "\n" || charAt(src, i) === "\r") i++;
  if (hasNewline(src, i)) parts.push(newHardline());
  return parts;
}

// `previous` is what the trailing comment before it printed as, none before the first.
function trailingComment(p: Ref<Placed>, src: string, previous: Ref<{ isBlock: boolean; hasLineSuffix: boolean }>, defer: boolean, printedComment: Doc): { doc: Doc; isBlock: boolean; hasLineSuffix: boolean } {
  const c: Ref<Comment> = p.comment;
  const isBlock = c.kind === "block";
  if ((previous.hasLineSuffix && !previous.isBlock) || hasNewline(src, c.start, true)) {
    return { doc: lineSuffix([newHardline(), isPreviousLineEmpty(src, c.start) ? newHardline() : "", printedComment], !isBlock), isBlock, hasLineSuffix: true };
  }
  if (!isBlock || previous.hasLineSuffix) return { doc: [lineSuffix([" ", printedComment], !isBlock), newBreakParent()], isBlock, hasLineSuffix: true };
  // Before a token that must stay on this line, a comment spanning lines waits for the line's end,
  // and a one-line comment prints without flushing a pending line comment, either of which would
  // put a line break before the token.
  if (defer && c.text.includes("\n")) return { doc: lineSuffix([" ", printedComment]), isBlock, hasLineSuffix: true };
  if (defer) return { doc: [" ", printedComment], isBlock, hasLineSuffix: false };
  return { doc: [newLineSuffixBoundary(), " ", printedComment], isBlock, hasLineSuffix: false };
}

// `docs` with `separator` between them, and one blank line more after any node the source
// follows with a blank line, as Prettier keeps them between statements, members and properties.
// `ends` are where each node ends.
function separated(ends: Ref<usize[]>, docs: Ref<Doc[]>, separator: Doc, blank: Doc, src: string): Doc[] {
  let out: Doc[] = [];
  let sep = separator;
  let gap = blank;
  // Taken from a copy, since the caller may still read `docs`.
  let items = docs.slice();
  items.reverse();
  for (let i: usize = 0; items.length > 0; i++) {
    out.push(items.pop()!);
    if (items.length === 0) break;
    const [s1, s2] = dup(sep);
    out.push(s1);
    sep = s2;
    if (isNextLineEmpty(src, pastParens(src, ends[i]!))) {
      const [g1, g2] = dup(gap);
      out.push(g1);
      gap = g2;
    } else out.push("");
  }
  return out;
}

// The tree records a mapped type's `readonly` and `?` as "+" whether or not a `+` was written.
function signed(src: string, from: usize, sign: "+" | "-" | undefined, text: string): string {
  if (sign === undefined) return "";
  if (sign === "-") return `-${text}`;
  return src.slice(from as i64).trimStart().startsWith("+") ? `+${text}` : text;
}

function genericType(x: Ref<TypeNode>): boolean {
  return (x.kind === "ref" && x.args.length > 0) || (x.kind === "function" && x.typeParams.length > 0);
}

// `text`'s lines as documents.
function textLines(text: string): Doc[] {
  let out: Doc[] = [];
  for (const l of text.split("\n")) out.push(l);
  return out;
}

// The arguments each on its own line.
function allBroken(printedArgs: Ref<Doc[]>, isImport: boolean): Doc {
  let parts: Doc[] = [newLine()];
  pushAll(parts, printedArgs.slice());
  return group(["(", indent(parts), isImport ? "" : ifBreak(","), newLine(), ")"], { shouldBreak: true });
}

function anyBreaks(docs: Ref<Doc[]>): boolean {
  for (const d of docs) if (willBreak(d)) return true;
  return false;
}

// `docs` cut into consecutive groups of `sizes`, each group a document of its own.
function grouped(docs: Doc[], sizes: Ref<usize[]>): Doc[] {
  let out: Doc[] = [];
  let left = docs;
  left.reverse();
  for (const size of sizes) {
    let g: Doc[] = [];
    for (let k: usize = 0; k < size; k++) g.push(left.pop()!);
    out.push(g);
  }
  return out;
}

function bodyIsArrow(e: Ref<Of<"arrow">>): boolean {
  if (Array.isArray(e.body)) return false;
  else return e.body.kind === "arrow";
}

function conditionalBody(body: Ref<Expr>): boolean {
  return body.kind === "conditional" && leftmostKind(body) !== "object";
}

// An arrow's body after its `=>`; `conditional` marks a body that `conditionalBody` accepts.
function arrowBody(bodyDoc: Doc, conditional: boolean, sameLine: boolean, opts: Ref<Opts>): Doc {
  const trailing = opts.expandLastArg === true ? ifBreak(",") : "";
  const closing = opts.expandLastArg === true ? newSoftline() : "";
  if (sameLine && conditional) {
    return [" ", group([ifBreak("", "("), indent([newSoftline(), bodyDoc]), ifBreak("", ")"), trailing, closing])];
  }
  if (sameLine) return [" ", bodyDoc];
  return [indent([newLine(), bodyDoc]), trailing, closing];
}

const INFINITY: f64 = 1.0 / 0.0;

// Whether every element is an array or object of more than one entry, of one kind with the
// element after it.
function structuresOfSeveral(e: Ref<Of<"array">>): boolean {
  for (let i: usize = 0; i < e.elements.length; i++) {
    const x: Ref<Expr | undefined> = e.elements[i];
    if (x === undefined) return false;
    let size: usize = 0;
    if (x.kind === "array") size = x.elements.length;
    else if (x.kind === "object") size = x.props.length;
    else return false;
    if (i + 1 < e.elements.length) {
      const next: Ref<Expr | undefined> = e.elements[i + 1];
      if (next !== undefined && next.kind !== x.kind) return false;
    }
    if (size <= 1) return false;
  }
  return true;
}

// An array's trailing comma: written after a hole, else when it breaks.
function arrayTrailing(lastIsHole: boolean, concise: boolean, id: string): Doc {
  return lastIsHole ? "," : concise ? ifBreak(",", "", { groupId: id }) : ifBreak(",");
}

// A name or a chain of lookups on one, as a decorator's.
function simpleName(x: Ref<Expr>): boolean {
  return x.kind === "ident" || (x.kind === "member" && !x.optional && simpleName(x.object));
}

// `items` appended to `out` in order.
function pushAll(out: Mut<Doc[]>, items: Doc[]): void {
  items.reverse();
  while (items.length > 0) out.push(items.pop()!);
}

function exprAt(node: Ref<Expr>, key: string, parent: Ref<Path>): At<"expr"> {
  return { sort: "expr", node, key, parent: upOf(parent) };
}

// Where each of `nodes` ends.
function endsOf<T extends { end: usize }>(nodes: Ref<T[]>): usize[] {
  let out: usize[] = [];
  for (const n of nodes) out.push(n.end);
  return out;
}

// Past the `)` that close parentheses the tree dropped from around a node's end, such as a
// parenthesized type ending a type alias.
function pastParens(src: string, end: usize): usize {
  let last = end;
  for (let i = end; i < src.length && /[\s)]/.test(charAt(src, i)); i++) if (charAt(src, i) === ")") last = i + 1;
  return last;
}

// Where a node sits, as Prettier's AstPath gives it: the key it is under in its parent (named as
// in Prettier's ESTree, such as "callee" or "left"), and the parent's own place. Parentheses and
// several layouts are decided from it.
type Frame =
  | { sort: "stmt"; node: Ref<Stmt> }
  | { sort: "expr"; node: Ref<Expr> }
  | { sort: "declarator"; node: Ref<Declarator> }
  | { sort: "type"; node: Ref<TypeNode> }
  | { sort: "prop"; node: Ref<ObjectProp> }
  | { sort: "pattern"; node: Ref<Pattern> }
  | { sort: "param"; node: Ref<Param> }
  | { sort: "member"; node: Ref<ClassMember> }
  | { sort: "arm"; node: Ref<MatchArm> };
// `parent` is held in an object of its own, as Fish keeps a reference in an Option only that way.
type Up = { at: Ref<Path> };
type Path = Frame & { key: string; parent: Up | undefined };

// A narrower frame's place, as the `Path` a parent is held as.
function upOf(p: Ref<Path>): Up {
  return { at: p };
}
type At<S extends Frame["sort"]> = Extract<Path, { sort: S }>;
type Of<K extends Expr["kind"]> = Extract<Expr, { kind: K }>;

// A directive keeps its quotes, unless it holds no quote of either kind (or is "use strict").
function directive(raw: string): string {
  const content = raw.slice(1, -1);
  return content === "use strict" || !/["']/.test(content) ? `"${content}"` : raw;
}

const afterParen = ")";

// A value kept on its keyword's line by parentheses, the value itself on the lines inside them.
function keptOnLine(value: Doc): Doc {
  return ["(", indent([newHardline(), value]), newHardline(), ")"];
}

// Whether the expression with id `id` starts the expression statement at or above `path`.
function startsStatement(path: Ref<Path>, id: usize): boolean {
  if (path.sort === "stmt" && path.node.kind === "expr") return leftmostId(path.node.expr) === (id as i64);
  const u: Ref<Up | undefined> = path.parent;
  return u !== undefined && startsStatement(u.at, id);
}

// Whether the expression with id `id` starts the body of the arrow or `match` arm at or above
// `path`.
function startsArrowBody(path: Ref<Path>, id: usize): boolean {
  if (path.sort === "expr" && path.node.kind === "arrow") {
    if (Array.isArray(path.node.body)) return false;
    else return startsExprBody(path.node.body, id);
  }
  if (path.sort === "arm") {
    return startsArmBody(path.node, id);
  }
  const u: Ref<Up | undefined> = path.parent;
  return u !== undefined && startsArrowBody(u.at, id);
}

function startsArmBody(arm: Ref<MatchArm>, id: usize): boolean {
  const body: Ref<MatchArm["body"]> = arm.body;
  if (body.kind === "block") return false;
  else return body.kind !== "sequence" && form(body) !== "assign" && leftmostId(body) === (id as i64);
}

function startsExprBody(body: Ref<Expr>, id: usize): boolean {
  return body.kind !== "sequence" && form(body) !== "assign" && leftmostId(body) === (id as i64);
}

// Whether an expression of form `f` takes parentheses as a spread's operand.
function spreadParens(f: Form): boolean {
  switch (f) {
    case "binary": case "logical": case "as": case "satisfies": case "assertion": case "sequence": case "yield": case "throw":
    case "await": case "assign": case "conditional":
      return true;
    default:
      return false;
  }
}

// Whether the expression with id `id` leads the operand of the nearest `await` at or above
// `path`, climbing through expressions only.
function leadsOuterAwait(path: Ref<Path>, id: usize): boolean {
  if (path.sort !== "expr") return false;
  if (form(path.node) === "await") return path.node.kind === "unary" && leftmostId(path.node.operand) === (id as i64);
  const u: Ref<Up | undefined> = path.parent;
  return u !== undefined && leadsOuterAwait(u.at, id);
}

// Where a binary expression or an assignment sits: its parent frame's sort, kind and form, the
// parent statement's kind, whether the parent is `Boolean(x)`, and the grandparent's statement
// kind and whether it is a call or `new`.
type BinaryPlace = { sort: string; kind: string; form: string; stmt: string; booleanCall: boolean; outerStmt: string; outerCallOrNew: boolean };

function binaryPlace(path: Ref<Path>): BinaryPlace {
  const u: Ref<Up | undefined> = path.parent;
  if (u === undefined) return { sort: "", kind: "", form: "", stmt: "", booleanCall: false, outerStmt: "", outerCallOrNew: false };
  const up: Ref<Path> = u.at;
  let booleanCall = false;
  let f = "";
  if (up.sort === "expr") {
    const p: Ref<Expr> = up.node;
    f = form(p);
    booleanCall = p.kind === "call" && !p.optional && p.args.length === 1 && p.callee.kind === "ident" && p.callee.name === "Boolean";
  }
  let outerCallOrNew = false;
  const v: Ref<Up | undefined> = up.parent;
  if (v !== undefined) {
    const g: Ref<Path> = v.at;
    outerCallOrNew = g.sort === "expr" && (g.node.kind === "call" || g.node.kind === "new");
  }
  return { sort: up.sort, kind: kindOfFrame(up), form: f, stmt: stmtKindAt(up), booleanCall, outerStmt: stmtKind(up.parent), outerCallOrNew };
}

// The sort and kind of the first frame above `path` that isn't a `!`.
function pastNonNullOf(path: Ref<Path>): { sort: string; kind: string } {
  const u: Ref<Up | undefined> = path.parent;
  if (u === undefined) return { sort: "", kind: "" };
  const up: Ref<Path> = u.at;
  if (up.sort === "expr" && up.node.kind === "nonNull") return pastNonNullOf(up);
  return { sort: up.sort, kind: kindOfFrame(up) };
}

// Whether the first frame above `path` past lookups and `!` assigns to something other than a name.
function assignedToNonName(path: Ref<Path>): boolean {
  const u: Ref<Up | undefined> = path.parent;
  if (u === undefined) return false;
  const up: Ref<Path> = u.at;
  if (up.sort !== "expr") return false;
  const k = up.node.kind;
  if (k === "member" || k === "index" || k === "nonNull") return assignedToNonName(up);
  return up.node.kind === "assign" && up.node.target.kind !== "ident";
}

// What a function, arrow or method is printed from.

type FnHead = { name: string; async: boolean; generator: boolean };

// One parameter, at most one plain type parameter, and a return type that is an object type or
// breaks: the parentheses stay together.
function shouldGroupParameters(typeParams: Ref<TypeParam[]>, paramCount: usize, hasReturn: boolean, objectReturn: boolean, returned: Ref<Doc>): boolean {
  const plainTypeParams = typeParams.length === 0 || (typeParams.length === 1 && typeParams[0]!.constraint === undefined && typeParams[0]!.default === undefined);
  return hasReturn && plainTypeParams && paramCount === 1 && (objectReturn || willBreak(returned));
}

// How a call argument is being printed: hugged as the first or last one, or as the right side
// of an assignment laid out a given way.
// `deferTrailing` marks a place followed by a token that a line break would cut off, such as a
// type's `[]` or an expression's `!`: a trailing comment there waits for the end of the line.
type Opts = { expandFirstArg?: boolean; expandLastArg?: boolean; assignmentLayout?: Layout; deferTrailing?: boolean };

// Thrown when an argument can't be hugged, as Prettier's ArgExpansionBailout: its parameters
// would have to break.
const BAILOUT = "the argument can't be hugged";

function isObjectType(t: Ref<TypeNode>): boolean {
  return t.kind === "object" || t.kind === "mapped";
}

// `({ a, b }) => ...`: a lone object or array pattern, or a name typed with an object type.
function shouldHugTheOnlyParameter(params: Ref<Param[]>): boolean {
  if (params.length !== 1) return false;
  const only: Ref<Param> = params[0]!;
  if (only.rest) return false;
  const kind = only.pattern.kind;
  const d: Ref<Expr | undefined> = only.default;
  if (kind === "object" || kind === "array") {
    return d === undefined || d.kind === "ident" || (d.kind === "object" && d.props.length === 0) || (d.kind === "array" && d.elements.length === 0);
  }
  const t: Ref<TypeNode | undefined> = only.type;
  return kind === "ident" && d === undefined && t !== undefined && isObjectType(t);
}

// A `match` pattern isn't a destructuring, so a nested object or array in it doesn't force a break.
function inMatch(path: Ref<Path>): boolean {
  if (path.sort !== "pattern") return path.sort === "arm";
  const u: Ref<Up | undefined> = path.parent;
  return u !== undefined && inMatch(u.at);
}

// Whether `path` is the pattern, or the type annotation, of a function's lone hugged parameter.
function huggedParam(path: Ref<Path>): boolean {
  const u: Ref<Up | undefined> = path.parent;
  if (u === undefined) return false;
  const up: Ref<Path> = u.at;
  if (up.sort !== "param") return false;
  const v: Ref<Up | undefined> = up.parent;
  return v !== undefined && hugsItsParameter(v.at);
}

// Whether the function `path` holds hugs its lone parameter.
function hugsItsParameter(path: Ref<Path>): boolean {
  if (path.sort === "expr" && (path.node.kind === "arrow" || path.node.kind === "function")) return shouldHugTheOnlyParameter(path.node.params);
  if (path.sort === "stmt" && path.node.kind === "function") return shouldHugTheOnlyParameter(path.node.params);
  if (path.sort === "prop" && (path.node.kind === "method" || path.node.kind === "get" || path.node.kind === "set")) return shouldHugTheOnlyParameter(path.node.params);
  if (path.sort === "type" && path.node.kind === "function") return shouldHugTheOnlyParameter(path.node.params);
  return false;
}

// Prettier's needsParens for types: a function, conditional, union or intersection type inside
// another type that would read it differently, and an operator type before `[]` or `[K]`.
function typeNeedsParens(path: Ref<At<"type">>): boolean {
  const t: Ref<TypeNode> = path.node;
  const key = path.key;
  const u: Ref<Up | undefined> = path.parent;
  let upSort = "";
  let upKind = "";
  let pk = "";
  let upThrows = false;
  if (u !== undefined) {
    const up: Ref<Path> = u.at;
    upSort = up.sort;
    upKind = kindOfFrame(up);
    if (up.sort === "type") pk = up.node.kind;
    upThrows = throwsOf(up);
  }
  const inArrayLike = pk === "array" || key === "optionalType" || key === "restType" || (key === "objectType" && pk === "indexed") || pk === "operator";
  switch (t.kind) {
    case "function":
    case "conditional": {
      if (t.kind === "function" && !t.construct && key === "returnType" && upSort === "expr" && upKind === "arrow") return true;
      // A function type returned by one that throws would take its `throws` as its own.
      if (t.kind === "function" && t.throws === undefined && key === "returnType" && upThrows) return true;
      if (pk === "conditional" && (key === "checkType" || (key === "extendsType" && t.kind === "conditional"))) return true;
      if (key === "constraint" && t.kind === "conditional" && upSort !== "type") return true;
      if (key === "extendsType" && pk === "conditional" && t.kind === "function") {
        if (inferWithConstraint(t.returns)) return true;
      }
      return pk === "union" || pk === "intersection" || inArrayLike;
    }
    case "union":
    case "intersection":
      return pk === "union" || pk === "intersection" || inArrayLike;
    case "infer":
      if (key === "restType") return false;
      if (key === "types" && (pk === "union" || pk === "intersection") && t.constraint !== undefined) return true;
      return inArrayLike;
    case "operator":
      return inArrayLike;
    case "query":
      return (key === "objectType" && pk === "indexed") || (key === "elementType" && pk === "array");
    default:
      return false;
  }
}

// Whether a function type's return, or the type a predicate in it names, is an `infer` with a
// constraint.
function inferWithConstraint(r: Ref<TypeNode>): boolean {
  if (r.kind === "predicate" && r.type !== undefined) return inferWithConstraint(r.type);
  return r.kind === "infer" && r.constraint !== undefined;
}

// What a frame's parent is: its sort, its node's kind and id, and the key it sits under; empty,
// with an id of -1, at the root.
type UpInfo = { sort: string; kind: string; id: i64; key: string };

function upInfo(path: Ref<Path>): UpInfo {
  const u: Ref<Up | undefined> = path.parent;
  if (u === undefined) return { sort: "", kind: "", id: -1, key: "" };
  const up: Ref<Path> = u.at;
  return { sort: up.sort, kind: kindOfFrame(up), id: frameId(up) as i64, key: up.key };
}

function frameId(path: Ref<Path>): usize {
  switch (path.sort) {
    case "stmt": return path.node.id;
    case "expr": return path.node.id;
    case "declarator": return path.node.id;
    case "type": return path.node.id;
    case "prop": return path.node.id;
    case "pattern": return path.node.id;
    case "param": return path.node.id;
    case "member": return path.node.id;
    case "arm": return path.node.id;
  }
  return 0;
}

// Whether `path` is an element of a tuple type of more than one element.
function inLongTuple(path: Ref<Path>): boolean {
  const u: Ref<Up | undefined> = path.parent;
  if (u === undefined) return false;
  const up: Ref<Path> = u.at;
  return up.sort === "type" && up.node.kind === "tuple" && up.node.elements.length > 1;
}

// The kind of the node a frame holds, or "" for one that has none.

function kindOfFrame(path: Ref<Path>): string {
  switch (path.sort) {
    case "stmt": return path.node.kind;
    case "expr": return path.node.kind === "pipe" ? "binary" : path.node.kind;
    case "type": return path.node.kind;
    case "prop": return path.node.kind;
    case "pattern": return path.node.kind;
    case "member": return path.node.kind;
    default: return "";
  }
}

// Whether the node a frame holds declares what it throws.
function throwsOf(path: Ref<Path>): boolean {
  if (path.sort === "expr") return path.node.kind === "arrow" && path.node.throws !== undefined;
  if (path.sort === "stmt") return path.node.kind === "function" && path.node.throws !== undefined;
  if (path.sort === "type") return path.node.kind === "function" && path.node.throws !== undefined;
  if (path.sort === "member") return (path.node.kind === "method" || path.node.kind === "constructor" || path.node.kind === "get" || path.node.kind === "set") && path.node.throws !== undefined;
  return false;
}

// `Foo | null` and the like: one object or reference type with only `null` or `void` beside it,
// printed on one line.
function simpleUnion(types: Ref<TypeNode[]>): boolean {
  const main = types.find((t) => t.kind === "object" || (t.kind === "ref" && !["null", "void"].includes(t.name)));
  return main !== undefined && types.every((t) => t === main || (t.kind === "ref" && (t.name === "null" || t.name === "void") && t.args.length === 0));
}

// Prettier's node types where they split one of ours: `await` is its own, and `&&`, `||` and
// `??` are logical rather than binary.
type Form = Expr["kind"] | "await" | "logical";

// What a `throw` expression's operand, parsed at unary precedence, can't be without parentheses.
const belowUnary = new Set<Form>(["binary", "logical", "conditional", "assign", "arrow", "as", "satisfies", "yield", "sequence", "throw"]);

function form(e: Ref<Expr>): Form {
  if (e.kind === "unary" && e.op === "await") return "await";
  if (e.kind === "binary" && isLogicalOp(e.op)) return "logical";
  if (e.kind === "destructure") return "assign";
  if (e.kind === "comptime") return "await";
  if (e.kind === "throw") return "throw";
  if (e.kind === "pipe") return "binary";
  return e.kind;
}

function isPipe(e: Ref<Expr>): boolean {
  return e.kind === "pipe";
}

// A pipe reads as Prettier's babel parser gives it, a binary `|>`: these read a binary or a pipe
// alike, the operator, then the left and right sides.
type BinaryLikeOp = BinaryOp | "|>";

function isBinaryLike(e: Ref<Expr>): boolean {
  return e.kind === "binary" || e.kind === "pipe";
}

function opOf(e: Ref<Expr>): BinaryLikeOp {
  if (e.kind === "binary") return e.op;
  return "|>";
}

function binLeft(e: Ref<Expr>): Ref<Expr> {
  if (e.kind === "binary") return e.left;
  if (e.kind === "pipe") return e.value;
  return e;
}

function binRight(e: Ref<Expr>): Ref<Expr> {
  if (e.kind === "binary") return e.right;
  if (e.kind === "pipe") return e.body;
  return e;
}

function isLogicalOp(op: string): boolean {
  return op === "&&" || op === "||" || op === "??";
}

function isMember(e: Ref<Expr>): boolean {
  return e.kind === "member" || e.kind === "index";
}

function isAsLike(e: Ref<Expr>): boolean {
  return e.kind === "as" || e.kind === "satisfies";
}

// What `path`'s parent is, when it is an expression: its kind, its form, how many arguments it
// is called with (-1 when it isn't a call, `new` or `import`), and whether it is a test call.
// The fields are empty when the parent isn't an expression.
type ParentExpr = { kind: string; form: string; args: i64; testCall: boolean };

function parentExpr(path: Ref<Path>): ParentExpr {
  const u: Ref<Up | undefined> = path.parent;
  if (u !== undefined) {
    const at: Ref<Path> = u.at;
    if (at.sort === "expr") return { kind: at.node.kind === "pipe" ? "binary" : at.node.kind, form: form(at.node), args: argCount(at.node), testCall: isTestCall(at.node, false) };
  }
  return { kind: "", form: "", args: -1, testCall: false };
}

function argCount(e: Ref<Expr>): i64 {
  if (e.kind === "call" || e.kind === "import") return e.args.length as i64;
  if (e.kind === "new") return e.args === undefined ? 0 : e.args.length as i64;
  return -1;
}

// The kind of the statement a frame holds, or "" when it holds none.
function stmtKindAt(path: Ref<Path>): string {
  return path.sort === "stmt" ? path.node.kind : "";
}

// The kind of the statement `u`'s frame holds, or "" when there is none.
function stmtKind(u: Ref<Up | undefined>): string {
  if (u === undefined) return "";
  return stmtKindAt(u.at);
}

const precedence = new Map<string, usize>([
  ["|>", 0], ["??", 1], ["||", 2], ["&&", 3], ["|", 4], ["^", 5], ["&", 6], ["==", 7], ["===", 7], ["!=", 7], ["!==", 7],
  ["<", 8], [">", 8], ["<=", 8], [">=", 8], ["in", 8], ["instanceof", 8], [">>", 9], ["<<", 9], [">>>", 9], ["+", 10], ["-", 10],
  ["*", 11], ["/", 11], ["%", 11], ["**", 12],
]);
const equality = new Set(["==", "!=", "===", "!=="]);
const multiplicative = new Set(["*", "/", "%"]);
const shifts = new Set([">>", ">>>", "<<"]);
function isBitwise(op: string): boolean {
  return shifts.has(op) || op === "|" || op === "^" || op === "&";
}

// Whether `a op1 b op2 c` prints as one chain rather than with the left side in parentheses:
// `%` beside `*` or `/`, two equalities, two shifts and `**` are kept apart for clarity.
function shouldFlatten(parentOp: string, nodeOp: string | undefined): boolean {
  if (nodeOp === undefined || precedence.get(parentOp) !== precedence.get(nodeOp)) return false;
  if (parentOp === "**") return false;
  if (equality.has(parentOp) && equality.has(nodeOp)) return false;
  if ((nodeOp === "%" && multiplicative.has(parentOp)) || (parentOp === "%" && multiplicative.has(nodeOp))) return false;
  if (nodeOp !== parentOp && multiplicative.has(nodeOp) && multiplicative.has(parentOp)) return false;
  return !(shifts.has(parentOp) && shifts.has(nodeOp));
}

// A class's base that isn't a plain call or lookup chain reads clearer in parentheses.
// Only what the parser reads after `extends` goes bare: a primary, or a chain of lookups and
// calls on one. Prettier also wraps `new`, object literals and tagged templates.
function superClassNeedsParens(e: Ref<Expr>): boolean {
  if (e.kind === "class") return e.decorators.length > 0;
  return !bareBase.has(e.kind);
}

const bareBase = new Set<Expr["kind"]>([
  "ident", "this", "super", "member", "index", "call", "nonNull", "instantiation", "int", "float", "bigint", "string", "bool",
  "null", "regex", "array", "function", "template", "match", "import", "meta", "privateName", "topic",
]);

// Whether `path` lies inside a `for` head's initializer, where `in` would end it.
function inForInit(path: Ref<Path>): boolean {
  const u: Ref<Up | undefined> = path.parent;
  if (u === undefined) return false;
  if (path.key === "init" && stmtKindAt(u.at) === "for") return true;
  return inForInit(u.at);
}

function unaryParens(e: Ref<Expr>, key: string, p: Ref<Expr>): boolean {
  switch (form(p)) {
    case "unary":
      return e.kind === "unary" && p.kind === "unary" && e.op === p.op && (e.op === "+" || e.op === "-");
    case "member": case "index":
      return key === "object";
    case "tagged": case "nonNull":
      return true;
    case "call": case "new":
      return key === "callee";
    case "binary":
      if (p.kind !== "binary" || key !== "left") return false;
      return (e.kind === "unary" && (p.op === "in" || p.op === "instanceof")) || p.op === "**";
    default:
      return false;
  }
}

function binaryishParens(e: Ref<Expr>, key: string, p: Ref<Expr>): boolean {
  const pf = form(p);
  switch (pf) {
    case "as": case "satisfies":
      return !isAsLike(e);
    case "conditional":
      return isAsLike(e) || isPipe(e) || (e.kind === "binary" && e.op === "??");
    case "call": case "new":
      return key === "callee";
    case "assertion": case "tagged": case "spread": case "await": case "nonNull": case "update": case "unary":
      return true;
    case "member": case "index":
      return key === "object";
    case "assign":
      return key === "left" && (e.kind === "assertion" || isAsLike(e));
    case "logical":
    case "binary": {
      if (!isBinaryLike(p)) return false;
      const pop = opOf(p);
      if (pf === "logical" && e.kind === "binary" && isLogicalOp(e.op)) return pop !== e.op;
      if (isAsLike(e)) return true;
      const parentPrecedence = precedence.get(pop)!;
      if (isBinaryLike(e)) {
        const eop = opOf(e);
        const nodePrecedence = precedence.get(eop)!;
        if (parentPrecedence > nodePrecedence) return true;
        if (key === "right" && parentPrecedence === nodePrecedence) return true;
        if (parentPrecedence === nodePrecedence && !shouldFlatten(pop, eop)) return true;
        if (parentPrecedence < nodePrecedence && eop === "%" && (pop === "+" || pop === "-")) return true;
      }
      return isBitwise(pop);
    }
    default:
      return false;
  }
}

function awaitParens(key: string, p: Ref<Expr>): boolean {
  switch (form(p)) {
    case "tagged": case "unary": case "logical": case "spread": case "as": case "satisfies": case "nonNull": case "binary":
      return true;
    case "member": case "index":
      return key === "object";
    case "call": case "new":
      return key === "callee";
    case "conditional":
      return key === "test";
    default:
      return false;
  }
}

// A `new` callee ending in a call needs parentheses, or the call's arguments would be taken
// as the constructor's: `new (a.b())()`.
function endsInCall(e: Ref<Expr>): boolean {
  switch (e.kind) {
    case "call": case "import":
      return true;
    case "member": case "index":
      return endsInCall(e.object);
    case "tagged":
      return endsInCall(e.tag);
    case "nonNull":
      return endsInCall(e.expr);
    default:
      return false;
  }
}

// `new (a?.b)()`: a `new` callee holding an optional link keeps its parentheses, as Prettier
// keeps them around a chain.
function optionalChain(e: Ref<Expr>): boolean {
  if (e.kind === "member" || e.kind === "index") return e.optional || optionalChain(e.object);
  if (e.kind === "call") return e.optional || optionalChain(e.callee);
  if (e.kind === "nonNull") return optionalChain(e.expr);
  if (e.kind === "tagged") return optionalChain(e.tag);
  return false;
}

// The leftmost part of `e`, as Prettier's startsWithNoLookaheadToken finds it; nothing past a
// function called or tagged in place, or a prefix update.
function leftmostId(e: Ref<Expr>): i64 {
  switch (e.kind) {
    case "binary":
      return leftmostId(e.left);
    case "assign":
      return leftmostId(e.target);
    case "destructure":
      return -1;
    case "member": case "index":
      return leftmostId(e.object);
    case "tagged":
      return e.tag.kind === "function" ? -1 : leftmostId(e.tag);
    case "call":
      return e.callee.kind === "function" ? -1 : leftmostId(e.callee);
    case "conditional":
      return leftmostId(e.cond);
    case "update":
      return e.prefix ? -1 : leftmostId(e.operand);
    case "sequence":
      return leftmostId(e.exprs[0]!);
    case "nonNull": case "as": case "satisfies":
      return leftmostId(e.expr);
    case "pipe":
      return leftmostId(e.value);
    default:
      return e.id as i64;
  }
}

// The kind of `e`'s leftmost part, or "" when there is none.
function leftmostKind(e: Ref<Expr>): string {
  switch (e.kind) {
    case "binary":
      return leftmostKind(e.left);
    case "assign":
      return leftmostKind(e.target);
    case "destructure":
      return "";
    case "member": case "index":
      return leftmostKind(e.object);
    case "tagged":
      return e.tag.kind === "function" ? "" : leftmostKind(e.tag);
    case "call":
      return e.callee.kind === "function" ? "" : leftmostKind(e.callee);
    case "conditional":
      return leftmostKind(e.cond);
    case "update":
      return e.prefix ? "" : leftmostKind(e.operand);
    case "sequence":
      return leftmostKind(e.exprs[0]!);
    case "nonNull": case "as": case "satisfies":
      return leftmostKind(e.expr);
    case "pipe":
      return leftmostKind(e.value);
    default:
      return e.kind;
  }
}

// A logical operator whose right side is a non-empty object or array literal keeps it on the line.
function shouldInline(e: Ref<Expr>): boolean {
  if (e.kind !== "binary" || !isLogicalOp(e.op)) return false;
  const r: Ref<Expr> = e.right;
  return (r.kind === "object" && r.props.length > 0) || (r.kind === "array" && r.elements.length > 0);
}

// A conditional heading a member chain that is assigned, returned or awaited is indented once
// more, so the chain doesn't line up with its branches.
function shouldExtraIndent(path: Ref<At<"expr">>): boolean {
  return extraIndentFrom(path, false);
}

// Climbs the member chain `chain` heads, `moved` once it has left where it started, to the node
// owning the chain, and whether that owner takes the chain as its value.
function extraIndentFrom(chain: Ref<Path>, moved: boolean): boolean {
  const u: Ref<Up | undefined> = chain.parent;
  if (u === undefined) return false;
  const up: Ref<Path> = u.at;
  const pk = up.sort === "expr" ? up.node.kind : "";
  if ((pk === "nonNull" && chain.key === "expression") || (pk === "call" && chain.key === "callee") || ((pk === "member" || pk === "index") && chain.key === "object")) {
    return extraIndentFrom(up, true);
  }
  if ((pk === "new" && chain.key === "callee") || ((pk === "as" || pk === "satisfies") && chain.key === "expression")) {
    const v: Ref<Up | undefined> = up.parent;
    return v !== undefined && valueKey(v.at) === up.key;
  }
  return moved && valueKey(up) === chain.key;
}

// The key under which `owner` holds its value, or " ", which no key is, when it has none.
function valueKey(owner: Ref<Path>): string {
  const o = owner.sort === "expr" ? form(owner.node) : owner.sort === "stmt" ? owner.node.kind : owner.sort;
  switch (o) {
    case "assign": return "right";
    case "declarator": return "init";
    case "return": case "throw": case "unary": case "yield": case "await": return "argument";
    default: return " ";
  }
}

function insideNewCallee(path: Ref<Path>): boolean {
  const u: Ref<Up | undefined> = path.parent;
  if (u === undefined) return false;
  const up: Ref<Path> = u.at;
  if (up.sort !== "expr") return false;
  const k = up.node.kind;
  if (((k === "member" || k === "index") && path.key === "object") || (k === "nonNull" && path.key === "expression")) return insideNewCallee(up);
  return k === "new" && path.key === "callee";
}

function callWithArguments(e: Ref<Expr>): boolean {
  return e.kind === "call" && e.args.length > 0;
}

function stripNonNull(e: Ref<Expr>): Ref<Expr> {
  if (e.kind === "nonNull") return stripNonNull(e.expr);
  return e;
}

function labelOf(doc: Ref<Doc>): string | undefined {
  return typeof doc === "object" && !Array.isArray(doc) && doc.kind === "label" ? doc.label : undefined;
}

const moduleCallees = ["require", "require.resolve", "require.resolve.paths", "import.meta.resolve"];

// A template literal, or tagged template, with a line break in its text and none before it.
function templateOnItsOwnLine(e: Ref<Expr>, src: string): boolean {
  if (e.kind === "tagged") return brokenTemplate(e.template) && startsLine(e.start, src);
  return brokenTemplate(e) && startsLine(e.start, src);
}

// Whether `t` is a template literal with a line break in its text.
function brokenTemplate(t: Ref<Expr>): boolean {
  return t.kind === "template" && t.raw.some((q) => q.includes("\n"));
}

// Whether nothing but spaces and tabs come before `start` on its line, the first line included.
function startsLine(start: usize, src: string): boolean {
  let i = start;
  while (i > 0 && (charAt(src, i - 1) === " " || charAt(src, i - 1) === "\t")) i--;
  return i === 0 || charAt(src, i - 1) !== "\n";
}

const testCallees = new Set([
  "it", "it.only", "it.skip", "describe", "describe.only", "describe.skip", "test", "test.only", "test.skip", "test.fixme",
  "test.step", "test.describe", "test.describe.only", "test.describe.skip", "test.describe.fixme", "test.describe.parallel",
  "test.describe.parallel.only", "test.describe.serial", "test.describe.serial.only", "skip", "xit", "xdescribe", "xtest",
  "fit", "fdescribe", "ftest",
]);
function isFunction(e: Ref<Expr>): boolean {
  return e.kind === "function" || e.kind === "arrow";
}

function isAngularTestWrapper(e: Ref<Expr>): boolean {
  return e.kind === "call" && e.callee.kind === "ident" && ["async", "inject", "fakeAsync", "waitForAsync"].includes(e.callee.name);
}

function dotted(e: Ref<Expr>): string | undefined {
  if (e.kind === "ident" || e.kind === "meta") return e.name;
  if (e.kind !== "member" || e.optional) return undefined;
  const object = dotted(e.object);
  return object === undefined ? undefined : `${object}.${e.name}`;
}

// Whether `e` is a test framework's call, such as `it("does", () => ...)`; `parentIsTest` says
// whether the call holding it is one, for Angular's wrappers.
function isTestCall(e: Ref<Expr>, parentIsTest: boolean): boolean {
  if (e.kind !== "call" || e.optional) return false;
  const args: Ref<Expr[]> = e.args;
  if (args.length === 1) {
    if (isAngularTestWrapper(e) && parentIsTest) return isFunction(args[0]!);
    if (e.callee.kind === "ident" && ["beforeEach", "beforeAll", "afterEach", "afterAll"].includes(e.callee.name)) return isAngularTestWrapper(args[0]!);
    return false;
  }
  if ((args.length !== 2 && args.length !== 3) || !(args[0]!.kind === "template" || args[0]!.kind === "string") || !testCallees.has(dotted(e.callee) ?? "")) return false;
  if (args.length === 3 && args[2]!.kind !== "int" && args[2]!.kind !== "float") return false;
  const second: Ref<Expr> = args[1]!;
  const callback = args.length === 2
    ? isFunction(second)
    : (second.kind === "function" || (second.kind === "arrow" && Array.isArray(second.body))) && second.params.length <= 1;
  return callback || isAngularTestWrapper(second);
}

// A call whose arguments outnumber its caller's, as in `f(a, b)(c)`, isn't grouped on its own.
function moreArgumentsThanCaller(e: Ref<Expr>, path: Ref<At<"expr">>): boolean {
  const p = parentExpr(path);
  return path.key === "callee" && e.kind === "call" && p.kind === "call" && p.args > 0 && (e.args.length as i64) > p.args;
}

// `useEffect(() => { ... }, [a, b])`, and `useImperativeHandle(ref, () => { ... }, [a])`.
function isReactHookCall(args: Ref<Expr[]>): boolean {
  if (args.length === 2) return isHook(args[0]!, args[1]!);
  return args.length === 3 && args[0]!.kind === "ident" && isHook(args[1]!, args[2]!);
}

// A callback taking nothing whose body is a block, then an array of dependencies.
function isHook(f: Ref<Expr>, deps: Ref<Expr>): boolean {
  return f.kind === "arrow" && f.params.length === 0 && Array.isArray(f.body) && deps.kind === "array";
}

// Two function arguments, or a call among the arguments that takes a function, put every argument
// on its own line.
function functionArguments(args: Ref<Expr[]>): boolean {
  if (args.length <= 1) return false;
  let functions = 0;
  for (const a of args) {
    if (isFunction(a)) {
      if (++functions > 1) return true;
    } else {
      const inner = stripNonNull(a);
      if (inner.kind === "call" && inner.args.some((x) => isFunction(x))) return true;
    }
  }
  return false;
}

// Prettier's isHopefullyShortCallArgument.
function hopefullyShortArgument(e: Ref<Expr>): boolean {
  if (e.kind === "as" || e.kind === "satisfies") return simpleCast(e.type, 2) && simpleArgument(e.expr, 1);
  if (argCount(e) > 1) return false;
  if (e.kind === "binary" && !isPipe(e)) return simpleArgument(e.left, 1) && simpleArgument(e.right, 1);
  return e.kind === "regex" || simpleArgument(e);
}

// Whether a cast's type is simple, past up to `arrays` levels of `[]` and one type argument.
function simpleCast(t: Ref<TypeNode>, arrays: usize): boolean {
  if (arrays > 0 && t.kind === "array") return simpleCast(t.element, arrays - 1);
  if (t.kind === "ref" && t.args.length === 1) return isSimpleType(t.args[0]!);
  return isSimpleType(t);
}

function isSimpleType(t: Ref<TypeNode>): boolean {
  return t.kind === "literal" || (t.kind === "ref" && t.args.length === 0);
}

// A link of a member chain as the grouping reads it: its node's kind, id and name (a name's or a
// lookup's, else ""), whether it is a lookup or a numeric index, whether a call has a function or
// a complex argument, and its document.
type Link = { kind: string; id: usize; name: string; member: boolean; numericIndex: boolean; functionArg: boolean; complexArg: boolean; printed: Doc };

function linkOf(n: Ref<Expr>, printed: Doc): Link {
  let name = "";
  if (n.kind === "ident" || n.kind === "member") name = n.name;
  let functionArg = false;
  let complexArg = false;
  if (n.kind === "call") {
    for (const a of n.args) {
      if (isFunction(a)) functionArg = true;
      if (!simpleArgument(a)) complexArg = true;
    }
  }
  const numericIndex = n.kind === "index" && (n.index.kind === "int" || n.index.kind === "float");
  return { kind: n.kind, id: n.id, name, member: isMember(n), numericIndex, functionArg, complexArg, printed };
}

// A short or capitalized head, as in `z.object()`, stays on the first line.
function isFactory(name: string): boolean {
  return /^[A-Z]|^[$_]+$/.test(name);
}

// Prettier's isSimpleCallArgument: literals, names, and shallow calls, lookups and literals of
// them, which let a chain of three or more calls stay on one line.
function simpleArgument(given: Ref<Expr>, depth: i64 = 2): boolean {
  if (depth <= 0) return false;
  const e = stripNonNull(given);
  switch (e.kind) {
    case "regex":
      return [...e.pattern].length <= 5;
    case "int": case "float": case "bigint": case "string": case "bool": case "null":
    case "ident": case "this": case "super": case "privateName":
      return true;
    case "template":
      return e.raw.every((q) => !q.includes("\n")) && e.exprs.every((x) => simpleArgument(x, depth - 1));
    case "object":
      return e.props.every((p) => simpleProp(p, depth - 1));
    case "array":
      return e.elements.every((x) => x === undefined || simpleArgument(x, depth - 1));
    case "import":
      return (e.args.length as i64) <= depth && e.args.every((x) => simpleArgument(x, depth - 1));
    case "call":
      return simpleArgument(e.callee, depth) && (e.args.length as i64) <= depth && e.args.every((x) => simpleArgument(x, depth - 1));
    case "new": {
      if (!simpleArgument(e.callee, depth)) return false;
      const args: Ref<Expr[] | undefined> = e.args;
      return args === undefined || ((args.length as i64) <= depth && args.every((x) => simpleArgument(x, depth - 1)));
    }
    case "member":
      return simpleArgument(e.object, depth);
    case "index":
      return simpleArgument(e.object, depth) && simpleArgument(e.index, depth);
    case "unary":
      return ["!", "-", "+", "~"].includes(e.op) && simpleArgument(e.operand, depth);
    case "update":
      return simpleArgument(e.operand, depth);
    default:
      return false;
  }
}

type Layout =
  | "break-after-operator" | "never-break-after-operator" | "fluid" | "break-lhs" | "chain" | "chain-tail" | "chain-tail-arrow-chain"
  | "only-left";

// `const { a, b: c, d = 1 } = x`: more than two properties, one renamed or defaulted.
function complexDestructuring(path: Ref<Path>): boolean {
  if (path.sort === "declarator") return complexObjectPattern(path.node.target);
  if (path.sort === "expr" && path.node.kind === "destructure") return complexObjectPattern(path.node.pattern);
  return false;
}

function complexObjectPattern(target: Ref<Pattern>): boolean {
  if (target.kind !== "object" || target.props.length <= 2) return false;
  for (const p of target.props) if (p.value.start !== p.start || p.value.kind === "default") return true;
  return false;
}

function simpleProp(p: Ref<ObjectProp>, depth: i64): boolean {
  if (p.kind === "property") return typeof p.key === "string" && simpleArgument(p.value, depth);
  return p.kind === "shorthand" && p.default === undefined;
}

// The text of a document made only of strings, as Prettier's cleanDoc leaves it.
function flatText(doc: Ref<Doc>): string | undefined {
  if (typeof doc === "string") return doc;
  if (!Array.isArray(doc)) return undefined;
  let parts: string[] = [];
  for (const d of doc) {
    const text = flatText(d);
    if (text === undefined) return undefined;
    parts.push(text);
  }
  return parts.join("");
}

// `const x: Map<A<B>, C> = ...`: a declared type with several arguments, one of them generic.
function complexTypeAnnotation(d: Ref<Declarator>): boolean {
  const t: Ref<TypeNode | undefined> = d.type;
  if (t === undefined || t.kind !== "ref" || t.args.length < 2) return false;
  return t.args.some((a) => (a.kind === "ref" && a.args.length > 0) || a.kind === "conditional");
}

function chainSignatures(signatures: Doc[], path: Ref<At<"expr">>, opts: Ref<Opts>, shouldBreak: boolean): Doc {
  const p = parentExpr(path);
  const callOrNew = p.kind === "call" || p.kind === "new";
  if (signatures.length === 1 || (path.key !== "callee" && (callOrNew || p.kind === "import")) || p.kind === "binary") {
    let rest = signatures;
    const first = rest.shift();
    if (first === undefined) return "";
    if (rest.length === 0) return first;
    return group([first, " =>", indent([newLine(), join([" =>", newLine()], rest)])], { shouldBreak });
  }
  if ((path.key === "callee" && callOrNew) || opts.assignmentLayout !== undefined) return group(join([" =>", newLine()], signatures), { shouldBreak });
  return group(indent(join([" =>", newLine()], signatures)), { shouldBreak });
}

// ponytail: any Unicode identifier loses its quotes; Prettier unquotes only ES5 ones, so a key of newer letters differs.
const identifierName = /^[$_\p{ID_Start}][$\u200c\u200d\p{ID_Continue}]*$/u;

// The width of leading whitespace, a tab reaching the next stop of two.
function columns(whitespace: string): usize {
  let size = 0;
  for (const ch of whitespace) size = ch === "\t" ? size + 2 - (size % 2) : size + 1;
  return size;
}

// Prettier's removeLines: a document laid out flat whatever happens, keeping hard breaks.
function removeLines(doc: Ref<Doc>): Doc {
  if (typeof doc === "string") return doc;
  if (Array.isArray(doc)) return removeAllLines(doc);
  switch (doc.kind) {
    case "line":
      return doc.hard ? { kind: "line", soft: doc.soft, hard: true, literal: doc.literal } : doc.soft ? "" : " ";
    case "ifBreak":
      return removeLines(doc.flatContents);
    case "group": {
      const given: Ref<Doc[] | undefined> = doc.expandedStates;
      if (given === undefined) {
        return { kind: "group", contents: removeLines(doc.contents), break: doc.break, id: doc.id, expandedStates: undefined, propagated: false };
      }
      // The group's contents are its first state itself, as `conditionalGroup` makes them.
      let states = removeAllLines(given);
      const [first, kept] = dup(states.shift()!);
      states.unshift(kept);
      return { kind: "group", contents: first, break: doc.break, id: doc.id, expandedStates: states, propagated: false };
    }
    case "indent":
      return { kind: "indent", contents: removeLines(doc.contents) };
    case "align":
      return { kind: "align", n: doc.n, contents: removeLines(doc.contents) };
    case "indentIfBreak":
      return { kind: "indentIfBreak", contents: removeLines(doc.contents), groupId: doc.groupId, negate: doc.negate };
    case "lineSuffix":
      return { kind: "lineSuffix", contents: removeLines(doc.contents), endsLine: doc.endsLine };
    case "label":
      return { kind: "label", label: doc.label, contents: removeLines(doc.contents) };
    case "fill":
      return { kind: "fill", parts: removeAllLines(doc.parts), printed: doc.printed };
    case "breakParent":
      return { kind: "breakParent" };
    case "lineSuffixBoundary":
      return { kind: "lineSuffixBoundary" };
    case "trim":
      return { kind: "trim" };
  }
  return "";
}

function removeAllLines(docs: Ref<Doc[]>): Doc[] {
  let out: Doc[] = [];
  for (const d of docs) out.push(removeLines(d));
  return out;
}

// `A.B` with no type arguments, which makes Prettier set a class's heritage apart.
function dottedType(t: Ref<TypeNode>): boolean {
  return t.kind === "ref" && t.name.includes(".") && t.args.length === 0;
}

// Prettier's modifier order for each kind of member.
const fieldOrder = ["declare", "public", "private", "protected", "static", "abstract", "override", "readonly", "accessor"];
const methodOrder = ["public", "private", "protected", "static", "abstract", "override", "async"];
function ordered(modifiers: Ref<Modifier[]>, order: Ref<string[]>): Doc[] {
  let out: Doc[] = [];
  for (const m of order) {
    let written = false;
    for (const x of modifiers) if (x === m) written = true;
    if (written) out.push(`${m} `);
  }
  return out;
}

// What `e`'s leftmost part is held under, as Prettier's key names it, or "" when `e` has none.
function leftKey(e: Ref<Expr>): string {
  switch (e.kind) {
    case "binary": case "assign": case "pipe":
      return "left";
    case "member": case "index":
      return "object";
    case "call":
      return "callee";
    case "tagged":
      return "tag";
    case "conditional":
      return "test";
    case "update":
      return e.prefix ? "" : "argument";
    case "sequence":
      return "expressions";
    case "nonNull": case "as": case "satisfies":
      return "expression";
    default:
      return "";
  }
}

// `e`'s leftmost part, which `leftKey` says is there.
function leftOf(e: Ref<Expr>): Ref<Expr> {
  switch (e.kind) {
    case "binary": return e.left;
    case "pipe": return e.value;
    case "assign": return e.target;
    case "member": return e.object;
    case "index": return e.object;
    case "call": return e.callee;
    case "tagged": return e.tag;
    case "conditional": return e.cond;
    case "update": return e.operand;
    case "sequence": return e.exprs[0]!;
    case "nonNull": return e.expr;
    case "as": return e.expr;
    case "satisfies": return e.expr;
    default: return e;
  }
}

// Whether laying `doc` out must break a line: a hard line or a group already broken.
function willBreak(doc: Ref<Doc>): boolean {
  return someDoc(doc, true);
}

function hasLine(doc: Ref<Doc>): boolean {
  return someDoc(doc, false);
}

// Whether `doc` holds, with `breaking`, a broken group, a hard line or a break marker, and
// without it any line. Prettier's traversal for these checks: a conditional group's other states
// aren't visited.
function someDoc(doc: Ref<Doc>, breaking: boolean): boolean {
  if (typeof doc === "string") return false;
  if (Array.isArray(doc)) return doc.some((d) => someDoc(d, breaking));
  if (breaking ? (doc.kind === "group" && doc.break) || (doc.kind === "line" && doc.hard) || doc.kind === "breakParent" : doc.kind === "line") return true;
  switch (doc.kind) {
    case "group": case "indent": case "align": case "indentIfBreak": case "lineSuffix": case "label":
      return someDoc(doc.contents, breaking);
    case "fill":
      return doc.parts.some((d) => someDoc(d, breaking));
    case "ifBreak":
      return someDoc(doc.breakContents, breaking) || someDoc(doc.flatContents, breaking);
    default:

      return false;
  }
}

// A number as Prettier prints it: lower case, no `+` or leading zeros in the exponent, no
// trailing zeros or dot in the fraction, and a digit before a leading dot.
function number(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/^([+-]?[\d.]+e)(?:\+|(-))?0*(\d)/, "$1$2$3")
    .replace(/^([+-]?[\d.]+)e[+-]?0+$/, "$1")
    .replace(/^([+-])?\./, "$10.")
    .replace(/(\.\d+?)0+(?=e|$)/, "$1")
    .replace(/\.(?=e|$)/, "");
}

// One print of a program whose comments are `attached`, giving `render`, which prints it, and
// `visited`, the nodes whose own comments it printed. It keeps each expression's document once
// printed, and numbers the views of nodes it makes from `ids`, the counter the program's own
// nodes come from, so no view shares a node's id.
class Printer {
  attached: Attachment;
  ids: Ids;
  // The ids of the nodes whose own comments were printed.
  visited: Set<usize>;
  // Each expression's document, printed once per place as Prettier caches it: hugging prints an
  // argument a second time, and without the cache nested callbacks would cost 2^depth.
  printedCache: Map<usize, { parent: i64; key: string; doc: Doc }>;
  groupCount: usize;
  constructor(attached: Attachment, last: usize) {
    this.attached = attached;
    this.ids = { last };
    this.visited = new Set<usize>();
    this.printedCache = new Map<usize, { parent: i64; key: string; doc: Doc }>();
    this.groupCount = 0;
  }

  // A name for a group, so an `ifBreak` elsewhere can ask how it was printed.
  /** @throws {Error | CompileError} */
  groupId(this: Mut<this>, name: string): string {
    return `${name}#${++this.groupCount}`;
  }

  // A comment's document, marking it printed.
  /** @throws {Error | CompileError} */
  printComment(this: Mut<this>, p: Ref<Placed>): Doc {
    this.attached.all[p.index]!.printed = true;
    return commentDoc(p);
  }

  /** @throws {Error | CompileError} */
  printComments(this: Mut<this>, list: Ref<Placed[]>): Doc[] {
    let out: Doc[] = [];
    for (const p of list) out.push(this.printComment(p));
    return out;
  }

  /** @throws {Error | CompileError} */
  render(this: Mut<this>, program: Ref<Stmt[]>, src: string): string {
    const root = this.attached.root.id;
    const top: Up | undefined = undefined;
    const body = this.statements(program, top, src, true);
    const dangling = this.danglingComments(root, src);
    const some = body.length > 0 || dangling.length > 0;
    const both = body.length > 0 && dangling.length > 0;
    const contents = this.commented(root, [body, both ? newHardline() : "", dangling], src);
    return print(some || this.commentsOf(root).length > 0 ? [contents, newHardline()] : "");
  }

  // The comments of the node with id `id`, in source order.
  /** @throws {Error | CompileError} */
  commentsOf(this: Mut<this>, id: usize): Placed[] {
    const list = this.attached.byNode.get(id);
    let out: Placed[] = [];
    if (list === undefined) return out;
    for (const i of list) out.push(placedCopy(this.attached.all[i]!));
    return out;
  }

  /** @throws {Error | CompileError} */
  hasComments(this: Mut<this>, id: usize, placement?: Placement): boolean {
    const list = this.attached.byNode.get(id);
    if (list === undefined) return false;
    for (const i of list) if (placement === undefined || this.attached.all[i]!.placement === placement) return true;
    return false;
  }

  // Whether a comment followed by a line break leads `node`, which then can't share a line.
  /** @throws {Error | CompileError} */
  ownLineLeading(this: Mut<this>, id: usize, src: string): boolean {
    const list = this.attached.byNode.get(id);
    if (list === undefined) return false;
    for (const i of list) {
      const p: Ref<Placed> = this.attached.all[i]!;
      if (p.placement === "leading" && hasNewline(src, p.comment.end)) return true;
    }
    return false;
  }

  /** @throws {Error | CompileError} */
  hasLineComment(this: Mut<this>, id: usize, placement: Placement): boolean {
    const list = this.attached.byNode.get(id);
    if (list === undefined) return false;
    for (const i of list) {
      const p: Ref<Placed> = this.attached.all[i]!;
      if (p.placement === placement && p.comment.kind !== "block") return true;
    }
    return false;
  }

  // `doc` with the comments leading and trailing the node with id `id`, -1 for none, around it,
  // as Prettier's printComments. `withLeading` false leaves the leading comments to the caller,
  // which prints them earlier.
  /** @throws {Error | CompileError} */
  commented(this: Mut<this>, id: usize, doc: Doc, src: string, withLeading = true, deferTrailing = false): Doc {
    this.visited.add(id);
    if (this.attached.byNode.get(id) === undefined) return doc;
    const list = this.commentsOf(id);
    let leading: Doc[] = [];
    let trailing: Doc[] = [];
    let previous: { isBlock: boolean; hasLineSuffix: boolean } = { isBlock: false, hasLineSuffix: false };
    for (const p of list) {
      if (p.placement === "leading") {
        if (withLeading) leading.push(leadingComment(p, src, this.printComment(p)));
      }
      else if (p.placement === "trailing") {
        const t = trailingComment(p, src, previous, deferTrailing, this.printComment(p));
        trailing.push(t.doc);
        previous = { isBlock: t.isBlock, hasLineSuffix: t.hasLineSuffix };
      }
    }
    if (leading.length === 0 && trailing.length === 0) return doc;
    if (typeof doc === "object" && !Array.isArray(doc) && doc.kind === "label") return label(doc.label, [leading, doc.contents, trailing]);
    return [leading, doc, trailing];
  }

  // `commented` for an id that is -1 when there is no node.
  /** @throws {Error | CompileError} */
  commentedIf(this: Mut<this>, id: i64, doc: Doc, src: string): Doc {
    return id >= 0 ? this.commented(id as usize, doc, src) : doc;
  }

  // A braced list of members: `{}` when empty, else each on its own line, with the comments
  // dangling inside it.
  /** @throws {Error | CompileError} */
  membersBlock<T extends { end: usize }>(this: Mut<this>, owner: usize, docs: Doc[], nodes: Ref<T[]>, src: string): Doc {
    const node = this.attached.blocks.get(blockKey(owner, "members"));
    const id: i64 = node === undefined ? -1 : node.id as i64;
    const dangling: Doc[] = id >= 0 ? this.danglingComments(id as usize, src) : [];
    if (docs.length === 0 && dangling.length === 0) return "{}";
    const contents = [separated(endsOf(nodes), docs, newHardline(), newHardline(), src), docs.length > 0 && dangling.length > 0 ? newHardline() : "", dangling];
    return this.commentedIf(id, ["{", indent([newHardline(), contents]), newHardline(), "}"], src);
  }

  // The comments dangling on `node`, one per line; `beforeArrow` picks those before an arrow's `=>`.
  /** @throws {Error | CompileError} */
  danglingComments(this: Mut<this>, id: usize, src: string, beforeArrow = false): Doc[] {
    const list = this.commentsOf(id).filter((p) => p.placement === "dangling" && (p.beforeArrow === true) === beforeArrow);
    return list.length === 0 ? [] : [newLineSuffixBoundary(), join(newHardline(), this.printComments(list))];
  }

  // Comments dangling inside an empty `()`, `{}` or `[]`, as Prettier's printDanglingComments
  // with its soft lines: on the line, or each on its own when a line comment is among them.
  /** @throws {Error | CompileError} */
  danglingInside(this: Mut<this>, id: usize, src: string): Doc {
    const list = this.commentsOf(id).filter((p) => p.placement === "dangling" && !p.beforeArrow);
    if (list.length === 0) return "";
    return [newLineSuffixBoundary(), indent([newSoftline(), join(newHardline(), this.printComments(list))]), list.some((p) => p.comment.kind !== "block") ? newHardline() : newSoftline()];
  }

  // Statements one per line, empty ones dropped. In a program or function body, the string
  // statements that open it are directives; a string statement anywhere else is parenthesized,
  // as Prettier does, so it isn't read as one.
  /** @throws {Error | CompileError} */
  statements(this: Mut<this>, body: Ref<Stmt[]>, parent: Ref<Up | undefined>, src: string, prologue: boolean): Doc[] {
    let inPrologue = prologue;
    let printedStmts: Doc[] = [];
    let left: usize = 0;
    for (const s of body) if (s.kind !== "empty") left++;
    for (const s of body) {
      const isString = s.kind === "expr" && s.expr.kind === "string" && s.expr.start === s.start;
      inPrologue &&= isString;
      if (s.kind === "empty") continue;
      left--;
      let path: At<"stmt"> = { sort: "stmt", node: s, key: "body", parent: undefined };
      if (parent !== undefined) path = { sort: "stmt", node: s, key: "body", parent: upOf(parent.at) };
      if (inPrologue && s.kind === "expr") printedStmts.push(this.commented(s.id, [directive(src.slice(s.expr.start as i64, s.expr.end as i64)), ";"], src));
      else if (s.kind === "expr" && s.expr.kind === "string") {
        const inner = this.expr(s.expr, "expression", path, src);
        printedStmts.push(this.commented(s.id, ["(", inner, ");"], src));
      } else printedStmts.push(this.statement(path, src));
      // At most one blank line between statements is kept, as Prettier keeps it.
      if (left > 0) {
        printedStmts.push(newHardline());
        printedStmts.push(isNextLineEmpty(src, pastParens(src, s.end)) ? newHardline() : "");
      }
    }
    return printedStmts;
  }

  // A braced block. An empty one prints `{}` as a function's or loop's body, and `{` and `}` on
  // their own lines elsewhere, as Prettier 3 does.
  // `holder` is the id of the block statement whose own comments its caller prints, -1 for none;
  // any other block is the one attachment made for the list.
  // `owner` and `field` name the node and the field holding the list.
  /** @throws {Error | CompileError} */
  block(this: Mut<this>, body: Ref<Stmt[]>, owner: usize, field: string, parent: Ref<Path>, src: string, compact = true, prologue = true, holder: i64 = -1): Doc {
    let id = holder;
    if (holder < 0) {
      const made = this.attached.blocks.get(blockKey(owner, field));
      if (made !== undefined) id = made.id as i64;
    }
    const up: Up | undefined = upOf(parent);
    const printedBody = this.statements(body, up, src, prologue);
    const dangling: Doc[] = id >= 0 ? this.danglingComments(id as usize, src) : [];
    const empty = printedBody.length === 0 && dangling.length === 0;
    const both = printedBody.length > 0 && dangling.length > 0;
    const doc: Doc = empty
      ? compact ? "{}" : ["{", newHardline(), "}"]
      : ["{", indent([newHardline(), printedBody, both ? newHardline() : "", dangling]), newHardline(), "}"];
    return holder >= 0 ? doc : this.commentedIf(id, doc, src);
  }

  // A loop's or `if`'s body: a block after a space, `;` for an empty statement, or one statement
  // indented on the next line. The tree holds a block's statements, so whether it was a block is
  // read from the source: a lone statement written bare follows its `)` or keyword directly.
  /** @throws {Error | CompileError} */
  body(this: Mut<this>, list: Ref<Stmt[]>, before: string, key: string, parent: Ref<At<"stmt">>, src: string, compact: boolean): Doc {
    const bare = list.length === 1 && follows(src, list[0]!.start, before, this.attached.commentStarts);
    if (!bare) return [" ", this.block(list, parent.node.id, key === "consequent" ? "then" : key === "alternate" ? "else" : "body", parent, src, compact, false)];
    const only: Ref<Stmt> = list[0]!;
    const framed: At<"stmt"> = { sort: "stmt", node: only, key, parent: upOf(parent) };
    if (only.kind === "empty") return ";";
    const doc = this.statement(framed, src);
    return key === "alternate" && only.kind === "if" ? [" ", doc] : indent([newLine(), doc]);
  }

  // A condition in `if`, `while` or `do`, broken inside its parentheses unless it is a negated
  // logical expression.
  /** @throws {Error | CompileError} */
  condition(this: Mut<this>, e: Ref<Expr>, parent: Ref<At<"stmt">>, src: string): Doc {
    const doc = this.expr(e, "test", parent, src);
    if (e.kind === "unary" && e.op === "!") {
      const once: Ref<Expr> = e.operand;
      const inner: Ref<Expr> = once.kind === "unary" && once.op === "!" ? once.operand : once;
      if (form(inner) === "logical") return doc;
    }
    return group([indent([newSoftline(), doc]), newSoftline()]);
  }

  /** @throws {Error | CompileError} */
  statement(this: Mut<this>, path: Ref<At<"stmt">>, src: string): Doc {
    const doc = this.statementDoc(path, src);
    return this.commented(path.node.id, doc, src);
  }

  /** @throws {Error | CompileError} */
  statementDoc(this: Mut<this>, path: Ref<At<"stmt">>, src: string): Doc {
    const s = path.node;
    switch (s.kind) {
      case "expr":
        return [this.expr(s.expr, "expression", path, src), ";"];
      case "let":
        return [this.declarations(s.keyword, s.declarations, path, src, false), ";"];
      case "return":
      case "throw": {
        const value: Ref<Expr | undefined> = s.value;
        return [s.kind, value !== undefined ? [" ", this.returned(value, path, src)] : "", ";"];
      }
      case "block":
        return this.block(s.body, s.id, "body", path, src, false, false, s.id as i64);
      case "function":
      {
        const body: Ref<Stmt[] | undefined> = s.body;
        const none: Stmt[] = [];
        const head: FnHead = { name: s.name, async: s.async, generator: s.generator };
        const opts: Opts = {};
        const doc = body !== undefined
          ? this.functionDoc(head, s.id, s.typeParams, s.params, s.returnType, s.throws, body, true, path, src, opts)
          : this.functionDoc(head, s.id, s.typeParams, s.params, s.returnType, s.throws, none, false, path, src, opts);
        return this.macroDecorators(s.decorators, [s.macro ? "macro " : "", doc], path, src);
      }
      case "typeAlias":
      {
        const doc = this.typeAlias(s, path, src);
        return this.macroDecorators(s.decorators, doc, path, src);
      }
      case "comptime":
      case "unsafe":
        return [s.kind, " ", this.block(s.body, s.id, "body", path, src, false, false)];
      case "class":
        return this.classDoc(s, path, src, false);
      case "interface":
      {
        const doc = this.interfaceDoc(s, path, src);
        return this.macroDecorators(s.decorators, doc, path, src);
      }
      case "enum":
      {
        const doc = this.enumDoc(s, path, src);
        return this.macroDecorators(s.decorators, doc, path, src);
      }
      case "namespace":
        return this.namespaceDoc(s, path, src);
      case "declare": {
        // A line break after `declare` would end the statement, so the body's leading comments
        // print before `declare`.
        const declaredNode: Ref<Stmt> = s.body;
        const declared: At<"stmt"> = { sort: "stmt", node: declaredNode, key: "declaration", parent: upOf(path) };
        const list = this.commentsOf(s.body.id);
        let leading: Doc[] = [];
        for (const p of list) if (p.placement === "leading") leading.push(leadingComment(p, src, this.printComment(p)));
        const doc = this.statementDoc(declared, src);
        return [leading, "declare ", this.commented(s.body.id, doc, src, false)];
      }
      case "import":
        return this.importDoc(s, path, src);
      case "importEquals":
        return ["import ", s.typeOnly ? "type " : "", s.name, " = ", s.require !== undefined ? ["require(", this.stringAfter(s.start, src), ")"] : s.entity ?? "", ";"];
      case "export":
      case "exportDefault":
      case "exportNamed":
      case "exportAll":
      case "exportAssign":
      case "exportAsNamespace":
        return this.exportDoc(s, path, src);
      case "empty":
        return "";
      case "debugger":
        return "debugger;";
      case "break":
      case "continue":
        return [s.kind, s.label !== undefined ? [" ", s.label] : "", ";"];
      case "labeled":
        return [s.label, s.body.kind === "empty" ? ":;" : [": ", this.statement({ sort: "stmt", node: s.body, key: "body", parent: upOf(path) }, src)]];
      case "if": {
        const head = group(["if (", this.condition(s.cond, path, src), ")", this.body(s.then, afterParen, "consequent", path, src, false)]);
        const otherwise: Ref<Stmt[] | undefined> = s.else;
        if (otherwise === undefined) return head;
        const thenIsBlock = !(s.then.length === 1 && follows(src, s.then[0]!.start, afterParen, this.attached.commentStarts));
        // Comments before `else` dangle on the `if` and print between the branches.
        const comments = this.commentsOf(s.id).filter((p) => p.placement === "dangling");
        let parts: Doc[] = [head, thenIsBlock ? "" : newHardline()];
        let spaced = thenIsBlock;
        if (comments.length > 0) {
          const first: Ref<Comment> = comments[0]!.comment;
          const last: Ref<Comment> = comments[comments.length - 1]!.comment;
          if (isPreviousLineEmpty(src, first.start)) parts.push(thenIsBlock ? [newHardline(), newHardline()] : newHardline());
          else if (hasNewline(src, first.start, true)) parts.push(thenIsBlock ? newHardline() : "");
          else parts.push(" ");
          parts.push(this.danglingComments(s.id, src));
          parts.push(last.kind !== "block" || hasNewline(src, last.end) ? newHardline() : " ");
          spaced = false;
        }
        parts.push(spaced ? " " : "");
        parts.push("else");
        parts.push(group(this.body(otherwise, "else", "alternate", path, src, false)));
        return parts;
      }
      case "while":
        return group(["while (", this.condition(s.cond, path, src), ")", this.body(s.body, afterParen, "body", path, src, true)]);
      case "doWhile": {
        const loop = this.body(s.body, "do", "body", path, src, true);
        const isBlock = Array.isArray(loop) && loop[0] === " ";
        return [group(["do", loop]), isBlock ? " " : newHardline(), "while (", this.condition(s.cond, path, src), ");"];
      }
      case "for": {
        const loop = this.body(s.body, afterParen, "body", path, src, true);
        const initial: Ref<Stmt | undefined> = s.init;
        const tested: Ref<Expr | undefined> = s.test;
        const updated: Ref<Expr | undefined> = s.update;
        if (initial === undefined && tested === undefined && updated === undefined) return group(["for (;;)", loop]);
        const init = initial === undefined ? "" : this.forInit(initial, path, src);
        const test = tested !== undefined ? this.expr(tested, "test", path, src) : "";
        const update = updated !== undefined ? [newLine(), this.expr(updated, "update", path, src)] : "";
        return group(["for (", group([indent([newSoftline(), init, ";", newLine(), test, ";", update]), newSoftline()]), ")", loop]);
      }
      case "forIn":
      case "forOf": {
        // The parser gives a declaration or, failing that, a pattern.
        const left = this.forLeft(s.left, path, src);
        return group([
          "for", s.await ? " await" : "", " (", left, s.kind === "forOf" ? " of " : " in ", this.expr(s.right, "right", path, src), ")",
          this.body(s.body, afterParen, "body", path, src, false),
        ]);
      }
      case "switch": {
        let cases: Doc[] = [];
        for (const c of s.cases) cases.push(this.switchCase(c, path, src));
        const dangling = this.danglingComments(s.id, src);
        return [
          group(["switch (", indent([newSoftline(), this.expr(s.discriminant, "discriminant", path, src)]), newSoftline(), ")"]), " {",
          cases.length > 0 ? indent([newHardline(), separated(endsOf(s.cases), cases, newHardline(), newHardline(), src)]) : dangling.length > 0 ? indent([newHardline(), dangling]) : "", newHardline(), "}",
        ];
      }
      case "try": {
        let parts: Doc[] = ["try ", this.block(s.block, s.id, "block", path, src, false, false)];
        const handler: Ref<Stmt[] | undefined> = s.handler;
        const finalizer: Ref<Stmt[] | undefined> = s.finalizer;
        if (handler !== undefined) {
          const caught: Ref<Pattern | undefined> = s.param;
          const caughtType: Ref<TypeNode | undefined> = s.paramType;
          const param = caught !== undefined ? ["(", this.pattern(caught, "param", path, src), caughtType !== undefined ? [": ", this.type(caughtType, "typeAnnotation", path, src)] : "", ") "] : "";
          parts.push(" catch ");
          parts.push(param);
          parts.push(this.block(handler, s.id, "handler", path, src, finalizer === undefined, false));
        }
        if (finalizer !== undefined) { parts.push(" finally "); parts.push(this.block(finalizer, s.id, "finalizer", path, src, false, false)); }
        return parts;
      }
    }
    return "";
  }

  /** @throws {Error | CompileError} */
  forInit(this: Mut<this>, init: Ref<Stmt>, path: Ref<At<"stmt">>, src: string): Doc {
    if (init.kind === "expr") return this.expr(init.expr, "init", path, src);
    if (init.kind === "let") {
      const framed: At<"stmt"> = { sort: "stmt", node: init, key: "init", parent: upOf(path) };
      const doc = this.declarations(init.keyword, init.declarations, framed, src, true);
      return this.commented(init.id, doc, src);
    }
    const framed: At<"stmt"> = { sort: "stmt", node: init, key: "init", parent: upOf(path) };
    return this.statement(framed, src);
  }

  // The parser gives a `for...in` or `for...of` a declaration or, failing that, a pattern.
  /** @throws {Error | CompileError} */
  forLeft(this: Mut<this>, left: Ref<Stmt | Pattern>, path: Ref<At<"stmt">>, src: string): Doc {
    switch (left.kind) {
      case "let": {
        const framed: At<"stmt"> = { sort: "stmt", node: left, key: "left", parent: upOf(path) };
        const doc = this.declarations(left.keyword, left.declarations, framed, src, true);
        return this.commented(left.id, doc, src);
      }
      case "ident": return this.pattern(left, "left", path, src);
      case "default": return this.pattern(left, "left", path, src);
      case "expr": return this.pattern(left, "left", path, src);
      case "array": return this.pattern(left, "left", path, src);
      case "object": return this.pattern(left, "left", path, src);
      case "wildcard": return this.pattern(left, "left", path, src);
      case "literal": return this.pattern(left, "left", path, src);
      case "variant": return this.pattern(left, "left", path, src);
      case "or": return this.pattern(left, "left", path, src);
    }
    return "";
  }

  /** @throws {Error | CompileError} */
  switchCase(this: Mut<this>, c: Ref<SwitchCase>, path: Ref<At<"stmt">>, src: string): Doc {
    const dangling = this.danglingComments(c.id, src);
    const test: Ref<Expr | undefined> = c.test;
    const head: Doc = [test !== undefined ? ["case ", this.expr(test, "test", path, src), ":"] : "default:", dangling.length > 0 ? [" ", dangling] : ""];
    const consequent = c.body.filter((x) => x.kind !== "empty");
    if (consequent.length === 0) return this.commented(c.id, head, src);
    const up: Up | undefined = upOf(path);
    const printedBody = this.statements(consequent, up, src, false);
    return this.commented(c.id, [head, consequent.length === 1 && consequent[0]!.kind === "block" ? [" ", printedBody] : indent([newHardline(), printedBody])], src);
  }

  // A returned or thrown binary chain breaks inside parentheses of its own.
  /** @throws {Error | CompileError} */
  returned(this: Mut<this>, e: Ref<Expr>, parent: Ref<At<"stmt">>, src: string): Doc {
    const printedValue = this.expr(e, "argument", parent, src);
    if (this.leadingCommentBreaks(e, src)) return keptOnLine(printedValue);
    return e.kind === "binary" && !isPipe(e) ? group([ifBreak("("), indent([newSoftline(), printedValue]), newSoftline(), ifBreak(")")]) : printedValue;
  }

  // Whether a comment leading `e`, or the leftmost part of it, ends its line, so that `return`,
  // `throw` or `yield` before it would end there (Prettier's returnArgumentHasLeadingComment).
  /** @throws {Error | CompileError} */
  leadingCommentBreaks(this: Mut<this>, e: Ref<Expr>, src: string): boolean {
    const list = this.attached.byNode.get(e.id);
    if (list !== undefined) {
      for (const i of list) {
        const p: Ref<Placed> = this.attached.all[i]!;
        if (p.placement === "leading" && (hasNewline(src, p.comment.end) || (p.comment.kind === "block" && p.comment.text.includes("\n")))) return true;
      }
    }
    if (e.kind === "pipe") return this.leadingCommentBreaks(e.value, src);
    if (leftKey(e) === "") return false;
    return this.leadingCommentBreaks(leftOf(e), src);
  }

  // Declarators after `let`, `const` or `var`, one per line when any has a value, except in a
  // `for` head.
  /** @throws {Error | CompileError} */
  declarations(this: Mut<this>, keyword: string, list: Ref<Declarator[]>, parent: Ref<At<"stmt">>, src: string, inFor: boolean): Doc {
    let printedList: Doc[] = [];
    for (const d of list) printedList.push(this.declarator({ sort: "declarator", node: d, key: "declarations", parent: upOf(parent) }, src));
    const valued = list.some((d) => d.init !== undefined);
    const alone = printedList.length === 1;
    const head = printedList.shift()!;
    const first = alone ? head : indent(head);
    let rest: Doc[] = [];
    while (printedList.length > 0) rest.push([",", valued && !inFor ? newHardline() : newLine(), printedList.shift()!]);
    return group([keyword, " ", first, indent(rest)]);
  }

  /** @throws {Error | CompileError} */
  declarator(this: Mut<this>, path: Ref<At<"declarator">>, src: string): Doc {
    const doc = this.declaratorDoc(path, src);
    return this.commented(path.node.id, doc, src);
  }

  /** @throws {Error | CompileError} */
  declaratorDoc(this: Mut<this>, path: Ref<At<"declarator">>, src: string): Doc {
    const d = path.node;
    const annotation: Ref<TypeNode | undefined> = d.type;
    const left = [this.pattern(d.target, "id", path, src), annotation !== undefined ? [": ", this.type(annotation, "typeAnnotation", path, src)] : ""];
    const init: Ref<Expr | undefined> = d.init;
    if (init === undefined) return left;
    return this.assignment(path, left, " =", init, "init", src);
  }

  // `body` is printed only when `hasBody`, as a `declare function` or an overload has none.
  /** @throws {Error | CompileError} */
  functionDoc(this: Mut<this>, head: Ref<FnHead>, id: usize, typeParams: Ref<TypeParam[]>, params: Ref<Param[]>, returns: Ref<TypeNode | undefined>, throws: Ref<TypeNode | undefined>, body: Ref<Stmt[]>, hasBody: boolean, path: Ref<Path>, src: string, opts: Ref<Opts>): Doc {
    const p = parentExpr(path);
    const expandParams = opts.expandLastArg === true && p.kind === "call" &&
      (p.args > 1 || params.every((x) => x.pattern.kind === "ident" && !x.rest && x.default === undefined && x.type === undefined));
    const typeParamsDoc = this.typeParameters(typeParams, path, src);
    const signature = this.signature(typeParams, params, returns, throws, path, src, expandParams);
    return [
      head.async ? "async " : "", "function", head.generator ? "*" : "", " ", head.name, typeParamsDoc,
      signature, hasBody ? [" ", this.block(body, id, "body", path, src)] : ";",
    ];
  }

  // A method's or accessor's type parameters, parameters, return type and body, after its name.
  /** @throws {Error | CompileError} */
  methodRest(this: Mut<this>, id: usize, typeParams: Ref<TypeParam[]>, params: Ref<Param[]>, returns: Ref<TypeNode | undefined>, throws: Ref<TypeNode | undefined>, body: Ref<Stmt[]>, path: Ref<Path>, src: string): Doc {
    const typeParamsDoc = this.typeParameters(typeParams, path, src);
    const signature = this.signature(typeParams, params, returns, throws, path, src, false);
    return [typeParamsDoc, signature, " ", this.block(body, id, "body", path, src)];
  }

  /** @throws {Error | CompileError} */
  signature(this: Mut<this>, typeParams: Ref<TypeParam[]>, params: Ref<Param[]>, returns: Ref<TypeNode | undefined>, throws: Ref<TypeNode | undefined>, path: Ref<Path>, src: string, expandParams: boolean): Doc {
    const printedParams = this.parameters(params, path, src, expandParams, "");
    const returned = this.returnType(returns, throws, path, src);
    const grouped = shouldGroupParameters(typeParams, params.length, returns !== undefined, returns !== undefined && isObjectType(returns), returned);
    return group([grouped ? group(printedParams) : printedParams, returned]);
  }

  // `: T`, and Fish's ` throws E` after it.
  // `beforeArrow` marks an arrow's, which `=>` must follow on its line.
  /** @throws {Error | CompileError} */
  returnType(this: Mut<this>, returns: Ref<TypeNode | undefined>, throws: Ref<TypeNode | undefined>, path: Ref<Path>, src: string, beforeArrow = false): Doc {
    const returnDoc = returns !== undefined ? [": ", this.type(returns, "returnType", path, src, { deferTrailing: beforeArrow })] : "";
    const throwsDoc = throws !== undefined ? [" throws ", this.type(throws, "throws", path, src)] : "";
    return [returnDoc, throwsDoc];
  }

  // Prettier's printFunctionParameters: one per line when they don't fit, run together inside a
  // hugged argument or a test call, and around a lone destructured parameter. `typeParams` is
  // printed before the `(` where Prettier puts it inside the parameters' group.
  // `holder` is the node empty parentheses' comments dangle on, when it isn't `path`'s.
  /** @throws {Error | CompileError} */
  parameters(this: Mut<this>, list: Ref<Param[]>, path: Ref<Path>, src: string, expandArg: boolean, typeParams: Doc, holder: i64 = -1): Doc {
    if (list.length === 0) return [typeParams, "(", this.danglingInside(holder >= 0 ? holder as usize : frameId(path), src), ")"];
    const p = parentExpr(path);
    const inTestCall = path.key === "arguments" && p.testCall;
    const hug = shouldHugTheOnlyParameter(list);
    let parts: Doc[] = [];
    for (let i: usize = 0; i < list.length; i++) {
      parts.push(this.param(list[i]!, path, src));
      if (i < list.length - 1) { parts.push(","); parts.push(inTestCall || hug ? " " : newLine()); }
    }
    if (expandArg && !this.curriedCallbackAssigned(path)) {
      if (willBreak(typeParams) || willBreak(parts)) throw new Error(BAILOUT);
      return group([removeLines(typeParams), "(", removeLines(parts), ")"]);
    }
    if ((hug && list.every((x) => x.decorators.length === 0)) || inTestCall) return [typeParams, "(", ...parts, ")"];
    return [typeParams, "(", indent([newSoftline(), ...parts]), list[list.length - 1]!.rest ? "" : ifBreak(","), newSoftline(), ")"];
  }

  // `const x = f(a)(() => { ... })`: the callback's parameters may still break.
  /** @throws {Error | CompileError} */
  curriedCallbackAssigned(this: Mut<this>, path: Ref<Path>): boolean {
    if (path.sort !== "expr" || path.node.kind !== "arrow" || !Array.isArray(path.node.body) || path.key !== "arguments") return false;
    const u: Ref<Up | undefined> = path.parent;
    if (u === undefined) return false;
    const call: Ref<Path> = u.at;
    if (call.sort !== "expr" || call.node.kind !== "call" || call.node.args.length !== 1 || call.node.callee.kind !== "call") return false;
    const inner: Ref<Expr> = call.node.callee.callee;
    const simple = inner.kind === "ident" || (inner.kind === "member" && inner.object.kind === "ident" && !inner.name.startsWith("#"));
    const v: Ref<Up | undefined> = call.parent;
    if (!simple || v === undefined) return false;
    const owner: Ref<Path> = v.at;
    return (owner.sort === "declarator" && call.key === "init") || stmtKindAt(owner) === "exportDefault" ||
      (owner.sort === "expr" && owner.node.kind === "assign" && call.key === "right" && dotted(owner.node.target) === "module.exports");
  }

  // A parameter's decorators stay on its line unless one was written with a line break after it.
  /** @throws {Error | CompileError} */
  param(this: Mut<this>, x: Ref<Param>, fn: Ref<Path>, src: string): Doc {
    const path: At<"param"> = { sort: "param", node: x, key: "params", parent: upOf(fn) };
    const annotation: Ref<TypeNode | undefined> = x.type;
    const initial: Ref<Expr | undefined> = x.default;
    let modifiers: Doc[] = [];
    for (const m of x.modifiers) modifiers.push([m, " "]);
    const doc: Doc = [
      modifiers, x.comptime ? "comptime " : "", x.rest ? "..." : "", this.pattern(x.pattern, "pattern", path, src), x.optional ? "?" : "",
      annotation !== undefined ? [": ", this.type(annotation, "typeAnnotation", path, src)] : "", initial !== undefined ? [" = ", this.expr(initial, "right", path, src)] : "",
    ];
    if (x.decorators.length === 0) return this.commented(x.id, doc, src);
    const brokenAfter = x.decorators.some((d) => /^\)*[ \t]*\r?\n/.test(src.slice(d.end as i64)));
    let decorators: Doc[] = [];
    for (const d of x.decorators) decorators.push(this.decorator(d, path, src));
    return this.commented(x.id, group([brokenAfter ? newBreakParent() : "", join(newLine(), decorators), newLine(), doc]), src);
  }

  /** @throws {Error | CompileError} */
  pattern(this: Mut<this>, p: Ref<Pattern>, key: string, parent: Ref<Path>, src: string): Doc {
    const doc = this.patternDoc(p, key, parent, src);
    return this.commented(p.id, doc, src);
  }

  /** @throws {Error | CompileError} */
  patternDoc(this: Mut<this>, p: Ref<Pattern>, key: string, parent: Ref<Path>, src: string): Doc {
    const path: At<"pattern"> = { sort: "pattern", node: p, key, parent: upOf(parent) };
    switch (p.kind) {
      case "ident":
        return p.name;
      case "default":
        return [this.pattern(p.target, "left", path, src), " = ", this.expr(p.value, "right", path, src)];
      case "expr":
        return this.expr(p.expr, "expression", path, src);
      case "array": {
        const rest: Ref<Pattern | undefined> = p.rest;
        if (p.elements.length === 0 && rest === undefined) return group(["[", this.danglingInside(p.id, src), "]"]);
        let items: Doc[] = [newSoftline()];
        for (let i: usize = 0; i < p.elements.length; i++) {
          const x: Ref<Pattern | undefined> = p.elements[i];
          items.push([x !== undefined ? group(this.pattern(x, "elements", path, src)) : "", i < p.elements.length - 1 || rest !== undefined ? [",", newLine()] : ""]);
        }
        const trailing = rest !== undefined ? "" : p.elements.length > 0 && p.elements[p.elements.length - 1] === undefined ? "," : ifBreak(",");
        items.push(rest !== undefined ? ["...", this.pattern(rest, "argument", path, src)] : "");
        items.push(trailing);
        return group(["[", indent(items), newSoftline(), "]"]);
      }
      case "object":
        return this.objectPattern(p, path, src);
      case "wildcard":
        return "_";
      case "literal":
        return this.expr(p.value, "literal", path, src);
      case "variant":
        return this.variantPattern(p, path, src);
      case "or":
        return this.orPattern(p, path, src);
    }
    return "";
  }

  /** @throws {Error | CompileError} */
  objectPattern(this: Mut<this>, p: Ref<Extract<Pattern, { kind: "object" }>>, path: Ref<At<"pattern">>, src: string): Doc {
    const rest: Ref<Pattern | undefined> = p.rest;
    if (p.props.length === 0 && rest === undefined) return "{}";
    let parts: Doc[] = [];
    for (const prop of p.props) parts.push(this.patternProp(prop, path, src));
    if (rest !== undefined) parts.push(["...", this.pattern(rest, "argument", path, src)]);
    const up = upInfo(path);
    const nested = up.sort !== "param" && !(up.sort === "pattern" && up.kind === "default") && !inMatch(path) &&
      p.props.some((x) => x.value.kind === "object" || x.value.kind === "array");
    const doc = ["{", indent([newLine(), join([",", newLine()], parts)]), rest !== undefined ? "" : ifBreak(","), newLine(), "}"];
    const assigned = up.sort === "declarator" || (up.sort === "expr" && up.kind === "destructure");
    return huggedParam(path) || (!nested && assigned) ? doc : group(doc, { shouldBreak: nested });
  }

  /** @throws {Error | CompileError} */
  patternProp(this: Mut<this>, prop: Ref<PatternProp>, path: Ref<At<"pattern">>, src: string): Doc {
    // Shorthand, as in `{ a }` or `{ a = 1 }`, shares its start with the property.
    if (prop.value.start === prop.start) {
      const doc = this.pattern(prop.value, "value", path, src);
      return this.commented(prop.id, doc, src);
    }
    const key = this.propertyKey(prop.key, prop.start, 0, path, src);
    const keyText = flatText(key);
    const layout: Layout = !hasLine(key) && keyText !== undefined && [...keyText].length < 5 ? "never-break-after-operator" : "fluid";
    const value = this.pattern(prop.value, "value", path, src);
    const doc = this.layoutDoc(layout, key, ":", value);
    return this.commented(prop.id, doc, src);
  }

  // `<T extends U = V, ...>` on a declaration; a lone plain one on an arrow prints as `<T,>`, as
  // Prettier writes it where the file could be TSX.
  /** @throws {Error | CompileError} */
  typeParameters(this: Mut<this>, list: Ref<TypeParam[]>, owner: Ref<Path>, src: string): Doc {
    if (list.length === 0) return "";
    let printedParams: Doc[] = [];
    for (const t of list) printedParams.push(this.typeParameter(t, owner, src));
    const lone = list.length === 1 && list[0]!.constraint === undefined && owner.sort === "expr" && owner.node.kind === "arrow";
    return group(["<", indent([newSoftline(), join([",", newLine()], printedParams)]), lone ? "," : ifBreak(","), newSoftline(), ">"]);
  }

  /** @throws {Error | CompileError} */
  typeParameter(this: Mut<this>, t: Ref<TypeParam>, owner: Ref<Path>, src: string): Doc {
    let parts: Doc[] = [t.modifiers.includes("const") ? "const " : "", t.modifiers.includes("in") ? "in " : "", t.modifiers.includes("out") ? "out " : "", t.name];
    const constraint: Ref<TypeNode | undefined> = t.constraint;
    const fallback: Ref<TypeNode | undefined> = t.default;
    if (constraint !== undefined) {
      parts.push(" extends");
      const bound = this.type(constraint, "constraint", owner, src);
      pushAll(parts, this.hangingValue(bound));
    }
    if (fallback !== undefined) {
      parts.push(" =");
      const given = this.type(fallback, "default", owner, src);
      pushAll(parts, this.hangingValue(given));
    }
    return this.commented(t.id, group(parts), src);
  }

  // A value that moves to the next line, indented, when it doesn't fit after its keyword.
  /** @throws {Error | CompileError} */
  hangingValue(this: Mut<this>, doc: Doc): Doc[] {
    const id = this.groupId("hanging");
    return [group(indent(newLine()), { id }), newLineSuffixBoundary(), indentIfBreak(doc, { groupId: id })];
  }

  /** @throws {Error | CompileError} */
  type(this: Mut<this>, t: Ref<TypeNode>, key: string, parent: Ref<Path>, src: string, opts: Opts = {}): Doc {
    const doc = this.bareType(t, key, parent, src, { ...opts, deferTrailing: undefined });
    return this.commented(t.id, doc, src, true, opts.deferTrailing === true);
  }

  // A type without its comments, for a union to place them around its `|`.
  /** @throws {Error | CompileError} */
  bareType(this: Mut<this>, t: Ref<TypeNode>, key: string, parent: Ref<Path>, src: string, opts: Opts = {}): Doc {
    const path: At<"type"> = { sort: "type", node: t, key, parent: upOf(parent) };
    const doc = this.typeDoc(path, src, opts);
    return typeNeedsParens(path) ? ["(", doc, ")"] : doc;
  }

  /** @throws {Error | CompileError} */
  typeDoc(this: Mut<this>, path: Ref<At<"type">>, src: string, opts: Ref<Opts>): Doc {
    const t = path.node;
    switch (t.kind) {
      case "ref":
        return [t.name, this.typeArguments(t.args, path, src)];
      case "literal":
        return this.expr(t.value, "literal", path, src);
      case "array":
        return [this.type(t.element, "elementType", path, src, { deferTrailing: true }), "[]"];
      case "tuple":
        return this.tupleType(t, path, src);
      case "object":
        return this.objectType(t, path, src);
      case "function": {
        const typeParams = this.typeParameters(t.typeParams, path, src);
        const params = this.parameters(t.params, path, src, false, typeParams);
        const throws: Ref<TypeNode | undefined> = t.throws;
        const returnDoc = this.type(t.returns, "returnType", path, src);
        const returned: Doc = [" => ", returnDoc, throws !== undefined ? [" throws ", this.type(throws, "throws", path, src)] : ""];
        const head: Doc = [t.abstract ? "abstract " : "", t.construct ? "new " : ""];
        return group([head, shouldGroupParameters(t.typeParams, t.params.length, true, isObjectType(t.returns), returned) ? group(params) : params, returned]);
      }
      case "union":
        return this.unionType(t, path, src, opts);
      case "intersection":
        return this.intersectionType(t, path, src);
      case "operator":
        return [t.op, " ", this.type(t.type, "typeAnnotation", path, src)];
      case "indexed":
        return [this.type(t.object, "objectType", path, src, { deferTrailing: true }), "[", this.type(t.index, "indexType", path, src), "]"];
      case "query":
        return ["typeof ", this.type(t.target, "exprName", path, src)];
      case "import": {
        const at = (src.indexOf("(", t.start as i64) + 1) as usize;
        let tokens = lexer(src.slice(at as i64));
        const literal = tokens.next();
        const name: string | undefined = t.name;
        return ["import(", this.quoted(src.slice((at + literal.start) as i64, (at + literal.end) as i64)), ")", name !== undefined ? [".", name] : "", this.typeArguments(t.args, path, src)];
      }
      case "conditional":
        return this.conditionalType(t, path, src);
      case "infer":
      {
        const constraint: Ref<TypeNode | undefined> = t.constraint;
        if (constraint === undefined) return ["infer ", group([t.name, ""])];
        const bound = this.type(constraint, "constraint", path, src);
        let bounded: Doc[] = [" extends"];
        pushAll(bounded, this.hangingValue(bound));
        return ["infer ", group([t.name, bounded])];
      }
      case "template":
        return this.templateType(t, path, src);
      case "mapped":
        return this.mappedType(t, path, src);
      case "predicate":
      {
        const asserted: Ref<TypeNode | undefined> = t.type;
        return [t.asserts ? "asserts " : "", t.name, asserted !== undefined ? [" is ", this.type(asserted, "typeAnnotation", path, src)] : ""];
      }
    }
    return "";
  }

  // `<A, B>` after a call, a `new`, an instantiation or a type name; one simple or object type
  // never breaks.
  /** @throws {Error | CompileError} */
  typeArguments(this: Mut<this>, args: Ref<TypeNode[]>, parent: Ref<Path>, src: string): Doc {
    if (args.length === 0) return "";
    let printedArgs: Doc[] = [];
    for (const t of args) printedArgs.push(this.type(t, "params", parent, src));
    const only: Ref<TypeNode> = args[0]!;
    // Comments that end their line put the arguments on lines of their own.
    let breakingComments = false;
    for (const t of args) if (this.commentsOf(t.id).some((p) => p.comment.kind !== "block" || hasNewline(src, p.comment.end))) breakingComments = true;
    const keepsTogether = !breakingComments && (isSimpleType(only) || isObjectType(only) || (only.kind === "union" && simpleUnion(only.types)));
    if (args.length === 1 && keepsTogether) return ["<", printedArgs, ">"];
    return group(["<", indent([newSoftline(), join([",", newLine()], printedArgs)]), newSoftline(), ">"]);
  }

  /** @throws {Error | CompileError} */
  tupleType(this: Mut<this>, t: Ref<Extract<TypeNode, { kind: "tuple" }>>, path: Ref<At<"type">>, src: string): Doc {
    if (t.elements.length === 0) return group(["[", this.danglingInside(t.id, src), "]"]);
    let items: Doc[] = [];
    let i: usize = 0;
    for (const x of t.elements) {
      const name: string | undefined = x.name;
      let doc: Doc;
      if (name !== undefined) doc = [x.rest ? "..." : "", name, x.optional ? "?" : "", ": ", this.type(x.type, "elementType", path, src)];
      else if (x.rest) doc = ["...", this.type(x.type, "restType", path, src)];
      else if (x.optional) doc = [this.type(x.type, "optionalType", path, src), "?"];
      else doc = this.type(x.type, "elementTypes", path, src);
      items.push([group(this.commented(x.id, doc, src)), i < t.elements.length - 1 ? [",", newLine()] : ""]);
      i++;
    }
    return group(["[", indent([newSoftline(), items, ifBreak(",")]), newSoftline(), "]"]);
  }

  // A union broken one member per line with a leading `|`, indented under what holds it unless
  // that already sets it apart.
  /** @throws {Error | CompileError} */
  unionType(this: Mut<this>, t: Ref<Extract<TypeNode, { kind: "union" | "intersection" }>>, path: Ref<At<"type">>, src: string, opts: Ref<Opts>): Doc {
    if (simpleUnion(t.types)) {
      let printedTypes: Doc[] = [];
      for (const x of t.types) printedTypes.push(this.type(x, "types", path, src));
      return join(" | ", printedTypes);
    }
    // A member's leading comments go after its `|`, aligned with it; its trailing ones after it.
    let printedMembers: Doc[] = [];
    let i: usize = 0;
    for (const x of t.types) {
      const d = this.bareType(x, "types", path, src);
      const prefix: Doc = i === 0 ? ifBreak("| ") : [newLine(), "| "];
      printedMembers.push(this.hasComments(x.id, "leading") ? [prefix, align(2, this.commented(x.id, d, src))] : [prefix, this.commented(x.id, align(2, d), src)]);
      i++;
    }
    const members = group(printedMembers);
    if (typeNeedsParens(path)) return group([indent([newSoftline(), members]), newSoftline()]);
    const up = upInfo(path);
    if (path.key === "elementTypes" && up.sort === "type" && up.kind === "tuple" && inLongTuple(path)) {
      return group([indent([ifBreak(["(", newSoftline()]), members]), newSoftline(), ifBreak(")")]);
    }
    const pk = up.sort === "type" ? up.kind : "";
    const setApart = (path.key === "typeAnnotation" && up.sort === "expr" && up.kind === "assertion") ||
      path.key === "elementTypes" || ((path.key === "trueType" || path.key === "falseType") && pk === "conditional") || path.key === "params";
    return opts.assignmentLayout === "break-after-operator" || setApart ? members : group(indent([newSoftline(), members]));
  }

  // Members joined by ` & `, breaking before each that isn't an object type.
  /** @throws {Error | CompileError} */
  intersectionType(this: Mut<this>, t: Ref<Extract<TypeNode, { kind: "union" | "intersection" }>>, path: Ref<At<"type">>, src: string): Doc {
    let wasIndented = false;
    let parts: Doc[] = [];
    let i: usize = 0;
    for (const x of t.types) {
      const doc = this.type(x, "types", path, src);
      i++;
      if (i === 1) {
        parts.push(doc);
        continue;
      }
      const at = i - 1;
      const isObject = isObjectType(x);
      const previousIsObject = isObjectType(t.types[at - 1]!);
      if (previousIsObject && isObject) parts.push([" & ", wasIndented ? indent(doc) : doc]);
      else if (!previousIsObject && !isObject) parts.push(indent([" &", newLine(), doc]));
      else {
        if (at > 1) wasIndented = true;
        parts.push([" & ", at > 1 ? indent(doc) : doc]);
      }
    }
    return group(parts);
  }

  // An object type literal; members end in `;`, and one written with a line break after its `{`
  // stays expanded.
  /** @throws {Error | CompileError} */
  objectType(this: Mut<this>, t: Ref<Extract<TypeNode, { kind: "object" }>>, path: Ref<At<"type">>, src: string): Doc {
    const dangling = this.danglingComments(t.id, src);
    if (t.members.length === 0) {
      if (dangling.length === 0) return "{}";
      const lineComment = this.commentsOf(t.id).some((p) => p.placement === "dangling" && p.comment.kind !== "block");
      const [around, again] = dup(lineComment ? newLine() : newSoftline());
      return group(["{", indent([around, dangling]), again, "}"], { shouldBreak: lineComment });
    }
    let members: Doc[] = [];
    for (let i: usize = 0; i < t.members.length; i++) members.push([this.typeMember(t.members[i]!, path, src), i === t.members.length - 1 ? ifBreak(";") : ";"]);
    const doc: Doc = ["{", indent([newLine(), separated(endsOf(t.members), members, newLine(), newHardline(), src)]), newLine(), "}"];
    const expanded = src.slice(t.start as i64, t.members[0]!.start as i64).includes("\n");
    return huggedParam(path) && path.key === "typeAnnotation" ? doc : group(doc, { shouldBreak: expanded });
  }

  /** @throws {Error | CompileError} */
  typeMember(this: Mut<this>, m: Ref<TypeMember>, parent: Ref<At<"type">>, src: string): Doc {
    const doc = this.typeMemberDoc(m, parent, src);
    return this.commented(m.id, doc, src);
  }

  /** @throws {Error | CompileError} */
  typeMemberDoc(this: Mut<this>, m: Ref<TypeMember>, parent: Ref<At<"type">>, src: string): Doc {
    switch (m.kind) {
      case "property": {
        const annotation: Ref<TypeNode | undefined> = m.type;
        const key = this.propertyKey(m.name, m.start, m.readonly ? 1 : 0, parent, src);
        return [m.readonly ? "readonly " : "", key, m.optional ? "?" : "",
          annotation !== undefined ? [": ", this.type(annotation, "typeAnnotation", parent, src)] : ""];
      }
      case "index": {
        let params: Doc[] = [];
        for (const x of m.params) params.push(this.param(x, parent, src));
        return [m.readonly ? "readonly " : "", "[", group([indent([newSoftline(), join([", ", newSoftline()], params)]), m.params.length > 1 ? ifBreak(",") : "", newSoftline()]),
          "]", ": ", this.type(m.type, "typeAnnotation", parent, src)];
      }
      case "call": {
        const none: TypeNode | undefined = undefined;
        let parts: Doc[] = [""];
        pushAll(parts, this.memberSignature(m.id, m.typeParams, m.params, m.returns, none, parent, src, false));
        return group(parts);
      }
      case "construct": {
        const none: TypeNode | undefined = undefined;
        let parts: Doc[] = ["new "];
        pushAll(parts, this.memberSignature(m.id, m.typeParams, m.params, m.returns, none, parent, src, false));
        return group(parts);
      }
      case "method": {
        let parts: Doc[] = [this.propertyKey(m.name, m.start, 0, parent, src), m.optional ? "?" : ""];
        pushAll(parts, this.memberSignature(m.id, m.typeParams, m.params, m.returns, m.throws, parent, src, true));
        return group(parts);
      }
      case "get":
      case "set": {
        const none: TypeNode | undefined = undefined;
        const noTypeParams: TypeParam[] = [];
        let parts: Doc[] = [m.kind, " ", this.propertyKey(m.name, m.start, 1, parent, src)];
        pushAll(parts, this.memberSignature(m.id, noTypeParams, m.params, m.returns, none, parent, src, true));
        return group(parts);
      }
    }
    return "";
  }

  // A signature's parameters and return type; a method's return type is grouped on its own.
  /** @throws {Error | CompileError} */
  memberSignature(this: Mut<this>, id: usize, typeParams: Ref<TypeParam[]>, list: Ref<Param[]>, returns: Ref<TypeNode | undefined>, throws: Ref<TypeNode | undefined>, parent: Ref<At<"type">>, src: string, method: boolean): Doc[] {
    const typeParamsDoc = this.typeParameters(typeParams, parent, src);
    const params = this.parameters(list, parent, src, false, typeParamsDoc, id as i64);
    const returnDoc = returns !== undefined ? [": ", this.type(returns, "returnType", parent, src)] : "";
    const returned: Doc = [returnDoc, throws !== undefined ? [" throws ", this.type(throws, "throws", parent, src)] : ""];
    const grouped = shouldGroupParameters(typeParams, list.length, returns !== undefined, returns !== undefined && isObjectType(returns), returned);
    return [grouped ? group(params) : params, method && (returns !== undefined || throws !== undefined) ? group(returned) : returned];
  }

  // `{ readonly [K in T as N]?: V }`; one written with a line break after its `{` stays expanded.
  /** @throws {Error | CompileError} */
  mappedType(this: Mut<this>, t: Ref<Extract<TypeNode, { kind: "mapped" }>>, path: Ref<At<"type">>, src: string): Doc {
    const renamed: Ref<TypeNode | undefined> = t.as;
    const afterKey = (src.indexOf("]", (renamed !== undefined ? renamed.end : t.constraint.end) as i64) + 1) as usize;
    const space = /^\s*/.exec(src.slice((t.start + 1) as i64));
    const expanded = space !== null && space[0].includes("\n");
    const constraint = this.type(t.constraint, "sourceType", path, src);
    const key = group(["[", indent([newSoftline(), t.name, " in ", constraint, renamed !== undefined ? [" as ", this.type(renamed, "nameType", path, src)] : ""]), newSoftline(), "]"]);
    let dangling = this.commentsOf(t.id).filter((p) => p.placement === "dangling");
    let before: Doc = "";
    const lastDangling = dangling.pop();
    if (lastDangling !== undefined) {
      const several = dangling.length > 0;
      const earlier = join(newHardline(), this.printComments(dangling));
      const lastDoc = this.printComment(lastDangling);
      before = [earlier, several ? newHardline() : "", group([lastDoc, lastDangling.comment.kind !== "block" || hasNewline(src, lastDangling.comment.end) ? newHardline() : newLine()])];
    }
    const value: Ref<TypeNode | undefined> = t.type;
    const readonly: "+" | "-" | undefined = t.readonly;
    return group([
      "{",
      indent([
        newLine(), before, readonly !== undefined ? [signed(src, t.start + 1, readonly, "readonly"), " "] : "", key, signed(src, afterKey, t.optional, "?"),
        value !== undefined ? [": ", this.type(value, "typeAnnotation", path, src)] : "", ifBreak(";"),
      ]),
      newLine(), "}",
    ], { shouldBreak: expanded });
  }

  // A template literal type, its text as written and each `${}` printed as in a template literal.
  /** @throws {Error | CompileError} */
  templateType(this: Mut<this>, t: Ref<Extract<TypeNode, { kind: "template" }>>, path: Ref<At<"type">>, src: string): Doc {
    // The tree keeps the decoded text, so each piece is read again from the source.
    let parts: Doc[] = [newLineSuffixBoundary(), "`"];
    let from = t.start + 1;
    for (const x of t.types) {
      const open = src.lastIndexOf("${", x.start as i64);
      parts.push(join(newLiteralline(), textLines(src.slice(from as i64, open))));
      parts.push(group(["${", this.type(x, "types", path, src), newLineSuffixBoundary(), "}"]));
      from = (src.indexOf("}", x.end as i64) + 1) as usize;
    }
    parts.push(join(newLiteralline(), textLines(src.slice(from as i64, (t.end - 1) as i64))));
    parts.push("`");
    return parts;
  }

  // A conditional type in Prettier's default layout: a chain in the false branch kept at one
  // indentation, as conditional expressions are.
  /** @throws {Error | CompileError} */
  conditionalType(this: Mut<this>, t: Ref<Extract<TypeNode, { kind: "conditional" }>>, path: Ref<At<"type">>, src: string): Doc {
    const up = upInfo(path);
    const pk = up.sort === "type" ? up.kind : "";
    const inCheck = pk === "conditional" && (path.key === "checkType" || path.key === "extendsType");
    const forceNoIndent = pk === "conditional" && !inCheck;
    // Whether this sits in a chain of conditionals, in another's branch.
    const chained = pk === "conditional" && !inCheck;
    const nested = t.then.kind === "conditional";
    const parts: Doc = [
      newLine(), "? ", nested ? ifBreak("", "(") : "", align(2, this.type(t.then, "trueType", path, src)), nested ? ifBreak("", ")") : "",
      newLine(), ": ", align(2, this.type(t.else, "falseType", path, src)),
    ];
    const head: Doc = [this.type(t.check, "checkType", path, src, { deferTrailing: true }), " extends ", this.type(t.extends, "extendsType", path, src)];
    const contents: Doc = [pk === "conditional" && path.key === "falseType" ? align(2, head) : head, forceNoIndent ? parts : indent(parts)];
    const result = chained ? contents : group(contents);
    return inCheck ? group([indent([newSoftline(), result]), newSoftline()]) : result;
  }

  // `type A<T> = ...`, laid out as an assignment: a union breaks after the `=`, as does a
  // conditional type testing generic types.
  /** @throws {Error | CompileError} */
  typeAlias(this: Mut<this>, s: Ref<Extract<Stmt, { kind: "typeAlias" }>>, path: Ref<At<"stmt">>, src: string): Doc {
    const left: Doc = ["type ", s.name, this.typeParameters(s.typeParams, path, src)];
    const t: Ref<TypeNode> = s.type;
    let layout: Layout = "fluid";
    if ((t.kind === "union" && !simpleUnion(t.types)) || (t.kind === "conditional" && (genericType(t.check) || genericType(t.extends)))) layout = "break-after-operator";
    else if (s.typeParams.length > 1 && s.typeParams.some((x) => x.constraint !== undefined || x.default !== undefined)) layout = "break-lhs";
    const right = this.type(t, "typeAnnotation", path, src, { assignmentLayout: layout });
    return [this.layoutDoc(layout, left, " =", right), ";"];
  }

  /** @throws {Error | CompileError} */
  expr(this: Mut<this>, e: Ref<Expr>, key: string, parent: Ref<Path>, src: string): Doc {
    return this.printed(exprAt(e, key, parent), src);
  }

  // An expression with the parentheses its place needs, keeping its label.
  /** @throws {Error | CompileError} */
  printed(this: Mut<this>, path: Ref<At<"expr">>, src: string, opts: Opts = {}): Doc {
    const plain = opts.expandFirstArg === undefined && opts.expandLastArg === undefined && opts.assignmentLayout === undefined && opts.deferTrailing !== true;
    const u: Ref<Up | undefined> = path.parent;
    const parentId: i64 = u === undefined ? -1 : frameId(u.at) as i64;
    if (plain) {
      const cached = this.printedCache.get(path.node.id);
      if (cached !== undefined && cached.parent === parentId && cached.key === path.key) return cached.doc;
    }
    const inner = this.withParens(path, src, { ...opts, deferTrailing: undefined });
    const doc = this.commented(path.node.id, inner, src, true, opts.deferTrailing === true);
    if (!plain) return doc;
    // Read back from the cache, the same document in JS and a copy of it in Fish.
    this.printedCache.set(path.node.id, { parent: parentId, key: path.key, doc });
    const stored = this.printedCache.get(path.node.id);
    return stored === undefined ? "" : stored.doc;
  }

  /** @throws {Error | CompileError} */
  withParens(this: Mut<this>, path: Ref<At<"expr">>, src: string, opts: Ref<Opts>): Doc {
    const doc = this.expression(path, src, opts);
    if (!this.needsParens(path)) return doc;
    if (typeof doc === "object" && !Array.isArray(doc) && doc.kind === "label") return label(doc.label, ["(", doc.contents, ")"]);
    return ["(", doc, ")"];
  }

  /** @throws {Error | CompileError} */
  expression(this: Mut<this>, path: Ref<At<"expr">>, src: string, opts: Ref<Opts>): Doc {
    const e = path.node;
    switch (e.kind) {
      case "arrow":
        return this.arrow(e, path, src, opts);
      case "function":
      {
        const head: FnHead = { name: e.name ?? "", async: e.async, generator: e.generator };
        const none: TypeNode | undefined = undefined;
        return this.functionDoc(head, e.id, e.typeParams, e.params, e.returnType, none, e.body, true, path, src, opts);
      }
      case "class":
        return this.classDoc(e, path, src, false);
      case "match":
        return this.matchDoc(e, path, src);
      case "topic":
        return "%";
      case "pipe":
        return this.binary(e, path, src);
      case "comptime":
        return ["comptime ", this.expr(e.expr, "argument", path, src)];
      case "throw": {
        const value = this.expr(e.value, "argument", path, src);
        return ["throw ", this.leadingCommentBreaks(e.value, src) ? keptOnLine(value) : value];
      }
      case "unsafe":
        return group(["unsafe {", indent([newLine(), this.expr(e.expr, "expression", path, src)]), newLine(), "}"]);
      case "object":
        return this.object(e, path, src);
      case "array":
        return this.array(e, path, src);
      case "template":
        return this.template(e, path, src);
      case "tagged":
        return [this.expr(e.tag, "tag", path, src), this.typeArguments(e.typeArgs, path, src), newLineSuffixBoundary(), this.expr(e.template, "quasi", path, src)];
      case "regex":
      {
        let flags = [...e.flags];
        flags.sort();
        return `/${e.pattern}/${flags.join("")}`;
      }
      case "destructure": {
        const left = this.pattern(e.pattern, "left", path, src);
        return this.assignment(path, left, " =", e.value, "right", src);
      }
      case "ident":
        return e.name;
      case "this":
      case "super":
      case "null":
        return e.kind;
      case "bool":
        return String(e.value);
      case "int":
        return number(src.slice(e.start as i64, e.end as i64));
      case "float": {
        // Fish's floats and integers are different types, so `5.` and `1e0` stay floats as `5.0`
        // and `1.0` where Prettier would print `5` and `1`.
        const text = number(src.slice(e.start as i64, e.end as i64));
        return /[.e]/.test(text) ? text : `${text}.0`;
      }
      case "bigint":
        return src.slice(e.start as i64, e.end as i64).toLowerCase();
      case "string":
        return this.quoted(src.slice(e.start as i64, e.end as i64));
      case "privateName":
      case "meta":
        return e.name;
      case "spread":
        return ["...", this.expr(e.value, "argument", path, src)];
      case "unary":
        return e.op === "await" ? this.awaited(e, path, src) : [e.op, /[a-z]$/.test(e.op) ? " " : "", this.expr(e.operand, "argument", path, src)];
      case "update": {
        // A postfix `++` can't start a line either.
        const operand = this.printed(exprAt(e.operand, "argument", path), src, e.prefix ? {} : { deferTrailing: true });
        return e.prefix ? [e.op, operand] : [operand, e.op];
      }
      case "yield": {
        const yielded: Ref<Expr | undefined> = e.value;
        if (yielded === undefined) return [e.delegate ? "yield*" : "yield", ""];
        const value = this.expr(yielded, "argument", path, src);
        if (value === "") return [e.delegate ? "yield*" : "yield", ""];
        return [e.delegate ? "yield*" : "yield", [" ", this.leadingCommentBreaks(yielded, src) ? keptOnLine(value) : value]];
      }
      case "binary":
        return this.binary(e, path, src);
      case "assign": {
        const left = this.expr(e.target, "left", path, src);
        return this.assignment(path, left, [" ", e.op], e.value, "right", src);
      }
      case "sequence":
        return this.sequence(e, path, src);
      case "conditional":
        return this.conditional(e, path, src);
      case "as":
      case "satisfies": {
        // `as` and `satisfies` must stay on their operand's line.
        const parts: Doc[] = [this.printed(exprAt(e.expr, "expression", path), src, { deferTrailing: true }), " ", e.kind, " ", this.type(e.type, "typeAnnotation", path, src)];
        const p = parentExpr(path);
        const hugged = (path.key === "callee" && (p.kind === "call" || p.kind === "new")) || (path.key === "object" && (p.kind === "member" || p.kind === "index"));
        return hugged ? group([indent([newSoftline(), ...parts]), newSoftline()]) : parts;
      }
      case "assertion": {
        const asserted = group(["<", indent([newSoftline(), this.type(e.type, "typeAnnotation", path, src)]), newSoftline(), ">"]);
        const operand = this.expr(e.expr, "expression", path, src);
        if (e.expr.kind === "array" || e.expr.kind === "object") return group([asserted, operand]);
        // Each layout holds the same documents, as Prettier's conditionalGroup shares them.
        const [asserted1, assertedRest] = dup(asserted);
        const [asserted2, asserted3] = dup(assertedRest);
        const [operand1, operandRest] = dup(operand);
        const [operand2, operand3] = dup(operandRest);
        const broken = group([ifBreak("("), indent([newSoftline(), operand2]), newSoftline(), ifBreak(")")], { shouldBreak: true });
        return conditionalGroup([[asserted1, operand1], [asserted2, broken], [asserted3, operand3]]);
      }
      case "nonNull":
        return [this.printed(exprAt(e.expr, "expression", path), src, { deferTrailing: true }), "!"];
      case "instantiation":
        return [this.expr(e.expr, "expression", path, src), this.typeArguments(e.typeArgs, path, src)];
      case "member":
      case "index":
        return this.member(e, path, src);
      case "call":
      case "new":
      case "import":
        return this.call(e, path, src);
    }
    return "";
  }

  // Prettier's needsParens for the expression forms printed so far.
  /** @throws {Error | CompileError} */
  needsParens(this: Mut<this>, path: Ref<At<"expr">>): boolean {
    const e: Ref<Expr> = path.node;
    const key = path.key;
    const u: Ref<Up | undefined> = path.parent;
    if (u === undefined) return false;
    const up: Ref<Path> = u.at;
    // An object, function or class at the start of a statement, or an object at the start of an
    // arrow's body, would read as a block or a declaration.
    if ((e.kind === "object" || e.kind === "function" || e.kind === "class" || e.kind === "unsafe") && startsStatement(up, e.id)) return true;
    if (e.kind === "object" && startsArrowBody(up, e.id)) return true;
    if (e.kind === "binary" && e.op === "in" && inForInit(path)) return true;
    if (key === "superClass" && superClassNeedsParens(e)) return true;
    // A guard is read at binary precedence.
    if (key === "guard" && up.sort === "arm") return ["conditional", "arrow", "yield", "assign", "sequence", "throw"].includes(form(e)) || isPipe(e);
    // An object literal's spread reads its value as an array's or a call's spread does: under a
    // spread, the forms below binary precedence take parentheses.
    if (up.sort === "prop" && up.node.kind === "spread") return spreadParens(form(e));
    if (up.sort !== "expr") {
      const sk = stmtKindAt(up);
      if (sk === "for") return false;
      if (e.kind === "sequence") return true;
      if (e.kind === "destructure") return sk !== "expr" || e.pattern.kind === "object";
      return e.kind === "assign" && sk !== "expr";
    }
    const p: Ref<Expr> = up.node;
    const pf = form(p);
    if (pf === "throw") return belowUnary.has(form(e));
    switch (form(e)) {
      case "int":
      case "float":
        return key === "object" && (p.kind === "member" || p.kind === "index");
      case "update":
        if (e.kind === "update" && pf === "unary" && p.kind === "unary") {
          return e.prefix && ((e.op === "++" && p.op === "+") || (e.op === "--" && p.op === "-"));
        }
        return unaryParens(e, key, p);
      case "unary":
        return unaryParens(e, key, p);
      case "binary":
        return pf === "update" || binaryishParens(e, key, p);
      case "logical":
      case "as":
      case "satisfies":
      case "assertion":
        return binaryishParens(e, key, p);
      case "sequence":
        return true;
      case "yield":
      case "throw":
        return pf === "await" || pf === "assertion" || awaitParens(key, p);
      case "await":
        return awaitParens(key, p);
      case "assign":
        return !(pf === "assign" || (pf === "sequence" && stmtKind(up.parent) === "for"));
      case "conditional":
        switch (pf) {
          case "tagged": case "unary": case "spread": case "binary": case "logical": case "await":
          case "assertion": case "as": case "satisfies": case "nonNull":
            return true;
          case "call": case "new":
            return key === "callee";
          case "conditional":
            return key === "test";
          case "member": case "index":
            return key === "object";
          default:
            return false;
        }
      case "call": case "member": case "index": case "tagged": case "import": case "nonNull":
        return key === "callee" && pf === "new" && (endsInCall(e) || optionalChain(e));
      case "instantiation":
        return key === "object" && (p.kind === "member" || p.kind === "index");
      // `unsafe { x }` is read at unary precedence, so it can't be looked into or called bare.
      case "unsafe":
        return (key === "object" && (p.kind === "member" || p.kind === "index")) || (key === "callee" && (p.kind === "call" || p.kind === "new")) || pf === "tagged" || pf === "nonNull" || pf === "update";
      case "function":
        return (key === "callee" && (p.kind === "call" || p.kind === "new")) || pf === "tagged";
      case "class":
        return key === "callee" && pf === "new";
      case "arrow":
        switch (pf) {
          case "binary": case "as": case "satisfies": case "nonNull": case "tagged": case "unary": case "logical": case "await": case "assertion":
            return true;
          case "call": case "new":
            return key === "callee";
          case "member": case "index":
            return key === "object";
          case "instantiation":
            return key === "expression";
          case "conditional":
            return key === "test";
          default:
            return false;
        }
      default:
        return false;
    }
  }

  // `await x` called or looked into breaks inside its parentheses, unless an outer `await` starts
  // with it and breaks there instead.
  /** @throws {Error | CompileError} */
  awaited(this: Mut<this>, e: Ref<Of<"unary">>, path: Ref<At<"expr">>, src: string): Doc {
    const parts: Doc = ["await ", this.expr(e.operand, "argument", path, src)];
    const p = parentExpr(path);
    if (!((path.key === "callee" && p.kind === "call") || (path.key === "object" && (p.kind === "member" || p.kind === "index")))) return parts;
    const broken = [indent([newSoftline(), parts]), newSoftline()];
    const u: Ref<Up | undefined> = path.parent;
    return u !== undefined && leadsOuterAwait(u.at, e.id) ? broken : group(broken);
  }

  // A chain of binary operators, printed flat with a break allowed before each right operand,
  // and indented after the first unless its place already sets it apart.
  /** @throws {Error | CompileError} */
  binary(this: Mut<this>, e: Ref<Expr>, path: Ref<At<"expr">>, src: string): Doc {
    const key = path.key;
    const p = parentExpr(path);
    const place = binaryPlace(path);
    const pk = place.stmt;
    const inParens = key !== "body" && (pk === "if" || pk === "while" || pk === "switch" || pk === "doWhile");
    const parts = this.binaryParts(path, src, inParens);
    if (inParens) return parts;
    if (isPipe(e)) return group(parts);
    if ((key === "callee" && (p.kind === "call" || p.kind === "new")) || p.form === "unary" || p.kind === "member") {
      return group([indent([newSoftline(), ...parts]), newSoftline()]);
    }
    const shouldNotIndent =
      pk === "return" || pk === "throw" ||
      (key === "body" && (p.kind === "arrow" || place.sort === "arm")) ||
      (key !== "body" && pk === "for") ||
      (p.kind === "conditional" && place.outerStmt !== "return" && place.outerStmt !== "throw" && !place.outerCallOrNew) ||
      p.kind === "template" ||
      (key === "arguments" && place.booleanCall);
    const shouldIndentIfInlining = p.kind === "assign" || place.sort === "declarator" || place.sort === "member" ||
      (place.sort === "prop" && place.kind === "property");
    const left: Ref<Expr> = binLeft(e);
    const samePrecedenceSubExpression = isBinaryLike(left) && shouldFlatten(opOf(e), opOf(left));
    if (shouldNotIndent || (shouldInline(e) && !samePrecedenceSubExpression) || (!shouldInline(e) && shouldIndentIfInlining)) {
      return group(parts);
    }
    // Up to the first group, the rest indented.
    let headLength: usize = 0;
    for (let i: usize = 0; i < parts.length && headLength === 0; i++) {
      const d: Ref<Doc> = parts[i]!;
      if (typeof d === "object" && !Array.isArray(d) && d.kind === "group") headLength = i + 1;
    }
    if (headLength === 0) headLength = 1;
    let rest = parts;
    let out: Doc[] = [];
    for (let i: usize = 0; i < headLength && rest.length > 0; i++) out.push(rest.shift()!);
    out.push(indent(rest));
    return group(out);
  }

  // `parts` with `node`'s comments around them, as a list again.
  /** @throws {Error | CompileError} */
  commentedParts(this: Mut<this>, id: usize, parts: Doc[], src: string): Doc[] {
    if (!this.hasComments(id)) return parts;
    const doc = this.commented(id, parts, src);
    return Array.isArray(doc) ? doc : [doc];
  }

  // The operands and operators of a chain, flattening into the same list a left side Prettier
  // prints without parentheses.
  /** @throws {Error | CompileError} */
  binaryParts(this: Mut<this>, path: Ref<At<"expr">>, src: string, inParens: boolean): Doc[] {
    const e: Ref<Expr> = path.node;
    if (!isBinaryLike(e)) return [group(this.printed(path, src))];
    const op = opOf(e);
    const left = exprAt(binLeft(e), "left", path);
    // An `in` in a `for` head keeps its parentheses even where its precedence would let it flatten.
    const leftNode: Ref<Expr> = left.node;
    const flatten = isBinaryLike(leftNode) && shouldFlatten(op, opOf(leftNode)) && !(opOf(leftNode) === "in" && inForInit(left));
    // A flattened left side prints its own comments around its operands.
    let parts: Doc[] = [];
    if (flatten) {
      const flattened = this.binaryParts(left, src, inParens);
      parts = this.commentedParts(left.node.id, flattened, src);
    } else parts = [group(this.printed(left, src))];
    // A pipe stage led by a comment on its own line keeps `|>` at the end of the line before, as
    // Prettier prints it.
    const pipeStage = op === "|>" && !this.ownLineLeading(binRight(e).id, src);
    // A pipeline's right side is flattened too, as Prettier does for hack-style pipes.
    const rightDoc = pipeStage ? this.binaryParts(exprAt(binRight(e), "right", path), src, inParens) : this.expr(binRight(e), "right", path, src);
    const right: Doc = pipeStage ? [newLine(), op, " ", rightDoc] : shouldInline(e) ? [op, " ", rightDoc] : [op, newLine(), rightDoc];
    const p = parentExpr(path);
    const kind = form(e);
    // A line comment after the left side breaks before the right.
    const brokenLeft = this.hasLineComment(binLeft(e).id, "trailing");
    const shouldGroup = brokenLeft || (!(inParens && kind === "logical") && p.form !== kind && form(binLeft(e)) !== kind && form(binRight(e)) !== kind);
    parts.push(pipeStage ? "" : " ");
    parts.push(shouldGroup ? group(right, { shouldBreak: brokenLeft }) : right);
    return parts;
  }

  /** @throws {Error | CompileError} */
  sequence(this: Mut<this>, e: Ref<Of<"sequence">>, path: Ref<At<"expr">>, src: string): Doc {
    let printedExprs: Doc[] = [];
    for (const x of e.exprs) printedExprs.push(this.expr(x, "expressions", path, src));
    const pk = stmtKind(path.parent);
    if (pk === "expr" || pk === "for") {
      let parts: Doc[] = [printedExprs.shift()!];
      while (printedExprs.length > 0) parts.push([",", indent([newLine(), printedExprs.shift()!])]);
      return group(parts);
    }
    const joined = join([",", newLine()], printedExprs);
    const ownParens = path.key === "argument" && (pk === "return" || pk === "throw");
    if (!ownParens) return group(joined);
    const [broken, flat] = dup(joined);
    return group(ifBreak([indent([newSoftline(), broken]), newSoftline()], flat));
  }

  // Prettier's default ternary layout: `? then` and `: else` on lines of their own when it
  // breaks, with a chain in the alternate kept at one indentation.
  /** @throws {Error | CompileError} */
  conditional(this: Mut<this>, e: Ref<Of<"conditional">>, path: Ref<At<"expr">>, src: string): Doc {
    const p = parentExpr(path);
    const isParentTest = p.kind === "conditional" && path.key === "test";
    const forceNoIndent = p.kind === "conditional" && !isParentTest;
    // The first place up the chain that isn't a conditional holding this one outside its test.
    // Whether this sits in a chain of conditionals, in another's branch.
    const chained = p.kind === "conditional" && path.key !== "test";
    const nested = e.then.kind === "conditional";
    const parts: Doc = [
      newLine(), "? ", nested ? ifBreak("", "(") : "", align(2, this.expr(e.then, "consequent", path, src)), nested ? ifBreak("", ")") : "",
      newLine(), ": ", align(2, this.expr(e.else, "alternate", path, src)),
    ];
    const extraIndent = shouldExtraIndent(path);
    const test = this.expr(e.cond, "test", path, src);
    const contents: Doc = [
      p.kind === "conditional" && path.key === "alternate" ? align(2, test) : test,
      forceNoIndent ? parts : indent(parts),
      p.kind === "member" && !extraIndent ? newSoftline() : "",
    ];
    const result = chained ? contents : group(contents);
    return isParentTest || extraIndent ? group([indent([newSoftline(), result]), newSoftline()]) : result;
  }

  // `.name`, or `[index]` broken inside the brackets when it doesn't fit.
  /** @throws {Error | CompileError} */
  lookup(this: Mut<this>, e: Ref<Of<"member"> | Of<"index">>, path: Ref<At<"expr">>, src: string): Doc {
    if (e.kind === "member") return [e.optional ? "?." : ".", e.name];
    const optional = e.optional ? "?." : "";
    const index = this.expr(e.index, "property", path, src);
    if (e.index.kind === "int" || e.index.kind === "float") return [optional, "[", index, "]"];
    return group([optional, "[", indent([newSoftline(), index]), newSoftline(), "]"]);
  }

  /** @throws {Error | CompileError} */
  member(this: Mut<this>, e: Ref<Of<"member"> | Of<"index">>, path: Ref<At<"expr">>, src: string): Doc {
    const object = this.expr(e.object, "object", path, src);
    const pastNonNull = pastNonNullOf(path);
    const assigned = (pastNonNull.sort === "expr" && pastNonNull.kind === "assign") || pastNonNull.sort === "declarator";
    const objectLabel = labelOf(object);
    const flat =
      assignedToNonName(path) ||
      insideNewCallee(path) ||
      e.kind === "index" ||
      (e.object.kind === "ident" && !e.name.startsWith("#") && !(pastNonNull.sort === "expr" && (pastNonNull.kind === "member" || pastNonNull.kind === "index"))) ||
      (assigned && (callWithArguments(stripNonNull(e.object)) || objectLabel === "member-chain"));
    const looked = this.lookup(e, path, src);
    const doc: Doc = [object, newLineSuffixBoundary(), flat ? looked : group(indent([newSoftline(), looked]))];
    return objectLabel !== undefined && objectLabel !== "" ? label(objectLabel, doc) : doc;
  }

  // A dotted name such as `require.resolve` or `import.meta.resolve`, when `e` is one.

  /** @throws {Error | CompileError} */
  call(this: Mut<this>, e: Ref<Of<"call"> | Of<"new"> | Of<"import">>, path: Ref<At<"expr">>, src: string): Doc {
    // A `new` written without parentheses has no arguments.
    if (e.kind === "new") {
      const given: Ref<Expr[] | undefined> = e.args;
      if (given === undefined) {
        const none: Expr[] = [];
        return this.callWith(e, none, path, src);
      }
      return this.callWith(e, given, path, src);
    }
    if (e.kind === "call") return this.callWith(e, e.args, path, src);
    return this.callWith(e, e.args, path, src);
  }

  /** @throws {Error | CompileError} */
  callWith(this: Mut<this>, e: Ref<Of<"call"> | Of<"new"> | Of<"import">>, args: Ref<Expr[]>, path: Ref<At<"expr">>, src: string): Doc {
    const prefix: Doc = e.kind === "import" ? "import" : [e.kind === "new" ? "new " : "", this.expr(e.callee, "callee", path, src), newLineSuffixBoundary()];
    const optional = e.kind === "call" && e.optional ? "?." : "";
    const typeArgs: Doc = e.kind !== "import" && e.typeArgs.length > 0 ? [this.typeArguments(e.typeArgs, path, src), newLineSuffixBoundary()] : "";
    // `require("x")`, `import("x")`, `require(a, b)`, a lone template literal written over several
    // lines, and the arguments of a test call such as `it("works", () => {})` never break.
    const loneModule =
      args.length === 1 && args[0]!.kind === "string" &&
      (e.kind === "import" || (e.kind === "call" && !e.optional && moduleCallees.includes(dotted(e.callee) ?? "")));
    const requireList = e.kind === "call" && !e.optional && e.callee.kind === "ident" && e.callee.name === "require" && args.length > 1;
    const loneTemplate = args.length === 1 && templateOnItsOwnLine(args[0]!, src);
    const p = parentExpr(path);
    if (loneModule || requireList || loneTemplate || isTestCall(e, p.testCall)) {
      let printedArgs: Doc[] = [];
      for (const a of args) printedArgs.push(this.expr(a, "arguments", path, src));
      return [prefix, optional, typeArgs, "(", join(", ", printedArgs), ")"];
    }
    if (e.kind === "call" && isMember(e.callee) && !this.needsParens(exprAt(e.callee, "callee", path))) return this.memberChain(e, path, src);
    const printedArgs = this.argumentList(e, e.kind === "import", args, path, src);
    const contents = [prefix, optional, typeArgs, printedArgs];
    return e.kind === "import" || e.callee.kind === "call" ? group(contents) : contents;
  }

  // The parenthesized arguments: on one line, one per line, or with a first or last function or
  // object hugged, as in `arr.map((x) => { ... })`, whichever Prettier's states choose.
  /** @throws {Error | CompileError} */
  argumentList(this: Mut<this>, e: Ref<Expr>, isImport: boolean, args: Ref<Expr[]>, path: Ref<At<"expr">>, src: string): Doc {
    if (args.length === 0) return group(["(", this.danglingInside(e.id, src), ")"]);
    if (isReactHookCall(args)) {
      const first = this.expr(args[0]!, "arguments", path, src);
      return ["(", first, ", ", this.expr(args[1]!, "arguments", path, src), ")"];
    }
    let blank = false;
    let printedArgs: Doc[] = [];
    for (let i: usize = 0; i < args.length; i++) {
      const a: Ref<Expr> = args[i]!;
      const doc = this.expr(a, "arguments", path, src);
      if (i === args.length - 1) printedArgs.push(doc);
      // A blank line after an argument is kept, with every argument on its own line.
      else if (isNextLineEmpty(src, a.end)) {
        blank = true;
        printedArgs.push([doc, ",", newHardline(), newHardline()]);
      } else printedArgs.push([doc, ",", newLine()]);
    }
    if (blank || functionArguments(args)) return allBroken(printedArgs, isImport);
    if (this.shouldGroupFirst(args)) {
      const rest = printedArgs.slice(1);
      const first = anyBreaks(rest) ? undefined : this.huggedArg(args[0]!, path, src, { expandFirstArg: true });
      if (first === undefined) return allBroken(printedArgs, isImport);
      // The layouts share the arguments' documents, as Prettier's conditionalGroup does.
      const [first1, first2] = dup(first);
      // Two lists of the same documents, each taken apart on its own.
      const rest1 = rest.slice();
      const rest2 = rest;
      let broken: Doc[] = ["(", group(first1, { shouldBreak: true }), ", "];
      pushAll(broken, rest1);
      broken.push(")");
      if (willBreak(first2)) return [newBreakParent(), conditionalGroup([broken, allBroken(printedArgs, isImport)])];
      let flat: Doc[] = ["(", first2, ", "];
      pushAll(flat, rest2);
      flat.push(")");
      return conditionalGroup([flat, broken, allBroken(printedArgs, isImport)]);
    }
    if (this.shouldGroupLast(args)) {
      const head = printedArgs.slice(0, -1);
      const last = anyBreaks(head) ? undefined : this.huggedArg(args[args.length - 1]!, path, src, { expandLastArg: true });
      if (last === undefined) return allBroken(printedArgs, isImport);
      const [last1, last2] = dup(last);
      const head1 = head.slice();
      const head2 = head;
      let broken: Doc[] = ["("];
      pushAll(broken, head1);
      broken.push(group(last1, { shouldBreak: true }));
      broken.push(")");
      if (willBreak(last2)) return [newBreakParent(), conditionalGroup([broken, allBroken(printedArgs, isImport)])];
      let flat: Doc[] = ["("];
      pushAll(flat, head2);
      flat.push(last2);
      flat.push(")");
      return conditionalGroup([flat, broken, allBroken(printedArgs, isImport)]);
    }
    const breaks = anyBreaks(printedArgs);
    let inner: Doc[] = [newSoftline()];
    pushAll(inner, printedArgs);
    const contents = ["(", indent(inner), isImport ? "" : ifBreak(","), newSoftline(), ")"];
    return moreArgumentsThanCaller(e, path) ? contents : group(contents, { shouldBreak: breaks });
  }

  // An argument printed hugged, or undefined when it can't be.
  /** @throws {Error | CompileError} */
  huggedArg(this: Mut<this>, arg: Ref<Expr>, path: Ref<At<"expr">>, src: string, opts: Opts): Doc | undefined {
    try {
      return this.printed(exprAt(arg, "arguments", path), src, opts);
    } catch (err) {
      if (!(err instanceof Error) || err.message !== BAILOUT) throw err;
      return undefined;
    }
  }

  // Whether an argument can be hugged: a non-empty object or array literal, a function, or an
  // arrow whose body is a block, a literal of structure, a call or a conditional.
  /** @throws {Error | CompileError} */
  couldExpandArg(this: Mut<this>, e: Ref<Expr>, arrowChainRecursion = false): boolean {
    switch (e.kind) {
      case "object":
        return e.props.length > 0;
      case "array":
        return e.elements.length > 0;
      case "as": case "satisfies": case "assertion":
        return this.couldExpandArg(e.expr);
      case "function":
        return true;
      case "arrow": {
        if (Array.isArray(e.body)) return true;
        else return this.couldExpandBody(e.body, arrowChainRecursion);
      }
      default:
        return false;
    }
  }

  /** @throws {Error | CompileError} */
  couldExpandBody(this: Mut<this>, body: Ref<Expr>, arrowChainRecursion: boolean): boolean {
    return (body.kind === "object" || body.kind === "array" || (body.kind === "arrow" && this.couldExpandArg(body, true)) ||
      (!arrowChainRecursion && (body.kind === "conditional" || stripNonNull(body).kind === "call")));
  }

  /** @throws {Error | CompileError} */
  shouldGroupLast(this: Mut<this>, args: Ref<Expr[]>): boolean {
    const last: Ref<Expr> = args[args.length - 1]!;
    const penultimateKind = args.length >= 2 ? args[args.length - 2]!.kind : "";
    return this.couldExpandArg(last) && (args.length < 2 || penultimateKind !== last.kind) &&
      (args.length !== 2 || penultimateKind !== "arrow" || last.kind !== "array") &&
      !(args.length > 1 && this.isConciselyPrintedArray(last));
  }

  /** @throws {Error | CompileError} */
  shouldGroupFirst(this: Mut<this>, args: Ref<Expr[]>): boolean {
    if (args.length !== 2) return false;
    const first: Ref<Expr> = args[0]!;
    const second: Ref<Expr> = args[1]!;
    return (first.kind === "function" || (first.kind === "arrow" && Array.isArray(first.body))) &&
      second.kind !== "function" && second.kind !== "arrow" && second.kind !== "conditional" &&
      hopefullyShortArgument(second) && !this.couldExpandArg(second);
  }

  // Prettier's member chain: `a.b(c).d(e)` split into groups, each a run of lookups ending in
  // calls, printed on one line when it fits and the calls are simple, else a group per line.
  /** @throws {Error | CompileError} */
  memberChain(this: Mut<this>, e: Ref<Of<"call">>, path: Ref<At<"expr">>, src: string): Doc {
    const outer = this.callLink(e, path, src);
    let links: Link[] = [];
    this.chainLinks(exprAt(e.callee, "callee", path), links, false, src);
    links.push(linkOf(e, outer));

    // The head: the object with the calls and numeric indexes right on it, or, for a plain name,
    // the lookups before the last, as `a.b` in `a.b.c()`.
    let i: usize = 1;
    while (i < links.length && (links[i]!.kind === "nonNull" || links[i]!.kind === "call" || links[i]!.numericIndex)) i++;
    if (links[0]!.kind !== "call") {
      while (i + 1 < links.length && links[i]!.member && links[i + 1]!.member) i++;
    }
    // Each group's size, the groups running in order through the links.
    let sizes: usize[] = [i];
    let size: usize = 0;
    let hasSeenCall = false;
    for (; i < links.length; i++) {
      const l: Ref<Link> = links[i]!;
      if (hasSeenCall && l.member) {
        if (l.numericIndex) {
          size++;
          continue;
        }
        sizes.push(size);
        size = 0;
        hasSeenCall = false;
      }
      if (l.kind === "call" || l.kind === "import") hasSeenCall = true;
      size++;
      // A trailing comment ends its group, unless a `!` follows, which can't start a line.
      if (this.hasComments(l.id, "trailing") && (i + 1 >= links.length || links[i + 1]!.kind !== "nonNull")) {
        sizes.push(size);
        size = 0;
        hasSeenCall = false;
      }
    }
    if (size > 0) sizes.push(size);

    const isStatement = stmtKind(path.parent) === "expr";
    const headSize = sizes[0]!;
    const hasComputed = sizes.length > 1 && links[headSize]!.kind === "index";
    const first: Ref<Link> = links[0]!;
    const last: Ref<Link> = links[headSize - 1]!;
    const shouldMerge = sizes.length >= 2 && !this.hasComments(links[headSize]!.id) && (headSize === 1
      ? first.kind === "this" || (first.kind === "ident" && (isFactory(first.name) || (isStatement && first.name.length <= 2) || hasComputed))
      : last.kind === "member" && !last.name.startsWith("#") && (isFactory(last.name) || hasComputed));

    const cutoff: usize = shouldMerge ? 3 : 2;
    // Comments inside the chain put each group on its own line.
    let commentsInside = false;
    for (let k: usize = 0; k + 1 < links.length; k++) {
      if ((k > 0 && this.hasComments(links[k]!.id, "leading")) || this.hasComments(links[k]!.id, "trailing")) commentsInside = true;
    }
    if (sizes.length > cutoff) {
      let start: usize = 0;
      for (let k: usize = 0; k < cutoff; k++) start += sizes[k]!;
      if (this.hasComments(links[start]!.id, "leading")) commentsInside = true;
    }
    let callCount: usize = 0;
    let complexCall = false;
    let functionCallBeforeLast = false;
    let functionCall = false;
    for (const l of links) {
      if (l.kind !== "call") continue;
      callCount++;
      if (l.complexArg) complexCall = true;
      if (functionCall) functionCallBeforeLast = true;
      functionCall = l.functionArg;
    }
    const lastKind = links[links.length - 1]!.kind;

    // The one-line and the expanded layouts hold the same documents, as Prettier's
    // conditionalGroup shares them.
    let flatDocs: Doc[] = [];
    let brokenDocs: Doc[] = [];
    links.reverse();
    while (links.length > 0) {
      const [flat, broken] = dup(links.pop()!.printed);
      flatDocs.push(flat);
      brokenDocs.push(broken);
    }
    const oneLine = grouped(flatDocs, sizes);
    if (sizes.length <= cutoff && !commentsInside) return moreArgumentsThanCaller(e, path) ? oneLine : group(oneLine);

    let rest = grouped(brokenDocs, sizes);
    const headDoc = rest.shift()!;
    const merged = shouldMerge ? rest.shift()! : "";
    const expanded = [headDoc, merged, indent([newHardline(), join(newHardline(), rest)])];
    const lastGroupBreaksAfterFunctions = lastKind === "call" && willBreak(oneLine[oneLine.length - 1]!) && functionCallBeforeLast;
    let earlierBreaks = false;
    for (let k: usize = 0; k + 1 < oneLine.length; k++) if (willBreak(oneLine[k]!)) earlierBreaks = true;
    const expand = commentsInside || (callCount > 2 && complexCall) || earlierBreaks || lastGroupBreaksAfterFunctions;
    if (expand) return label("member-chain", group(expanded));
    const breaks = willBreak(oneLine);
    return label("member-chain", [breaks ? newBreakParent() : "", conditionalGroup([oneLine, expanded])]);
  }

  // A call's link: its `?.`, type arguments and arguments.
  /** @throws {Error | CompileError} */
  callLink(this: Mut<this>, n: Ref<Of<"call">>, p: Ref<At<"expr">>, src: string): Doc {
    const typeArgs = this.typeArguments(n.typeArgs, p, src);
    const args = this.argumentList(n, false, n.args, p, src);
    return [n.optional ? "?." : "", typeArgs, args];
  }

  // The links of a member chain from `link` in, each put before those already in `links`.
  // `beforeBang` marks a link before a `!`, which keeps a comment holding a line break off that
  // line, as `!` can't start one.
  /** @throws {Error | CompileError} */
  chainLinks(this: Mut<this>, link: Ref<At<"expr">>, links: Mut<Link[]>, beforeBang: boolean, src: string): void {
    const n: Ref<Expr> = link.node;
    if (n.kind === "call" && (isMember(n.callee) || n.callee.kind === "call") && !this.needsParens(link)) {
      const printed = this.callLink(n, link, src);
      links.unshift(linkOf(n, this.commented(n.id, printed, src, true, beforeBang)));
      this.chainLinks(exprAt(n.callee, "callee", link), links, false, src);
    } else if (n.kind === "member" && !this.needsParens(link)) {
      const looked = this.lookup(n, link, src);
      links.unshift(linkOf(n, this.commented(n.id, looked, src, true, beforeBang)));
      this.chainLinks(exprAt(n.object, "object", link), links, false, src);
    } else if (n.kind === "index" && !this.needsParens(link)) {
      const looked = this.lookup(n, link, src);
      links.unshift(linkOf(n, this.commented(n.id, looked, src, true, beforeBang)));
      this.chainLinks(exprAt(n.object, "object", link), links, false, src);
    } else if (n.kind === "nonNull" && !this.needsParens(link)) {
      links.unshift(linkOf(n, this.commented(n.id, "!", src, true, beforeBang)));
      this.chainLinks(exprAt(n.expr, "expression", link), links, true, src);
    } else {
      const printed = this.printed(link, src, beforeBang ? { deferTrailing: true } : {});
      links.unshift(linkOf(n, printed));
    }
  }

  // An assignment, declarator or object property, `left op right`, in the layout Prettier chooses
  // for it; the right side learns the layout, which an arrow chain reads.
  /** @throws {Error | CompileError} */
  assignment(this: Mut<this>, path: Ref<Path>, left: Doc, op: Doc, value: Ref<Expr>, key: string, src: string): Doc {
    const layout = this.assignmentLayout(path, left, value, key, src);
    const right = this.printed(exprAt(value, key, path), src, { assignmentLayout: layout });
    return this.layoutDoc(layout, left, op, right);
  }

  /** @throws {Error | CompileError} */
  layoutDoc(this: Mut<this>, layout: Layout, left: Doc, op: Doc, right: Doc): Doc {
    switch (layout) {
      case "break-after-operator":
        return group([group(left), op, group(indent([newLine(), right]))]);
      case "never-break-after-operator":
        return group([group(left), op, " ", right]);
      case "fluid": {
        const id = this.groupId("assignment");
        return group([group(left), op, group(indent(newLine()), { id }), newLineSuffixBoundary(), indentIfBreak(right, { groupId: id })]);
      }
      case "break-lhs":
        return group([left, op, " ", group(right)]);
      case "chain":
        return [group(left), op, newLine(), right];
      case "chain-tail":
        return [group(left), op, indent([newLine(), right])];
      case "chain-tail-arrow-chain":
        return [group(left), op, right];
      case "only-left":
        return left;
    }
    return left;
  }

  /** @throws {Error | CompileError} */
  assignmentLayout(this: Mut<this>, path: Ref<Path>, left: Ref<Doc>, value: Ref<Expr>, key: string, src: string): Layout {
    const isTail = form(value) !== "assign";
    const place = binaryPlace(path);
    const inChain = path.sort === "expr" && (place.form === "assign" || place.sort === "declarator");
    if (inChain && (!isTail || (place.outerStmt !== "expr" && place.outerStmt !== "let"))) {
      if (!isTail) return "chain";
      return value.kind === "arrow" && !Array.isArray(value.body) && value.body.kind === "arrow" ? "chain-tail-arrow-chain" : "chain-tail";
    }
    if ((value.kind === "assign" || value.kind === "destructure") && form(value.value) === "assign") return "break-after-operator";
    // A comment on its own line before the value moves it to the next line.
    if (this.commentsOf(value.id).some((p) => p.placement === "leading" && hasNewline(src, p.comment.end))) return "break-after-operator";
    if (value.kind === "call" && value.callee.kind === "ident" && value.callee.name === "require") return "never-break-after-operator";
    const canBreakLeft = hasLine(left);
    if (complexDestructuring(path) || (path.sort === "declarator" && ((value.kind === "arrow" && canBreakLeft) || complexTypeAnnotation(path.node)))) {
      return "break-lhs";
    }
    // A key printed shorter than the indentation, as in `a: ...`, gains nothing from a break.
    const keyText = path.sort === "prop" ? flatText(left) : undefined;
    const hasShortKey = keyText !== undefined && [...keyText].length < 2 + 3;
    if (this.shouldBreakAfterOperator(exprAt(value, key, path), src, hasShortKey)) return "break-after-operator";
    const neverBreaks = hasShortKey || ["template", "tagged", "bool", "int", "float", "class"].includes(value.kind);
    return !canBreakLeft && neverBreaks ? "never-break-after-operator" : "fluid";
  }

  /** @throws {Error | CompileError} */
  shouldBreakAfterOperator(this: Mut<this>, path: Ref<At<"expr">>, src: string, hasShortKey: boolean): boolean {
    const e = path.node;
    if (isBinaryLike(e) && !shouldInline(e)) return true;
    if (e.kind === "sequence") return true;
    if (e.kind === "conditional") return e.cond.kind === "binary" && !isPipe(e.cond) && !shouldInline(e.cond);
    if (e.kind === "class") return e.decorators.length > 0;
    if (hasShortKey) return false;
    return this.poorlyBreakableOperand(path, src);
  }

  // Whether `path`, past any unary operators, `yield` and `!`, is a string or a short chain.
  /** @throws {Error | CompileError} */
  poorlyBreakableOperand(this: Mut<this>, path: Ref<At<"expr">>, src: string): boolean {
    const n = path.node;
    if (n.kind === "unary") return this.poorlyBreakableOperand(exprAt(n.operand, "argument", path), src);
    if (n.kind === "yield") {
      const value: Ref<Expr | undefined> = n.value;
      if (value !== undefined) return this.poorlyBreakableOperand(exprAt(value, "argument", path), src);
    }
    if (n.kind === "nonNull") return this.poorlyBreakableOperand(exprAt(n.expr, "expression", path), src);
    return n.kind === "string" || this.poorlyBreakableChain(path, src, false);
  }

  // A short chain such as `this.x.y()` or `a.b(1)`, which reads worse broken than moved after `=`.
  /** @throws {Error | CompileError} */
  poorlyBreakableChain(this: Mut<this>, path: Ref<At<"expr">>, src: string, deep: boolean): boolean {
    const e = path.node;
    if (e.kind === "nonNull") return this.poorlyBreakableChain(exprAt(e.expr, "expression", path), src, true);
    if (e.kind === "call") {
      if (labelOf(this.printed(path, src)) === "member-chain") return false;
      const short = e.args.length === 0 || (e.args.length === 1 && this.loneShortArgument(e.args[0]!, src));
      if (!short || this.complexTypeArguments(e.typeArgs, path, src)) return false;
      return this.poorlyBreakableChain(exprAt(e.callee, "callee", path), src, true);
    }
    if (e.kind === "member" || e.kind === "index") return this.poorlyBreakableChain(exprAt(e.object, "object", path), src, true);
    return deep && (e.kind === "ident" || e.kind === "this");
  }

  /** @throws {Error | CompileError} */
  complexTypeArguments(this: Mut<this>, args: Ref<TypeNode[]>, path: Ref<At<"expr">>, src: string): boolean {
    if (args.length > 1) return true;
    if (args.length === 0) return false;
    const only: Ref<TypeNode> = args[0]!;
    return only.kind === "union" || only.kind === "intersection" || only.kind === "object" || willBreak(this.typeArguments(args, path, src));
  }

  // An argument short enough, a quarter of the line, that a call of it doesn't need to break.
  /** @throws {Error | CompileError} */
  loneShortArgument(this: Mut<this>, e: Ref<Expr>, src: string): boolean {
    const limit: usize = 80 / 4;
    switch (e.kind) {
      case "this":
        return true;
      case "ident":
        return e.name.length <= limit;
      case "unary":
        return ((e.op === "+" || e.op === "-") && (e.operand.kind === "int" || e.operand.kind === "float")) || this.loneShortArgument(e.operand, src);
      case "regex":
        return e.pattern.length <= limit;
      case "string":
        return this.quoted(src.slice(e.start as i64, e.end as i64)).length <= limit;
      case "template":
        return e.exprs.length === 0 && e.raw[0]!.length <= limit && !e.raw[0]!.includes("\n");
      case "call":
        return e.args.length === 0 && e.callee.kind === "ident" && e.callee.name.length <= limit - 2;
      default:
        return ["int", "float", "bigint", "bool", "null"].includes(e.kind);
    }
  }

  // Prettier's printArrowFunction: a chain `(a) => (b) => ...` prints its signatures together,
  // and a body that is a block, a literal of structure or a short form stays on the `=>` line.
  /** @throws {Error | CompileError} */
  arrow(this: Mut<this>, e: Ref<Of<"arrow">>, path: Ref<At<"expr">>, src: string, opts: Ref<Opts>): Doc {
    const isChain = opts.expandLastArg !== true && bodyIsArrow(e);
    let signatures: Doc[] = [];
    return this.arrowLink(e, path, true, isChain, signatures, false, path, src, opts);
  }

  // One arrow of the chain from `path`'s arrow in, `node` at `nodePath`: its signature joins
  // `signatures`, and the innermost prints the chain. `breakChain` says whether an arrow before
  // it breaks the chain's signatures.
  /** @throws {Error | CompileError} */
  arrowLink(this: Mut<this>, node: Ref<Of<"arrow">>, nodePath: Ref<At<"expr">>, outermost: boolean, isChain: boolean, signatures: Mut<Doc[]>, breakChain: boolean, path: Ref<At<"expr">>, src: string, opts: Ref<Opts>): Doc {
    // An arrow inside the chain prints its own comments around its signature.
    const signature = this.arrowSignature(node, nodePath, src, opts);
    signatures.push(outermost ? signature : this.commented(node.id, signature, src));
    let shouldBreakChain = breakChain;
    if (isChain) {
      shouldBreakChain ||= (node.returnType !== undefined && node.params.length > 0) || node.typeParams.length > 0 ||
        node.params.some((x) => x.pattern.kind !== "ident" || x.rest || x.default !== undefined || x.modifiers.length > 0);
      if (Array.isArray(node.body)) {
      } else {
        const inner: Ref<Expr> = node.body;
        if (inner.kind === "arrow") return this.arrowLink(inner, exprAt(inner, "body", nodePath), false, isChain, signatures, shouldBreakChain, path, src, opts);
      }
    }
    let taken: Doc[] = [];
    while (signatures.length > 0) taken.push(signatures.shift()!);
    if (Array.isArray(node.body)) {
      const bodyDoc = this.block(node.body, node.id, "body", nodePath, src);
      return this.arrowChain(taken, bodyDoc, true, false, shouldBreakChain, isChain, path, opts);
    } else {
      const body: Ref<Expr> = node.body;
      const bodyDoc = this.printed(exprAt(body, "body", nodePath), src, { ...opts });
      const conditional = conditionalBody(body);
      const sameLine = !this.ownLineLeading(body.id, src) && (body.kind === "sequence" || this.bodyOnSameLine(body, src) || (!shouldBreakChain && conditional));
      return this.arrowChain(taken, bodyDoc, sameLine, conditional, shouldBreakChain, isChain, path, opts);
    }
  }

  // The chain's signatures and its innermost arrow's body; `conditional` marks a body that is a
  // conditional expression not starting with an object.
  /** @throws {Error | CompileError} */
  arrowChain(this: Mut<this>, signatures: Doc[], bodyDoc: Doc, sameLine: boolean, conditional: boolean, shouldBreakChain: boolean, isChain: boolean, path: Ref<At<"expr">>, opts: Ref<Opts>): Doc {
    const p = parentExpr(path);
    const isCallee = path.key === "callee" && (p.kind === "call" || p.kind === "new" || p.kind === "import");
    const chainId = this.groupId("arrow-chain");
    const indentSignatures = isChain && (isCallee || opts.assignmentLayout !== undefined);
    const breakSignatures = indentSignatures && (opts.assignmentLayout === "chain-tail-arrow-chain" || (isCallee && !sameLine));
    const signatureDoc = chainSignatures(signatures, path, opts, shouldBreakChain);
    const bodyOut = arrowBody(bodyDoc, conditional, sameLine, opts);
    return group([
      group(indentSignatures ? indent([newSoftline(), signatureDoc]) : signatureDoc, { shouldBreak: breakSignatures, id: chainId }),
      " =>",
      isChain ? indentIfBreak(bodyOut, { groupId: chainId }) : group(bodyOut),
      isChain && isCallee ? ifBreak(newSoftline(), "", { groupId: chainId }) : "",
    ]);
  }

  /** @throws {Error | CompileError} */
  arrowSignature(this: Mut<this>, e: Ref<Of<"arrow">>, path: Ref<At<"expr">>, src: string, opts: Ref<Opts>): Doc {
    const expand = opts.expandLastArg === true || opts.expandFirstArg === true;
    let returned = this.returnType(e.returnType, e.throws, path, src, true);
    if (expand) {
      if (willBreak(returned)) throw new Error(BAILOUT);
      returned = group(removeLines(returned));
    }
    const beforeArrow = this.danglingComments(e.id, src, true);
    const typeParams = this.typeParameters(e.typeParams, path, src);
    const params = this.parameters(e.params, path, src, expand, typeParams);
    return [
      e.move ? "move " : "", e.async ? "async " : "", group([params, returned]),
      beforeArrow.length > 0 ? [" ", beforeArrow] : "",
    ];
  }

  // A body that is an array, object, arrow, block or a template literal written over several
  // lines stays on the `=>` line.
  /** @throws {Error | CompileError} */
  bodyOnSameLine(this: Mut<this>, body: Ref<Expr>, src: string): boolean {
    return body.kind === "array" || body.kind === "object" || body.kind === "arrow" || templateOnItsOwnLine(body, src);
  }

  // An object literal: on one line when it fits, unless it was written with a line break after
  // its `{`, which keeps it expanded.
  /** @throws {Error | CompileError} */
  object(this: Mut<this>, e: Ref<Of<"object">>, path: Ref<At<"expr">>, src: string): Doc {
    if (e.props.length === 0) return group(["{", this.danglingInside(e.id, src), "}"]);
    let props: Doc[] = [];
    for (const prop of e.props) props.push(this.objectProp({ sort: "prop", node: prop, key: "properties", parent: upOf(path) }, src));
    const expanded = src.slice(e.start as i64, e.props[0]!.start as i64).includes("\n");
    return group(["{", indent([newLine(), separated(endsOf(e.props), props, [",", newLine()], newHardline(), src)]), ifBreak(","), newLine(), "}"], { shouldBreak: expanded });
  }

  /** @throws {Error | CompileError} */
  objectProp(this: Mut<this>, path: Ref<At<"prop">>, src: string): Doc {
    const doc = this.objectPropDoc(path, src);
    return this.commented(path.node.id, doc, src);
  }

  /** @throws {Error | CompileError} */
  objectPropDoc(this: Mut<this>, path: Ref<At<"prop">>, src: string): Doc {
    const p = path.node;
    switch (p.kind) {
      case "property":
      {
        const key = this.propertyKey(p.key, p.start, 0, path, src);
        return this.assignment(path, key, ":", p.value, "value", src);
      }
      case "shorthand": {
        const fallback: Ref<Expr | undefined> = p.default;
        return fallback !== undefined ? [p.name, " = ", this.expr(fallback, "right", path, src)] : p.name;
      }
      case "spread":
        return ["...", this.expr(p.value, "argument", path, src)];
      case "method":
      {
        const none: TypeNode | undefined = undefined;
        const key = this.propertyKey(p.key, p.start, ((p.async ? 1 : 0) + (p.generator ? 1 : 0)) as usize, path, src);
        const rest = this.methodRest(p.id, p.typeParams, p.params, p.returnType, none, p.body, path, src);
        return [p.async ? "async " : "", p.generator ? "*" : "", key, rest];
      }
      case "get":
      case "set":
      {
        const none: TypeNode | undefined = undefined;
        const noTypeParams: TypeParam[] = [];
        const key = this.propertyKey(p.key, p.start, 1, path, src);
        const rest = this.methodRest(p.id, noTypeParams, p.params, p.returnType, none, p.body, path, src);
        return [p.kind, " ", key, rest];
      }
    }
    return "";
  }

  // A property name as written, with quotes dropped where they aren't needed (Prettier's
  // `quoteProps: "as-needed"`): a quoted identifier loses them; a quoted number keeps them.
  // A class field's quoted name keeps its quotes, as Prettier's typescript printer leaves them.
  /** @throws {Error | CompileError} */
  propertyKey(this: Mut<this>, key: Ref<PropertyName>, start: usize, skip: usize, parent: Ref<Path>, src: string, unquote = true): Doc {
    if (typeof key !== "string") return ["[", this.expr(key, "key", parent, src), "]"];
    // The tree keeps a string key's value, not how it was written, so it is read again from the
    // source, after `skip` tokens such as `async`, `*`, `get` or `set`.
    let tokens = lexer(src.slice(start as i64));
    let t = tokens.next();
    for (let i: usize = 0; i < skip; i++) t = tokens.next();
    const raw = src.slice((start + t.start) as i64, (start + t.end) as i64);
    switch (t.kind) {
      case "string": {
        const printedKey = this.quoted(raw);
        return unquote && printedKey.slice(1, -1) === key && identifierName.test(key) ? key : printedKey;
      }
      case "int":
      case "float":
        return number(raw);
      case "bigint":
        return raw.toLowerCase();
      default:
        return key;
    }
  }

  // An array literal; numbers fill each line, and arrays of several non-trivial arrays or objects
  // put each on its own line.
  /** @throws {Error | CompileError} */
  array(this: Mut<this>, e: Ref<Of<"array">>, path: Ref<At<"expr">>, src: string): Doc {
    if (e.elements.length === 0) return group(["[", this.danglingInside(e.id, src), "]"]);
    const lastIsHole = e.elements[e.elements.length - 1] === undefined;
    const shouldBreak = e.elements.length > 1 && structuresOfSeveral(e);
    const concise = this.isConciselyPrintedArray(e);
    const id = this.groupId("array");
    let items: Doc;
    if (concise) {
      let parts: Doc[] = [];
      for (let i: usize = 0; i < e.elements.length; i++) {
        const x: Ref<Expr | undefined> = e.elements[i];
        const isLast = i === e.elements.length - 1;
        parts.push([x !== undefined ? this.expr(x, "elements", path, src) : "", isLast ? arrayTrailing(lastIsHole, concise, id) : ","]);
        if (isLast) continue;
        if (x !== undefined && blankAfterElement(src, x.end)) parts.push([newHardline(), newHardline()]);
        else {
          const next: Ref<Expr | undefined> = e.elements[i + 1];
          parts.push(next !== undefined && this.hasLineComment(next.id, "leading") ? newHardline() : newLine());
        }
      }
      items = fill(parts);
    } else {
      let printedElements: Doc[] = [];
      for (let i: usize = 0; i < e.elements.length; i++) {
        const x: Ref<Expr | undefined> = e.elements[i];
        printedElements.push([
          x !== undefined ? group(this.expr(x, "elements", path, src)) : "", i < e.elements.length - 1 ? [",", newLine(), x !== undefined && blankAfterElement(src, x.end) ? newSoftline() : ""] : "",
        ]);
      }
      items = [printedElements, arrayTrailing(lastIsHole, concise, id)];
    }
    return group(["[", indent([newSoftline(), items]), newSoftline(), "]"], { shouldBreak, id });
  }

  // An array of numbers, possibly signed, which prints filling each line.
  /** @throws {Error | CompileError} */
  isConciselyPrintedArray(this: Mut<this>, e: Ref<Expr>): boolean {
    if (e.kind !== "array" || e.elements.length === 0) return false;
    for (const x of e.elements) {
      if (x === undefined || this.commentsOf(x.id).some((p) => p.placement === "trailing" && p.comment.kind !== "block" && !p.ownLine)) return false;
      if (!(x.kind === "int" || x.kind === "float" || (x.kind === "unary" && (x.op === "+" || x.op === "-") && (x.operand.kind === "int" || x.operand.kind === "float")))) return false;
    }
    return true;
  }

  // A template literal printed as written, its substitutions printed on one line unless they were
  // written over several.
  /** @throws {Error | CompileError} */
  template(this: Mut<this>, e: Ref<Of<"template">>, path: Ref<At<"expr">>, src: string): Doc {
    let parts: Doc[] = [newLineSuffixBoundary(), "`"];
    let indentSize: usize = 0;
    for (let i: usize = 0; i < e.raw.length; i++) {
      const quasi = e.raw[i]!;
      parts.push(join(newLiteralline(), textLines(quasi)));
      if (i >= e.exprs.length) continue;
      if (quasi.includes("\n")) {
        const space = quasi.slice(quasi.lastIndexOf("\n") + 1).match(/^[\t ]*/);
        indentSize = columns(space === null ? "" : space[0]);
      }
      parts.push(this.substitution(e.exprs[i]!, path, src, indentSize, quasi));
    }
    parts.push("`");
    return parts;
  }

  /** @throws {Error | CompileError} */
  substitution(this: Mut<this>, x: Ref<Expr>, path: Ref<At<"expr">>, src: string, indentSize: usize, previous: string): Doc {
    let doc = this.expr(x, "expressions", path, src);
    const open = src.lastIndexOf("${", x.start as i64);
    const close = src.indexOf("}", x.end as i64);
    let multiline = src.slice(open, close).includes("\n");
    if (!multiline) {
      const [kept, measured] = dup(doc);
      doc = kept;
      const flat = print(measured, INFINITY);
      if (flat.includes("\n")) multiline = true;
      else doc = flat;
    }
    const simple = x.kind === "ident" || isMember(stripNonNull(x)) || x.kind === "conditional" || x.kind === "sequence" || isAsLike(x) || (x.kind === "binary" && !isPipe(x));
    if (multiline && simple) doc = [indent([newSoftline(), doc]), newSoftline()];
    if (indentSize === 0 && previous.endsWith("\n")) doc = align(-INFINITY, doc);
    else if (indentSize > 0) {
      const levels = (indentSize - indentSize % 2) / 2;
      for (let i: usize = 0; i < levels; i++) doc = indent(doc);
      doc = align(-INFINITY, align((indentSize % 2) as f64, doc));
    }
    return group(["${", doc, newLineSuffixBoundary(), "}"]);
  }

  // A class, as a declaration or an expression. Its decorators go on their own lines, unless they
  // were written before an `export` that prints them.
  /** @throws {Error | CompileError} */
  classDoc(this: Mut<this>, c: Ref<ClassNode>, path: Ref<Path>, src: string, decoratorsPrinted: boolean): Doc {
    const head: Doc[] = [c.abstract ? "abstract " : "", "class"];
    const name: string | undefined = c.name;
    let named: Doc[] = [];
    if (name !== undefined) {
      named.push(" ");
      named.push(name);
    }
    named.push(this.typeParameters(c.typeParams, path, src));
    const p = parentExpr(path);
    const inAssignment = p.kind === "assign";
    const base: Ref<Expr | undefined> = c.extends;
    const clauses = c.implements.length + (base !== undefined ? 1 : 0);
    const breakHeritage = clauses > 1 ||
      (base !== undefined ? !inAssignment && base.kind !== "instantiation" && isMember(stripNonNull(base))
        : c.implements.length > 0 && dottedType(c.implements[0]!));
    let heritage: Doc[] = [];
    if (base !== undefined) {
      const baseDoc = this.expr(base, "superClass", path, src);
      let extended: Doc = "";
      if (inAssignment) {
        const [broken, flat] = dup(baseDoc);
        extended = ["extends ", group(ifBreak(["(", indent([newSoftline(), broken]), newSoftline(), ")"], flat))];
      } else extended = ["extends ", baseDoc];
      heritage.push(breakHeritage ? [newLine(), group(extended)] : [" ", extended]);
    }
    heritage.push(this.heritageList("implements", c.implements, clauses > 1, breakHeritage, path, src));
    const id = this.groupId("heritageGroup");
    let header: Doc[] = [];
    if (breakHeritage) {
      named.push(indent(heritage));
      header.push(group(named, { id }));
    } else {
      header = named;
      pushAll(header, heritage);
    }
    let members: Doc[] = [];
    for (const m of c.members) members.push(this.classMember({ sort: "member", node: m, key: "body", parent: upOf(path) }, src));
    const hasMembers = members.length > 0;
    const classBody = this.membersBlock(c.id, members, c.members, src);
    const doc: Doc = [head, header, breakHeritage && hasMembers ? ifBreak(newHardline(), " ", { groupId: id }) : " ", classBody];
    if (c.decorators.length === 0 || decoratorsPrinted) return doc;
    const exported = path.sort === "stmt" && stmtKind(path.parent) === "export" || path.sort === "stmt" && stmtKind(path.parent) === "exportDefault";
    let printedDecorators: Doc[] = [];
    for (const d of c.decorators) printedDecorators.push(this.decorator(d, path, src));
    const decorators: Doc = [exported ? newHardline() : newBreakParent(), join(newLine(), printedDecorators), newLine()];
    if (path.sort === "expr") return this.needsParens(path) ? [indent([newSoftline(), decorators, doc]), newSoftline()] : [decorators, doc];
    return group([decorators, doc]);
  }

  // `implements A, B` or an interface's `extends A, B`; with more than one heritage clause the
  // list breaks indented under its keyword.
  /** @throws {Error | CompileError} */
  heritageList(this: Mut<this>, keyword: string, list: Ref<TypeNode[]>, several: boolean, breakHeritage: boolean, path: Ref<Path>, src: string): Doc {
    if (list.length === 0) return "";
    let printedTypes: Doc[] = [];
    for (const t of list) printedTypes.push(this.type(t, keyword, path, src));
    const printedList = join([",", newLine()], printedTypes);
    if (!several) return breakHeritage ? [newLine(), group([`${keyword} `, printedList])] : [" ", `${keyword} `, printedList];
    return [newLine(), keyword, group(indent([newLine(), printedList]))];
  }

  // `@name`, `@a.b(args)`, or anything else in parentheses.
  /** @throws {Error | CompileError} */
  decorator(this: Mut<this>, e: Ref<Expr>, parent: Ref<Path>, src: string): Doc {
    const simple = simpleName(e) || (e.kind === "call" && !e.optional && simpleName(e.callee));
    const doc = this.expr(e, "expression", parent, src);
    return simple ? ["@", doc] : ["@(", doc, ")"];
  }

  // A member's decorators stay on its line unless one was written with a line break after it.
  /** @throws {Error | CompileError} */
  memberDecorators(this: Mut<this>, decorators: Ref<Expr[]>, parent: Ref<Path>, src: string): Doc {
    if (decorators.length === 0) return "";
    const brokenAfter = decorators.some((d) => /^\)*[ \t]*\r?\n/.test(src.slice(d.end as i64)));
    let printedDecorators: Doc[] = [];
    for (const d of decorators) printedDecorators.push(this.decorator(d, parent, src));
    return group([join(newLine(), printedDecorators), brokenAfter ? newHardline() : newLine()]);
  }

  /** @throws {Error | CompileError} */
  classMember(this: Mut<this>, path: Ref<At<"member">>, src: string): Doc {
    const doc = this.classMemberDoc(path, src);
    return this.commented(path.node.id, doc, src);
  }

  /** @throws {Error | CompileError} */
  classMemberDoc(this: Mut<this>, path: Ref<At<"member">>, src: string): Doc {
    const m = path.node;
    const decorators = this.memberDecorators(m.decorators, path, src);
    // Where the member's name begins: after its decorators, then its modifiers and keywords.
    let from = m.start;
    if (m.decorators.length > 0) {
      const lastEnd = m.decorators[m.decorators.length - 1]!.end;
      const skipped = /^[\s)]*/.exec(src.slice(lastEnd as i64));
      from = lastEnd + (skipped === null ? 0 : skipped[0].length);
    }
    const none: TypeNode | undefined = undefined;
    const noTypeParams: TypeParam[] = [];
    switch (m.kind) {
      case "field": {
        const annotation: Ref<TypeNode | undefined> = m.type;
        const key = this.propertyKey(m.name, from, m.modifiers.length, path, src, false);
        const left = [
          decorators, ordered(m.modifiers, fieldOrder), key,
          m.optional ? "?" : "", m.definite ? "!" : "", annotation !== undefined ? [": ", this.type(annotation, "typeAnnotation", path, src)] : "",
        ];
        const init: Ref<Expr | undefined> = m.init;
        if (init === undefined) return [left, ";"];
        return [this.assignment(path, left, " =", init, "value", src), ";"];
      }
      case "method": {
        // A method written `"constructor"()` isn't the constructor to Fish, so it keeps its quotes.
        const name = this.propertyKey(m.name, from, m.modifiers.length + (m.generator ? 1 : 0), path, src, m.name !== "constructor");
        const head = [decorators, ordered(m.modifiers, methodOrder), "", m.generator ? "*" : "", name, m.optional ? "?" : ""];
        return this.memberFunction(head, m.id, m.typeParams, m.params, m.returnType, m.throws, m.body, path, src);
      }
      case "get":
      case "set": {
        const name = this.propertyKey(m.name, from, m.modifiers.length + 1, path, src, m.name !== "constructor");
        const head = [decorators, ordered(m.modifiers, methodOrder), `${m.kind} `, "", name, ""];
        return this.memberFunction(head, m.id, noTypeParams, m.params, m.returnType, none, m.body, path, src);
      }
      case "constructor": {
        const head = [decorators, ordered(m.modifiers, methodOrder), "", "", "constructor", ""];
        return this.memberFunction(head, m.id, noTypeParams, m.params, none, m.throws, m.body, path, src);
      }
      case "index": {
        let params: Doc[] = [];
        for (const x of m.params) params.push(this.param(x, path, src));
        return [
          decorators, m.modifiers.includes("static") ? "static " : "", m.modifiers.includes("readonly") ? "readonly " : "", "[",
          group([indent([newSoftline(), join([", ", newSoftline()], params)]), m.params.length > 1 ? ifBreak(",") : "", newSoftline()]), "]: ",
          this.type(m.type, "typeAnnotation", path, src), ";",
        ];
      }
      case "staticBlock":
        return ["static ", this.block(m.body, m.id, "body", path, src)];
    }
    return "";
  }

  // A method's, accessor's or constructor's parameters, return type and body after `head`, its
  // decorators, modifiers and name.
  /** @throws {Error | CompileError} */
  memberFunction(this: Mut<this>, head: Doc[], id: usize, typeParams: Ref<TypeParam[]>, list: Ref<Param[]>, returns: Ref<TypeNode | undefined>, throws: Ref<TypeNode | undefined>, body: Ref<Stmt[] | undefined>, path: Ref<At<"member">>, src: string): Doc {
    const params = this.parameters(list, path, src, false, "");
    const returned = this.returnType(returns, throws, path, src);
    const properties = list.length > 1 && list.some((x) => x.modifiers.length > 0);
    const grouped = properties ? group(params, { shouldBreak: true }) : shouldGroupParameters(typeParams, list.length, returns !== undefined, returns !== undefined && isObjectType(returns), returned) ? group(params) : params;
    let parts = head;
    parts.push(this.typeParameters(typeParams, path, src));
    parts.push(group([grouped, returned]));
    parts.push(body !== undefined ? [" ", this.block(body, id, "body", path, src)] : ";");
    return parts;
  }

  /** @throws {Error | CompileError} */
  interfaceDoc(this: Mut<this>, s: Ref<Interface>, path: Ref<At<"stmt">>, src: string): Doc {
    const breakHeritage = s.extends.length > 1 || (s.extends.length > 0 && dottedType(s.extends[0]!));
    let named: Doc[] = [" ", s.name, this.typeParameters(s.typeParams, path, src)];
    const heritage = this.heritageList("extends", s.extends, s.extends.length > 1, breakHeritage, path, src);
    let header: Doc = "";
    if (breakHeritage) {
      named.push(indent(heritage));
      header = group(named);
    } else {
      named.push(heritage);
      header = named;
    }
    // Members print as an object type's do, so they hang off an object type standing for the body.
    let copies: TypeMember[] = [];
    for (const m of s.members) copies.push(cloneTypeMember(m));
    const body: TypeNode = { id: nextId(this.ids), kind: "object", members: copies, start: s.start, end: s.end };
    const owner: At<"type"> = { sort: "type", node: body, key: "body", parent: upOf(path) };
    let members: Doc[] = [];
    for (const m of s.members) members.push([this.typeMember(m, owner, src), ";"]);
    return ["interface", header, " ", this.membersBlock(s.id, members, s.members, src)];
  }

  /** @throws {Error | CompileError} */
  enumDoc(this: Mut<this>, s: Ref<Extract<Stmt, { kind: "enum" }>>, path: Ref<At<"stmt">>, src: string): Doc {
    let members: Doc[] = [];
    for (const m of s.members) {
      const payload: Ref<TypeNode[] | undefined> = m.payload;
      const init: Ref<Expr | undefined> = m.init;
      const key = this.propertyKey(m.name, m.start, 0, path, src);
      const payloadDoc = payload !== undefined ? this.typeList(payload, path, src) : "";
      const doc = [key, payloadDoc, init !== undefined ? [" = ", this.expr(init, "initializer", path, src)] : ""];
      members.push(this.commented(m.id, doc, src));
    }
    const node = this.attached.blocks.get(blockKey(s.id, "members"));
    const id: i64 = node === undefined ? -1 : node.id as i64;
    const dangling: Doc[] = id >= 0 ? this.danglingComments(id as usize, src) : [];
    const some = members.length > 0;
    const hasDangling = dangling.length > 0;
    const listed = [separated(endsOf(s.members), members, [",", newLine()], newHardline(), src), some ? ifBreak(",") : "", some && hasDangling ? newHardline() : "", dangling];
    const body = some || hasDangling ? this.commentedIf(id, group(["{", indent([newLine(), listed]), newLine(), "}"], { shouldBreak: true }), src) : "{}";
    return [s.const ? "const " : "", "enum ", s.name, this.typeParameters(s.typeParams, path, src), " ", body];
  }

  /** @throws {Error | CompileError} */
  namespaceDoc(this: Mut<this>, s: Ref<Extract<Stmt, { kind: "namespace" }>>, path: Ref<At<"stmt">>, src: string): Doc {
    const head: Doc = s.global ? "global" : [src.startsWith("module", s.start as i64) ? "module " : "namespace ", s.quoted ? this.stringAfter(s.start, src) : s.name];
    const body: Ref<Stmt[] | undefined> = s.body;
    return [head, body !== undefined ? [" ", this.block(body, s.id, "body", path, src, true, false)] : ";"];
  }

  // The first string literal from `from` on, printed with Prettier's quotes; the tree keeps only
  // a module name's value.
  /** @throws {Error | CompileError} */
  stringAfter(this: Mut<this>, from: usize, src: string): string {
    let tokens = lexer(src.slice(from as i64));
    for (let t = tokens.next(); t.kind !== "eof"; t = tokens.next()) {
      if (t.kind === "string") return this.quoted(src.slice((from + t.start) as i64, (from + t.end) as i64));
    }
    return '""';
  }

  // The module of an import or export: the string after `from`, or the only one in `import "m"`.
  /** @throws {Error | CompileError} */
  moduleName(this: Mut<this>, s: Ref<Stmt>, src: string): string {
    let tokens = lexer(src.slice(s.start as i64, s.end as i64));
    let previous = tokens.next();
    let t = tokens.next();
    while (t.kind !== "eof") {
      if (t.kind === "string" && previous.kind === "ident" && (previous.text === "from" || previous.text === "import")) {
        return this.quoted(src.slice((s.start + t.start) as i64, (s.start + t.end) as i64));
      }
      previous = t;
      t = tokens.next();
    }
    return '""';
  }

  // `{ a, b as c }`: one specifier alone stays inline, several break together.
  /** @throws {Error | CompileError} */
  specifierList(this: Mut<this>, list: Ref<Specifier[]>, src: string, alone: boolean): Doc {
    if (list.length === 0) return "{}";
    let printedList: Doc[] = [];
    for (const sp of list) printedList.push(this.specifier(sp, src));
    if (list.length === 1 && alone && !this.hasComments(list[0]!.id)) return ["{ ", printedList.pop()!, " }"];
    return group(["{", indent([newLine(), join([",", newLine()], printedList)]), ifBreak(","), newLine(), "}"]);
  }

  /** @throws {Error | CompileError} */
  specifier(this: Mut<this>, sp: Ref<Specifier>, src: string): Doc {
    const doc = this.specifierDoc(sp, src);
    return this.commented(sp.id, doc, src);
  }

  /** @throws {Error | CompileError} */
  specifierDoc(this: Mut<this>, sp: Ref<Specifier>, src: string): Doc {
    // A name may be a string, as in `{ "a-b" as ab }`, whose quotes the tree doesn't keep.
    let tokens = lexer(src.slice(sp.start as i64, sp.end as i64));
    let t = tokens.next();
    if (sp.typeOnly) t = tokens.next();
    const name = this.specifierName(t, sp.name, sp.start, src);
    const alias: string | undefined = sp.alias;
    if (alias === undefined || alias === sp.name) return [sp.typeOnly ? "type " : "", name];
    tokens.next();
    return [sp.typeOnly ? "type " : "", name, " as ", this.specifierName(tokens.next(), alias, sp.start, src)];
  }

  // A specifier's name as its token `x` wrote it, the token's offsets counted from `start`.
  /** @throws {Error | CompileError} */
  specifierName(this: Mut<this>, x: Ref<Token>, value: string, start: usize, src: string): string {
    return x.kind === "string" ? this.quoted(src.slice((start + x.start) as i64, (start + x.end) as i64)) : value;
  }

  // The name after `export * as`, which may be a string such as `"a-b"`.
  /** @throws {Error | CompileError} */
  exportAllAlias(this: Mut<this>, s: Ref<Extract<Stmt, { kind: "exportAll" }>>, src: string): string {
    let tokens = lexer(src.slice(s.start as i64, s.end as i64));
    for (let t = tokens.next(); t.kind !== "eof"; t = tokens.next()) {
      if (t.kind === "ident" && t.text === "as") {
        const alias = tokens.next();
        return alias.kind === "string" ? this.quoted(src.slice((s.start + alias.start) as i64, (s.start + alias.end) as i64)) : alias.text;
      }
    }
    return s.alias ?? "";
  }

  /** @throws {Error | CompileError} */
  importDoc(this: Mut<this>, s: Ref<Extract<Stmt, { kind: "import" }>>, path: Ref<At<"stmt">>, src: string): Doc {
    let leading: Doc[] = [];
    const def: string | undefined = s.default;
    const namespace: string | undefined = s.namespace;
    if (def !== undefined) leading.push(def);
    if (namespace !== undefined) leading.push(`* as ${namespace}`);
    const leadingCount = leading.length;
    const named: Ref<Specifier[] | undefined> = s.named;
    const sideEffect = leadingCount === 0 && named === undefined;
    let parts: Doc[] = ["import", s.defer ? " defer" : "", s.typeOnly ? " type" : ""];
    if (!sideEffect) {
      parts.push(" ");
      parts.push(join(", ", leading));
      if (named !== undefined && (named.length > 0 || leadingCount === 0)) {
        parts.push(leadingCount > 0 ? ", " : "");
        parts.push(this.specifierList(named, src, leadingCount === 0));
      }
      parts.push(" from");
    }
    parts.push(" ");
    parts.push(this.moduleName(s, src));
    const attributes: Ref<Expr | undefined> = s.attributes;
    if (attributes !== undefined && attributes.kind === "object") {
      const printedAttributes = this.expr(attributes, "attributes", path, src);
      let onlyType = false;
      if (attributes.props.length === 1) {
        const prop: Ref<ObjectProp> = attributes.props[0]!;
        onlyType = prop.kind === "property" && prop.key === "type";
      }
      parts.push(" with ");
      parts.push(onlyType ? removeLines(printedAttributes) : printedAttributes);
    }
    return [parts, ";"];
  }

  // `export default` before an expression that starts with a function or class, as in
  // `(class {}).name`, wraps the whole expression in parentheses.
  /** @throws {Error | CompileError} */
  exportDefaultNeedsParens(this: Mut<this>, e: Ref<Expr>, parent: Ref<At<"stmt">>): boolean {
    return this.exportParensFrom(exprAt(e, "declaration", parent), true);
  }

  // Down the leftmost parts from `path`, `top` at the exported value itself.
  /** @throws {Error | CompileError} */
  exportParensFrom(this: Mut<this>, path: Ref<At<"expr">>, top: boolean): boolean {
    const n: Ref<Expr> = path.node;
    if (n.kind === "function" || n.kind === "class") return top || !this.needsParens(path);
    if (!top && this.needsParens(path)) return false;
    const key = leftKey(n);
    if (key === "") return false;
    return this.exportParensFrom(exprAt(leftOf(n), key, path), false);
  }

  /** @throws {Error | CompileError} */
  exportDoc(this: Mut<this>, s: Ref<Stmt>, path: Ref<At<"stmt">>, src: string): Doc {
    switch (s.kind) {
      case "export": {
        const declared: Ref<Stmt> = s.body;
        const declaration: At<"stmt"> = { sort: "stmt", node: declared, key: "declaration", parent: upOf(path) };
        // Decorators written before `export` print before it, one per line.
        if (charAt(src, s.start) === "@" && declared.kind === "class") {
          let decorators: Doc[] = [];
          for (const d of declared.decorators) decorators.push(this.decorator(d, path, src));
          const doc = this.classDoc(declared, declaration, src, true);
          return [join(newHardline(), decorators), newHardline(), "export ", doc];
        }
        return ["export ", this.statement(declaration, src)];
      }
      case "exportDefault": {
        const declared: Ref<Stmt | undefined> = s.declaration;
        if (declared !== undefined) {
          const declaration: At<"stmt"> = { sort: "stmt", node: declared, key: "declaration", parent: upOf(path) };
          return ["export default ", this.statement(declaration, src)];
        }
        const value: Ref<Expr | undefined> = s.value;
        if (value === undefined) throw new Error("an export default holds a declaration or a value");
        const printedValue = this.expr(value, "declaration", path, src);
        return ["export default ", this.exportDefaultNeedsParens(value, path) ? ["(", printedValue, ")"] : printedValue, ";"];
      }
      case "exportNamed": {
        const list = this.specifierList(s.specifiers, src, true);
        return ["export", s.typeOnly ? " type" : "", " ", list, s.module !== undefined ? [" from ", this.moduleName(s, src)] : "", ";"];
      }
      case "exportAll": {
        const alias: Doc = s.alias !== undefined ? [" as ", this.exportAllAlias(s, src)] : "";
        return ["export", s.typeOnly ? " type" : "", " *", alias, " from ", this.moduleName(s, src), ";"];
      }
      case "exportAssign":
        return ["export = ", this.expr(s.value, "expression", path, src), ";"];
      case "exportAsNamespace":
        return ["export as namespace ", s.name, ";"];
      default:
        throw new Error(`no export layout for '${s.kind}'`);
    }
  }

  // `match (subject) { case P => body, ... }`, laid out as a `switch`: always expanded, one arm a
  // line, each ending in `,`.
  /** @throws {Error | CompileError} */
  matchDoc(this: Mut<this>, e: Ref<Of<"match">>, path: Ref<At<"expr">>, src: string): Doc {
    let arms: Doc[] = [];
    for (const arm of e.arms) arms.push(this.matchArm({ sort: "arm", node: arm, key: "arms", parent: upOf(path) }, src));
    const dangling = this.danglingComments(e.id, src);
    const subject = this.expr(e.subject, "subject", path, src);
    return [
      group(["match (", indent([newSoftline(), subject]), newSoftline(), ")"]), " {",
      arms.length > 0 ? indent([newHardline(), separated(endsOf(e.arms), arms, newHardline(), newHardline(), src)]) : dangling.length > 0 ? indent([newHardline(), dangling]) : "", newHardline(), "}",
    ];
  }

  // `case P if guard => body,`, the body laid out as an arrow function's.
  /** @throws {Error | CompileError} */
  matchArm(this: Mut<this>, path: Ref<At<"arm">>, src: string): Doc {
    const doc = this.matchArmDoc(path, src);
    return this.commented(path.node.id, doc, src);
  }

  /** @throws {Error | CompileError} */
  matchArmDoc(this: Mut<this>, path: Ref<At<"arm">>, src: string): Doc {
    const arm = path.node;
    const guard: Ref<Expr | undefined> = arm.guard;
    const pattern = this.pattern(arm.pattern, "pattern", path, src);
    const head: Doc = ["case ", pattern, guard !== undefined ? [" if ", this.expr(guard, "guard", path, src)] : ""];
    if (arm.body.kind === "block") {
      const block = this.block(arm.body.body, arm.body.id, "body", path, src, true, true, arm.body.id as i64);
      return [head, " => ", this.commented(arm.body.id, block, src), ","];
    } else {
      const body: Ref<Expr> = arm.body;
      const bodyDoc = this.printed(exprAt(body, "body", path), src);
      const conditional = conditionalBody(body);
      const sameLine = !this.ownLineLeading(body.id, src) && (body.kind === "sequence" || this.bodyOnSameLine(body, src) || conditional);
      const none: Opts = {};
      return [head, group([" =>", group(arrowBody(bodyDoc, conditional, sameLine, none))]), ","];
    }
  }

  // `P | Q` in a `match`: on one line, or each alternative after the first on its own line with a
  // leading `|`, indented. A union type would also lead the first with `|`, which a pattern can't.
  /** @throws {Error | CompileError} */
  orPattern(this: Mut<this>, p: Ref<Extract<Pattern, { kind: "or" }>>, path: Ref<At<"pattern">>, src: string): Doc {
    let printed: Doc[] = [];
    for (const x of p.patterns) printed.push(this.pattern(x, "patterns", path, src));
    const first = printed.shift()!;
    let rest: Doc[] = [];
    while (printed.length > 0) rest.push([newLine(), "| ", printed.shift()!]);
    return group([first, indent(rest)]);
  }

  // `Some(v)` or `A.B(x, y)`: the arguments laid out as a call's.
  /** @throws {Error | CompileError} */
  variantPattern(this: Mut<this>, p: Ref<Extract<Pattern, { kind: "variant" }>>, path: Ref<At<"pattern">>, src: string): Doc {
    const given: Ref<Pattern[] | undefined> = p.args;
    if (given === undefined) return p.name;
    if (given.length === 0) return [p.name, "()"];
    let args: Doc[] = [];
    for (const x of given) args.push(this.pattern(x, "arguments", path, src));
    return [p.name, group(["(", indent([newSoftline(), join([",", newLine()], args)]), ifBreak(","), newSoftline(), ")"])];
  }

  // Types laid out as call arguments, for an enum member's payload.
  /** @throws {Error | CompileError} */
  typeList(this: Mut<this>, types: Ref<TypeNode[]>, parent: Ref<Path>, src: string): Doc {
    if (types.length === 0) return "()";
    let printedTypes: Doc[] = [];
    for (const t of types) printedTypes.push(this.type(t, "params", parent, src));
    return group(["(", indent([newSoftline(), join([",", newLine()], printedTypes)]), ifBreak(","), newSoftline(), ")"]);
  }

  // Decorators on a function, type alias or interface, where Fish applies them as macros: on
  // their own lines when one was written with a line break after it, else inline.
  /** @throws {Error | CompileError} */
  macroDecorators(this: Mut<this>, decorators: Ref<Expr[] | undefined>, doc: Doc, path: Ref<Path>, src: string): Doc {
    if (decorators === undefined || decorators.length === 0) return doc;
    const brokenAfter = decorators.some((d) => /^\)*[ \t]*\r?\n/.test(src.slice(d.end as i64)));
    let printedDecorators: Doc[] = [];
    for (const d of decorators) printedDecorators.push(this.decorator(d, path, src));
    return group([brokenAfter ? newBreakParent() : "", join(newLine(), printedDecorators), newLine(), doc]);
  }

  // A string literal in double quotes unless its text holds more double quotes than single. Already
  // in that quote it stays exactly as written; moved to it, only the quotes' escapes change.
  /** @throws {Error | CompileError} */
  quoted(this: Mut<this>, literal: string): string {
    const raw = literal.slice(1, -1);
    const doubles = raw.match(/"/g);
    const singles = raw.match(/'/g);
    const quote = (doubles === null ? 0 : doubles.length) > (singles === null ? 0 : singles.length) ? "'" : '"';
    if (literal.startsWith(quote)) return literal;
    const other = quote === '"' ? "'" : '"';
    const body = raw.replace(/\\(.)|(["'])/gs, (match, escaped: string | undefined, bare: string | undefined) => {
      if (escaped === other) return other;
      if (bare === quote) return `\\${quote}`;
      if (bare !== undefined) return bare;
      return match;
    });
    return quote + body + quote;
  }

}
