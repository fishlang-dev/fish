import { CompileError } from "./diag.fsh";
import { expression } from "./expressions.fsh";
import { nextId } from "./ids.fsh";
import { isToken } from "./lexer.fsh";
import type { Cursor, Expr, ObjectProp } from "./parser.fsh";

// JSX for server-side HTML. An element is turned, as it is read, into the calls that build its
// markup, so nothing after the parser meets JSX:
//   <p class={c}>Hi {name}</p>   is   __htmlOf("<p" + __htmlAttr("class", c) + ">Hi " + __htmlChild(name) + "</p>")
//   <Card title={t}>kids</Card>  is   Card({ title: t, children: __htmlOf("kids") })
// Markup written out is joined into string literals here, so only what a program computes is
// built when it runs. Std's `Html` holds markup already escaped: `__htmlChild` escapes a string
// and passes an `Html` through, and `__htmlAttr` writes one attribute, or nothing for `false`
// and `null`. A name starting with a capital, or holding a dot, is a component: a function
// called with its attributes as one object, its children as that object's `children`.

// The elements that have no content and no closing tag.
const VOID = ["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"];

type Name = { text: string; start: usize; end: usize };

function literal(c: Mut<Cursor>, value: string, start: usize, end: usize): Expr {
  return { id: nextId(c.ids), kind: "string", value, start, end };
}

function called(c: Mut<Cursor>, callee: Expr, args: Expr[], start: usize, end: usize): Expr {
  return { id: nextId(c.ids), kind: "call", callee, typeArgs: [], args, optional: false, start, end };
}

function helper(c: Mut<Cursor>, name: string, args: Expr[], start: usize, end: usize): Expr {
  const callee: Expr = { id: nextId(c.ids), kind: "ident", name, start, end };
  return called(c, callee, args, start, end);
}

// Adds markup known now to an element's pieces, joined to the piece before it when that is too.
function fixed(c: Mut<Cursor>, parts: Mut<Expr[]>, text: string, start: usize, end: usize): void {
  if (text === "") return;
  const last: Expr | undefined = parts.length > 0 ? parts.pop() : undefined;
  if (last !== undefined && last.kind === "string") {
    parts.push(literal(c, last.value + text, last.start, end));
    return;
  }
  if (last !== undefined) parts.push(last);
  parts.push(literal(c, text, start, end));
}

// An element's pieces as one string, each joined to the rest with `+`, from the last back.
function joined(c: Mut<Cursor>, parts: Expr[], start: usize, end: usize): Expr {
  if (parts.length === 0) return literal(c, "", start, end);
  let rest = parts;
  let out: Expr = rest.pop()!;
  while (rest.length > 0) {
    const left: Expr = rest.pop()!;
    const right: Expr = out;
    const from: usize = left.start;
    const to: usize = right.end;
    out = { id: nextId(c.ids), kind: "binary", op: "+", left, right, start: from, end: to };
  }
  return out;
}

// Text as it stands in markup: what `__htmlChild` does to a string, done while compiling.
function escaped(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\"", "&quot;").replaceAll("'", "&#39;");
}

// An element's text as JSX reads it: on one line it is kept as written; over several, each
// line is trimmed where it meets a line break, empty lines go, and the rest are joined by a space.
function collapsed(text: string): string {
  if (!text.includes("\n")) return text;
  const lines = text.split("\n");
  let kept: string[] = [];
  for (let i: usize = 0; i < lines.length; i++) {
    let line = lines[i].replaceAll("\t", " ").replaceAll("\r", "");
    if (i > 0) line = line.trimStart();
    if (i + 1 < lines.length) line = line.trimEnd();
    if (line !== "") kept.push(line);
  }
  return kept.join(" ");
}

// A tag's or an attribute's name: a name with any `-`, `:` or `.` parts written against it.
/** @throws {CompileError} */
function name(c: Mut<Cursor>): Name {
  // Any word, since `class` and `for` are attributes.
  const first = c.token();
  if (first.kind !== "ident") throw c.error("expected a tag's or an attribute's name");
  c.next();
  let text = first.text;
  let end: usize = first.end;
  for (;;) {
    // Nothing past a tag's `>` may be looked at as a token: it is text.
    const joiner = c.token();
    if (joiner.kind !== "punct" || (joiner.text !== "-" && joiner.text !== ":" && joiner.text !== ".") || joiner.start !== end) break;
    const part = c.token(1);
    if ((part.kind !== "ident" && part.kind !== "int") || part.start !== joiner.end) break;
    c.next();
    c.next();
    text += joiner.text + part.text;
    end = part.end;
  }
  return { text, start: first.start, end };
}

function isComponent(tag: string): boolean {
  const first = tag.slice(0, 1);
  return tag.includes(".") || (first >= "A" && first <= "Z");
}

// What a component's name refers to: a name, or a member of one.
function reference(c: Mut<Cursor>, tag: Ref<Name>): Expr {
  const names = tag.text.split(".");
  let out: Expr = { id: nextId(c.ids), kind: "ident", name: names[0], start: tag.start, end: tag.end };
  for (let i: usize = 1; i < names.length; i++) out = { id: nextId(c.ids), kind: "member", object: out, name: names[i], optional: false, start: tag.start, end: tag.end };
  return out;
}

