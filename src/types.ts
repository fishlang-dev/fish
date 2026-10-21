import { expression, primary, templateParts, unary } from "./expressions.ts";
import { isToken, type Token } from "./lexer.ts";
import type { Cursor, Modifier, Param, Pattern, PropertyName, TypeMember, TypeNode, TypeParam } from "./parser.ts";
import { decoratorList } from "./declarations.ts";
import { bindingPattern } from "./patterns.ts";

// The type grammar, and the parameter lists that functions and function types share.

export function typeParameters(c: Cursor): TypeParam[] {
  return c.eat("<") ? c.list(() => typeParameter(c), ">") : [];
}

// A modifier is only a modifier when a name follows it, so `<out>` names a parameter `out`.
function typeParameter(c: Cursor): TypeParam {
  const start = c.peek().start;
  const modifiers: TypeParam["modifiers"] = [];
  while ((c.at("const") || c.at("in") || c.at("out")) && c.peek(1).kind === "ident") {
    modifiers.push(c.next().text as "const" | "in" | "out");
  }
  const name = c.ident().text;
  const constraint = c.eat("extends") ? type(c) : undefined;
  const fallback = c.eat("=") ? type(c) : undefined;
  return { name, constraint, default: fallback, modifiers, start, end: c.end() };
}

// Parameters in parentheses, or after an index signature's `[`, up to `close`.
export function parameters(c: Cursor, close = ")"): Param[] {
  if (close === ")") c.expect("(");
  return c.list(() => parameter(c), close);
}

// A parameter property's modifiers, each followed on the same line by what it modifies.
const PARAMETER_MODIFIERS = ["public", "private", "protected", "readonly", "override"];

function parameter(c: Cursor): Param {
  const start = c.peek().start;
  const decorators = decoratorList(c);
  const modifiers: Modifier[] = [];
  while (PARAMETER_MODIFIERS.some((m) => c.at(m)) && !c.peek(1).newlineBefore && startsBinding(c.peek(1))) {
    modifiers.push(c.next().text as Modifier);
  }
  // `comptime n: i64` takes its argument at compile time.
  const comptime = c.at("comptime") && !c.peek(1).newlineBefore && startsBinding(c.peek(1)) && c.eat("comptime");
  const rest = c.eat("...");
  const t = c.peek();
  const pattern: Pattern = c.eat("this") ? { kind: "ident", name: "this", start: t.start, end: t.end } : bindingPattern(c);
  const optional = c.eat("?");
  const type = c.at(":") ? annotation(c) : undefined;
  const fallback = c.eat("=") ? expression(c) : undefined;
  return { pattern, type, optional, rest, default: fallback, modifiers, decorators, comptime, start, end: c.end() };
}

const startsBinding = (t: Token) => t.kind === "ident" || isToken(t, "{") || isToken(t, "[");

// `: Type` after a declaration or parameter list.
export function annotation(c: Cursor): TypeNode {
  c.expect(":");
  return type(c);
}

// `: Type` where a function's result goes, which may also be a type predicate.
export function returnAnnotation(c: Cursor): TypeNode | undefined {
  if (!c.eat(":")) return undefined;
  return returnType(c);
}

// `throws T` after a function's result or parameters: the error type it may throw.
export function throwsClause(c: Cursor): TypeNode | undefined {
  if (!c.at("throws") || c.peek().newlineBefore) return undefined;
  c.next();
  return type(c);
}

// `x is T`, `asserts x is T` and `asserts x`; otherwise an ordinary type.
function returnType(c: Cursor): TypeNode {
  const start = c.peek().start;
  const after = c.peek(1);
  // `asserts is T` narrows a parameter named `asserts`.
  const asserts = c.at("asserts") && after.kind === "ident" && !after.newlineBefore && !isToken(after, "is");
  if (asserts) c.next();
  const subject = c.peek();
  const is = c.peek(1);
  const narrows = subject.kind === "ident" && isToken(is, "is") && !is.newlineBefore;
  if (!asserts && !narrows) return type(c);
  c.next();
  const narrowed = narrows && c.eat("is") ? type(c) : undefined;
  return { kind: "predicate", asserts, name: subject.text, type: narrowed, start, end: c.end() };
}

