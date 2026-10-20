import { expression, leftHandSide } from "./expressions.ts";
import { block, type ClassMember, type ClassNode, type Cursor, type Expr, type PropertyName } from "./parser.ts";
import { annotation, parameters, propertyName, returnAnnotation, type, typeParameters, typeReference } from "./types.ts";

// Declarations beyond functions, aliases and interfaces: classes, and with them the
// members, modifiers and decorators they carry.

// `class Name<T> extends Base<T> implements I { ... }`, as a declaration or an expression.
export function classNode(c: Cursor, abstract: boolean, decorators: Expr[]): ClassNode {
  const start = decorators[0]?.start ?? c.peek().start;
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

function classMember(c: Cursor): ClassMember {
  const start = c.peek().start;
  const member = { modifiers: [], decorators: [], start };
  const startsName = (offset: number) => ["ident", "string", "int", "float", "bigint", "private"].includes(c.peek(offset).kind) || c.peek(offset).text === "[";
  if ((c.at("get") || c.at("set")) && startsName(1)) {
    const kind = c.next().text as "get" | "set";
    const name = memberName(c);
    const params = parameters(c);
    const returnType = returnAnnotation(c);
    return { ...member, kind, name, params, returnType, body: block(c), end: c.end() };
  }
  if (c.at("constructor") && c.peek(1).text === "(") {
    c.next();
    const params = parameters(c);
    return { ...member, kind: "constructor", params, body: block(c), end: c.end() };
  }
  const generator = c.eat("*");
  const name = memberName(c);
  if (generator || c.at("(") || c.at("<")) {
    const typeParams = typeParameters(c);
    const params = parameters(c);
    const returnType = returnAnnotation(c);
    return { ...member, kind: "method", name, optional: false, generator, typeParams, params, returnType, body: block(c), end: c.end() };
  }
  const fieldType = c.at(":") ? annotation(c) : undefined;
  const init = c.eat("=") ? expression(c) : undefined;
  endMember(c);
  return { ...member, kind: "field", name, optional: false, definite: false, type: fieldType, init, end: c.end() };
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