// The content of an element named `tag`, or of a fragment when `tag` is "", up to and with its
// closing tag, added to `parts`.
/** @throws {CompileError} */
function children(c: Mut<Cursor>, parts: Mut<Expr[]>, tag: string): void {
  for (;;) {
    const raw = c.jsxText();
    fixed(c, parts, collapsed(raw.text), raw.start, raw.end);
    if (c.at("{")) {
      const open = c.next();
      // `{}` and a comment alone hold nothing.
      if (c.eat("}")) continue;
      const value = expression(c);
      const close = c.expect("}");
      if (value.kind === "string") fixed(c, parts, escaped(value.value), open.start, close.end);
      else parts.push(helper(c, "__htmlChild", [value], open.start, close.end));
      continue;
    }
    if (!isToken(c.peek(1), "/")) {
      const made = element(c, parts);
      const at: usize = c.end();
      if (made !== undefined) parts.push(helper(c, "__htmlFrom", [made], at, at));
      continue;
    }
    c.next();
    c.next();
    if (tag !== "") {
      const closing = name(c);
      if (closing.text !== tag) throw new CompileError("E0001", `expected '</${tag}>' to close '<${tag}>', found '</${closing.text}>'`, closing.start, closing.end);
    }
    c.expect(">");
    return;
  }
}

// One element or fragment at the cursor's `<`: an HTML element's markup added to `parts`, or a
// component's call, which gives an Html, handed back.
/** @throws {CompileError} */
function element(c: Mut<Cursor>, parts: Mut<Expr[]>): Expr | undefined {
  const open = c.expect("<");
  if (c.eat(">")) {
    children(c, parts, "");
    return undefined;
  }
  const tag = name(c);
  const component = isComponent(tag.text);
  let props: ObjectProp[] = [];
  if (!component) fixed(c, parts, `<${tag.text}`, open.start, tag.end);
  while (!c.at(">") && !c.at("/")) {
    if (c.at("{")) {
      const brace = c.next();
      c.expect("...");
      const value = expression(c);
      const close = c.expect("}");
      if (!component) throw new CompileError("E0801", "'{...}' spreads an object into a component's props; an HTML element's attributes are each written out", brace.start, close.end);
      props.push({ id: nextId(c.ids), kind: "spread", value, start: brace.start, end: close.end });
      continue;
    }
    const attribute = name(c);
    if (!c.eat("=")) {
      if (component) props.push({ id: nextId(c.ids), kind: "property", key: attribute.text, value: { id: nextId(c.ids), kind: "bool", value: true, start: attribute.start, end: attribute.end }, start: attribute.start, end: attribute.end });
      else fixed(c, parts, ` ${attribute.text}`, attribute.start, attribute.end);
      continue;
    }
    if (c.peek().kind === "string") {
      const written = c.next();
      if (component) {
        const given = literal(c, written.text, written.start, written.end);
        props.push({ id: nextId(c.ids), kind: "property", key: attribute.text, value: given, start: attribute.start, end: written.end });
      }
      // Kept as written, quotes and all: it is markup already.
      else {
        const source = c.src.slice(written.start as i64, written.end as i64);
        fixed(c, parts, ` ${attribute.text}=${source}`, attribute.start, written.end);
      }
      continue;
    }
    if (!c.at("{")) throw c.error("expected an attribute's value, a string or '{...}'");
    c.next();
    const value = expression(c);
    const close = c.expect("}");
    if (component) props.push({ id: nextId(c.ids), kind: "property", key: attribute.text, value, start: attribute.start, end: close.end });
    else {
      const named = literal(c, attribute.text, attribute.start, attribute.end);
      parts.push(helper(c, "__htmlAttr", [named, value], attribute.start, close.end));
    }
  }
  const closed = c.eat("/");
  const end = c.expect(">");
  if (!component) {
    fixed(c, parts, ">", end.start, end.end);
    if (VOID.includes(tag.text)) {
      if (!closed) throw new CompileError("E0001", `'<${tag.text}>' has no content, so it is written '<${tag.text} />'`, tag.start, tag.end);
      return undefined;
    }
    if (!closed) children(c, parts, tag.text);
    const at: usize = c.end();
    fixed(c, parts, `</${tag.text}>`, at, at);
    return undefined;
  }
  let inner: Expr[] = [];
  if (!closed) children(c, inner, tag.text);
  const last: usize = c.end();
  if (inner.length > 0) {
    const text = joined(c, inner, open.start, last);
    const held = helper(c, "__htmlOf", [text], open.start, last);
    props.push({ id: nextId(c.ids), kind: "property", key: "children", value: held, start: open.start, end: last });
  }
  const args: Expr[] = props.length === 0 ? [] : [{ id: nextId(c.ids), kind: "object", props, start: open.start, end: last }];
  const callee = reference(c, tag);
  return called(c, callee, args, open.start, last);
}

// The JSX element or fragment at the cursor, as the expression that builds its Html.
/** @throws {CompileError} */
export function jsx(c: Mut<Cursor>): Expr {
  const start: usize = c.peek().start;
  let parts: Expr[] = [];
  const made = element(c, parts);
  // A comment inside an element is part of its text as written, which is how the formatter prints
  // it, so it isn't kept to be placed a second time. Nothing past the element is scanned yet.
  while (c.lex.comments.length > 0 && c.lex.comments[c.lex.comments.length - 1].start >= start) c.lex.comments.pop();
  // A component alone is its own call, which gives an Html already.
  if (made !== undefined) return made;
  const end: usize = c.end();
  const text = joined(c, parts, start, end);
  return helper(c, "__htmlOf", [text], start, end);
}