export function type(c: Cursor, allowConditional = true): TypeNode {
  const outer = c.conditionalAllowed;
  c.conditionalAllowed = allowConditional;
  const t = conditionalType(c);
  c.conditionalAllowed = outer;
  return t;
}

// An `extends` on a new line isn't a conditional, so the statement ends before it.
function conditionalType(c: Cursor): TypeNode {
  if (atFunctionType(c)) return functionType(c);
  const check = composite(c, "union", "|", () => composite(c, "intersection", "&", () => typeOperator(c)));
  if (!c.conditionalAllowed || !c.at("extends") || c.peek().newlineBefore) return check;
  c.next();
  const extendsType = type(c, false);
  c.expect("?");
  const then = type(c);
  c.expect(":");
  const otherwise = type(c);
  return { kind: "conditional", check, extends: extendsType, then, else: otherwise, start: check.start, end: otherwise.end };
}

// `(` starts a function type only when what follows can't be a parenthesised type.
function atFunctionType(c: Cursor): boolean {
  if (c.at("<") || c.at("new") || (c.at("abstract") && isToken(c.peek(1), "new"))) return true;
  if (!c.at("(")) return false;
  const [a, b, d] = [c.peek(1), c.peek(2), c.peek(3)];
  if (isToken(a, ")") || isToken(a, "...")) return true;
  const paramFollows = (t: Token) => [":", ",", "?", "="].some((text) => isToken(t, text));
  if (isToken(a, "{") || isToken(a, "[")) {
    // A destructured first parameter: read the pattern on trial, then look past it.
    const before = c.pos;
    c.next();
    const follows = c.attempt(() => {
      bindingPattern(c);
      return paramFollows(c.peek()) || (c.at(")") && isToken(c.peek(1), "=>"));
    });
    c.pos = before;
    return follows === true;
  }
  if (a.kind !== "ident") return false;
  return paramFollows(b) || (isToken(b, ")") && isToken(d, "=>"));
}

function functionType(c: Cursor): TypeNode {
  const start = c.peek().start;
  const abstract = c.eat("abstract");
  const construct = c.eat("new");
  const typeParams = typeParameters(c);
  const params = parameters(c);
  c.expect("=>");
  const returns = returnType(c);
  return { kind: "function", typeParams, params, returns, construct, abstract, start, end: returns.end };
}

// A union or intersection; a leading separator is allowed, as in a multi-line union.
function composite(c: Cursor, kind: "union" | "intersection", separator: string, member: () => TypeNode): TypeNode {
  const start = c.peek().start;
  c.eat(separator);
  const types = [member()];
  while (c.eat(separator)) types.push(member());
  if (types.length === 1) return types[0]!;
  return { kind, types, start, end: types.at(-1)!.end };
}

function typeOperator(c: Cursor): TypeNode {
  const t = c.peek();
  if (c.at("keyof") || c.at("readonly") || c.at("unique")) {
    c.next();
    const operand = typeOperator(c);
    return { kind: "operator", op: t.text as "keyof" | "readonly" | "unique", type: operand, start: t.start, end: operand.end };
  }
  if (c.at("infer") && c.peek(1).kind === "ident") return inferType(c);
  return postfixType(c);
}

// `infer U extends C` is ambiguous with a conditional on `infer U`. Outside an `extends`
// clause, a `?` after the constraint means it was a conditional, so it is read again as one.
function inferType(c: Cursor): TypeNode {
  const start = c.next().start;
  const name = c.ident().text;
  const before = c.pos;
  let constraint = c.eat("extends") ? type(c, false) : undefined;
  if (constraint && c.conditionalAllowed && c.at("?")) {
    c.pos = before;
    constraint = undefined;
  }
  return { kind: "infer", name, constraint, start, end: c.end() };
}

