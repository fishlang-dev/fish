import { expression, leftHandSide, sequence } from "./expressions.ts";
import { isToken, type Token } from "./lexer.ts";
import { block, type ClassMember, type ClassNode, type Cursor, type Expr, type Modifier, type PropertyName, type Stmt } from "./parser.ts";
import { annotation, parameters, propertyName, returnAnnotation, type, typeParameters, typeReference } from "./types.ts";

// Declarations beyond functions, aliases and interfaces: classes, and with them the
// members, modifiers and decorators they carry.

// `class Name<T> extends Base<T> implements I { ... }`, as a declaration or an expression.
// `start` is where the class's first decorator or modifier began.
export function classNode(c: Cursor, start: number, abstract: boolean, decorators: Expr[]): ClassNode {
  c.expect("class");
  // A class expression may be anonymous, and so may `export default class`.
  const name = c.peek().kind === "ident" && !c.at("extends") && !c.at("implements") ? c.ident().text : undefined;
  const typeParams = typeParameters(c);
  const heritage = c.eat("extends") ? baseClass(c) : undefined;
  const implemented = [];
  if (c.eat("implements")) {
    do implemented.push(typeReference(c));
    while (c.eat(","));
  }
  c.expect("{");
  const members: ClassMember[] = [];
  while (!c.eat("}")) {
    if (c.peek().kind === "eof") throw c.error("expected '}'");
    if (!c.eat(";")) members.push(classMember(c));
  }
  return { name, abstract, decorators, typeParams, extends: heritage, implements: implemented, members, start, end: c.end() };
}

// Any left-hand-side expression, as in `extends mixin(Base)`; type arguments after it, as
// in `extends Base<T> {`, can't be confirmed the way a generic call's are, so they're read here.
function baseClass(c: Cursor): Expr {
  const base = leftHandSide(c);
  if (!c.eat("<")) return base;
  const typeArgs = c.list(() => type(c), ">");
  return { kind: "instantiation", expr: base, typeArgs, start: base.start, end: c.end() };
}

const MODIFIERS = new Set(["public", "private", "protected", "static", "readonly", "abstract", "override", "declare", "accessor", "async"]);

function classMember(c: Cursor): ClassMember {
  const start = c.peek().start;
  const decorators = decoratorList(c);
  const startsName = (t: Token) => ["ident", "string", "int", "float", "bigint", "private"].includes(t.kind) || isToken(t, "[") || isToken(t, "*");
  // A modifier is one only when a member follows it on the same line: `static() {}` is a
  // method named `static`, and `readonly: boolean` a field named `readonly`.
  const modifiers: Modifier[] = [];
  while (MODIFIERS.has(c.peek().text) && c.peek().kind === "ident" && !c.peek(1).newlineBefore &&
    (startsName(c.peek(1)) || (c.at("static") && isToken(c.peek(1), "{")))) {
    modifiers.push(c.next().text as Modifier);
  }
  const member = { modifiers, decorators, start };
  if (modifiers.length === 1 && modifiers[0] === "static" && c.at("{")) {
    return { ...member, modifiers: [], kind: "staticBlock", body: block(c), end: c.end() };
  }
  if (c.at("[") && c.peek(1).kind === "ident" && isToken(c.peek(2), ":")) {
    c.next();
    const params = parameters(c, "]");
    const valueType = annotation(c);
    endMember(c);
    return { ...member, kind: "index", params, type: valueType, end: c.end() };
  }
  if ((c.at("get") || c.at("set")) && startsName(c.peek(1)) && !isToken(c.peek(1), "*")) {
    const kind = c.next().text as "get" | "set";
    const name = memberName(c);
    const params = parameters(c);
    const returnType = returnAnnotation(c);
    return { ...member, kind, name, params, returnType, body: memberBody(c), end: c.end() };
  }
  if (c.at("constructor") && isToken(c.peek(1), "(")) {
    c.next();
    const params = parameters(c);
    return { ...member, kind: "constructor", params, body: memberBody(c), end: c.end() };
  }
  const generator = c.eat("*");
  const name = memberName(c);
  const optional = c.eat("?");
  if (generator || c.at("(") || c.at("<")) {
    const typeParams = typeParameters(c);
    const params = parameters(c);
    const returnType = returnAnnotation(c);
    return { ...member, kind: "method", name, optional, generator, typeParams, params, returnType, body: memberBody(c), end: c.end() };
  }
  const definite = !optional && c.eat("!");
  const fieldType = c.at(":") ? annotation(c) : undefined;
  const init = c.eat("=") ? expression(c) : undefined;
  endMember(c);
  return { ...member, kind: "field", name, optional, definite, type: fieldType, init, end: c.end() };
}

// An overload signature or an abstract member has no body.
function memberBody(c: Cursor): Stmt[] | undefined {
  if (c.at("{")) return block(c);
  endMember(c);
  return undefined;
}

// `@a`, `@a.b`, `@a.b(args)` or `@(expression)`. A decorator never takes `[`, so in
// `@dec [key]() {}` the brackets are the member's computed name.
export function decoratorList(c: Cursor): Expr[] {
  const decorators: Expr[] = [];
  while (c.at("@")) {
    c.next();
    let e: Expr;
    if (c.eat("(")) {
      e = sequence(c);
      c.expect(")");
    } else {
      const first = c.ident();
      e = { kind: "ident", name: first.text, start: first.start, end: first.end };
      while (c.eat(".")) {
        const name = c.next();
        if (name.kind !== "ident" && name.kind !== "private") throw c.error("expected a property name", name);
        e = { kind: "member", object: e, name: name.text, optional: false, start: e.start, end: name.end };
      }
    }
    if (c.eat("(")) {
      const args = c.list(() => expression(c), ")");
      e = { kind: "call", callee: e, typeArgs: [], args, optional: false, start: e.start, end: c.end() };
    }
    decorators.push(e);
  }
  return decorators;
}

// Member names may be reserved words or private names such as `#count`.
function memberName(c: Cursor): PropertyName {
  return c.peek().kind === "private" ? c.next().text : propertyName(c);
}

// A field ends with `;`, a line break, or the class's closing brace.
function endMember(c: Cursor) {
  if (c.eat(";") || c.at("}") || c.peek().newlineBefore) return;
  throw c.error("expected ';'");
}