// `T[]` and `T[K]`. A `[` on a new line starts the next statement instead, as in TypeScript.
function postfixType(c: Cursor): TypeNode {
  let t = primaryType(c);
  while (c.at("[") && !c.peek().newlineBefore) {
    c.next();
    if (c.at("]")) {
      t = { kind: "array", element: t, start: t.start, end: c.next().end };
    } else {
      const index = type(c);
      t = { kind: "indexed", object: t, index, start: t.start, end: c.expect("]").end };
    }
  }
  return t;
}

function primaryType(c: Cursor): TypeNode {
  const t = c.peek();
  if (c.eat("(")) {
    const inner = type(c);
    c.expect(")");
    return inner;
  }
  const isNumber = (t: Token) => t.kind === "int" || t.kind === "float" || t.kind === "bigint";
  if (t.kind === "string" || isNumber(t) || c.at("true") || c.at("false")) {
    return { kind: "literal", value: primary(c), start: t.start, end: t.end };
  }
  if (c.at("-") && isNumber(c.peek(1))) {
    const value = unary(c);
    return { kind: "literal", value, start: value.start, end: value.end };
  }
  if (t.kind === "template" || t.kind === "templateHead") {
    const { quasis, parts, start, end } = templateParts(c, (c) => type(c));
    return { kind: "template", quasis, types: parts, start, end };
  }
  if (c.at("[")) return tuple(c);
  if (c.at("{")) return atMappedType(c) ? mappedType(c) : objectType(c);
  if (c.at("import")) return importType(c);
  if (c.eat("typeof")) {
    const target = c.at("import") ? importType(c) : typeReference(c);
    return { kind: "query", target, start: t.start, end: target.end };
  }
  return typeReference(c);
}

function tuple(c: Cursor): TypeNode {
  const start = c.expect("[").start;
  const elements = c.list(() => {
    const start = c.peek().start;
    const rest = c.eat("...");
    const [after, then] = [c.peek(1), c.peek(2)];
    const named = c.peek().kind === "ident" && (isToken(after, ":") || (isToken(after, "?") && isToken(then, ":")));
    const name = named ? c.next().text : undefined;
    let optional = named && c.eat("?");
    if (named) c.expect(":");
    const element = type(c);
    if (!named) optional = c.eat("?");
    return { name, optional, rest, type: element, start, end: c.end() };
  }, "]");
  return { kind: "tuple", elements, start, end: c.end() };
}

function atMappedType(c: Cursor): boolean {
  let i = 1;
  if (isToken(c.peek(i), "+") || isToken(c.peek(i), "-")) i++;
  if (isToken(c.peek(i), "readonly")) i++;
  return isToken(c.peek(i), "[") && c.peek(i + 1).kind === "ident" && isToken(c.peek(i + 2), "in");
}

// `{ readonly [K in T as N]?: V }`, where each modifier may carry `+` or `-`.
function mappedType(c: Cursor): TypeNode {
  const start = c.expect("{").start;
  const readonly = modifier(c, "readonly");
  c.expect("[");
  const name = c.ident().text;
  c.expect("in");
  const constraint = type(c);
  const as = c.eat("as") ? type(c) : undefined;
  c.expect("]");
  const optional = modifier(c, "?");
  const valueType = c.at(":") ? annotation(c) : undefined;
  if (!c.eat(";")) c.eat(",");
  c.expect("}");
  return { kind: "mapped", name, constraint, as, type: valueType, readonly, optional, start, end: c.end() };
}

function modifier(c: Cursor, text: string): "+" | "-" | undefined {
  const sign = c.at("+") || c.at("-") ? c.next().text : undefined;
  if (sign) c.expect(text);
  else if (!c.eat(text)) return undefined;
  return sign === "-" ? "-" : "+";
}

// `import("module").A.B<T>`
function importType(c: Cursor): TypeNode {
  const start = c.expect("import").start;
  c.expect("(");
  if (c.peek().kind !== "string") throw c.error("expected a module name");
  const module = c.next().text;
  c.expect(")");
  let name: string | undefined;
  while (c.eat(".")) {
    if (c.peek().kind !== "ident") throw c.error("expected an identifier");
    name = name === undefined ? c.next().text : `${name}.${c.next().text}`;
  }
  const args = c.eat("<") ? c.list(() => type(c), ">") : [];
  return { kind: "import", module, name, args, start, end: c.end() };
}

function objectType(c: Cursor): TypeNode {
  const start = c.expect("{").start;
  const members = typeMembers(c);
  return { kind: "object", members, start, end: c.end() };
}

// Members up to and including `}`, separated by `;`, `,` or a newline.
export function typeMembers(c: Cursor): TypeMember[] {
  const members: TypeMember[] = [];
  while (!c.eat("}")) {
    if (c.peek().kind === "eof") throw c.error("expected '}'");
    members.push(typeMember(c));
    if (!c.eat(";") && !c.eat(",") && !c.at("}") && !c.peek().newlineBefore) throw c.error("expected ';'");
  }
  return members;
}

// `readonly`, `get`, `set` and `new` are only keywords here when what follows can't be
// read any other way, so `{ get: T; new: U }` declares ordinary properties.
function typeMember(c: Cursor): TypeMember {
  const start = c.peek().start;
  const startsName = (t: Token) => isPropertyName(t) || isToken(t, "[");
  if (c.at("(") || c.at("<")) return { kind: "call", ...signature(c), start, end: c.end() };
  const after = c.peek(1);
  if (c.at("new") && (isToken(after, "(") || isToken(after, "<"))) {
    c.next();
    return { kind: "construct", ...signature(c), start, end: c.end() };
  }
  if ((c.at("get") || c.at("set")) && startsName(after)) {
    const kind = c.next().text as "get" | "set";
    const name = propertyName(c);
    const { params, returns } = signature(c);
    return { kind, name, params, returns, start, end: c.end() };
  }
  const readonly = c.at("readonly") && startsName(after) && c.eat("readonly");
  if (c.at("[") && c.peek(1).kind === "ident" && isToken(c.peek(2), ":")) {
    c.next();
    const params = [parameter(c)];
    c.expect("]");
    const type = annotation(c);
    return { kind: "index", readonly, params, type, start, end: c.end() };
  }
  const name = propertyName(c);
  const optional = c.eat("?");
  if (c.at("(") || c.at("<")) return { kind: "method", name, optional, ...signature(c), start, end: c.end() };
  const type = c.at(":") ? annotation(c) : undefined;
  return { kind: "property", name, optional, readonly, type, start, end: c.end() };
}

// Property names may be reserved words, so any identifier is accepted.
export function propertyName(c: Cursor): PropertyName {
  const t = c.peek();
  if (c.eat("[")) {
    const key = expression(c);
    c.expect("]");
    return key;
  }
  if (!isPropertyName(t)) throw c.error("expected a property name");
  return c.next().text;
}

export const isPropertyName = (t: Token) => ["ident", "string", "int", "float", "bigint"].includes(t.kind);

// Type parameters, parameters and an optional return type, as in a method signature.
function signature(c: Cursor) {
  const typeParams = typeParameters(c);
  const params = parameters(c);
  const returns = returnAnnotation(c);
  return { typeParams, params, returns };
}

// Type names may be reserved words, as in `void`, so any identifier is accepted.
export function typeReference(c: Cursor): TypeNode {
  if (c.peek().kind !== "ident") throw c.error("expected a type");
  const first = c.next();
  let name = first.text;
  while (c.eat(".")) {
    if (c.peek().kind !== "ident") throw c.error("expected an identifier");
    name += "." + c.next().text;
  }
  const args = c.eat("<") ? c.list(() => type(c), ">") : [];
  return { kind: "ref", name, args, start: first.start, end: c.end() };
}
