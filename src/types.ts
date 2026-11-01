import type { CompileError } from "./diag.ts";
import { expression, primary, templateParts, unary } from "./expressions.ts";
import { isToken, type Token } from "./lexer.ts";
import { accessorOf, modifierOf, type Cursor, type Parse, type Modifier, type Param, type Pattern, type PropertyName, type TupleElement, type TypeMember, type TypeNode, type TypeParam } from "./parser.ts";
import { decoratorList } from "./declarations.ts";
import { bindingPattern } from "./patterns.ts";
import { nextId } from "./ids.ts";

// The type grammar, and the parameter lists that functions and function types share.

/** @throws {CompileError} */
export function typeParameters(c: Mut<Cursor>): TypeParam[] {
  return c.eat("<") ? c.list((c) => typeParameter(c), ">") : [];
}

// A modifier is only a modifier when a name follows it, so `<out>` names a parameter `out`.
/** @throws {CompileError} */
function typeParameter(c: Mut<Cursor>): TypeParam {
  const start = c.peek().start;
  let modifiers: TypeParam["modifiers"] = [];
  while ((c.at("const") || c.at("in") || c.at("out")) && c.peek(1).kind === "ident") {
    const word = c.next().text;
    modifiers.push(word === "const" ? "const" : word === "in" ? "in" : "out");
  }
  const name = c.ident().text;
  const constraint = c.eat("extends") ? type(c) : undefined;
  const fallback = c.eat("=") ? type(c) : undefined;
  return { id: nextId(c.ids), name, constraint, default: fallback, modifiers, start, end: c.end() };
}

// Parameters in parentheses, or after an index signature's `[`, up to `close`.
/** @throws {CompileError} */
export function parameters(c: Mut<Cursor>, close = ")"): Param[] {
  if (close === ")") c.expect("(");
  return c.list((c) => parameter(c), close);
}

/** @throws {CompileError} */
function parameter(c: Mut<Cursor>): Param {
  const start = c.peek().start;
  const decorators = decoratorList(c);
  let modifiers: Modifier[] = [];
  // A parameter property's modifiers, each followed on the same line by what it modifies.
  while (c.atAny(["public", "private", "protected", "readonly", "override"]) && !c.peek(1).newlineBefore && startsBinding(c.peek(1))) {
    modifiers.push(modifierOf(c.next().text));
  }
  // `comptime n: i64` takes its argument at compile time.
  const comptime = c.at("comptime") && !c.peek(1).newlineBefore && startsBinding(c.peek(1)) && c.eat("comptime");
  const rest = c.eat("...");
  const t = c.token();
  const pattern: Pattern = c.eat("this") ? { id: nextId(c.ids), kind: "ident", name: "this", start: t.start, end: t.end } : bindingPattern(c);
  const optional = c.eat("?");
  const type = c.at(":") ? annotation(c) : undefined;
  const fallback = c.eat("=") ? expression(c) : undefined;
  return { id: nextId(c.ids), pattern, type, optional, rest, default: fallback, modifiers, decorators, comptime, start, end: c.end() };
}

function startsBinding(t: Ref<Token>): boolean {
  return t.kind === "ident" || isToken(t, "{") || isToken(t, "[");
}

// `: Type` after a declaration or parameter list.
/** @throws {CompileError} */
export function annotation(c: Mut<Cursor>): TypeNode {
  c.expect(":");
  return type(c);
}

// `: Type` where a function's result goes, which may also be a type predicate.
/** @throws {CompileError} */
export function returnAnnotation(c: Mut<Cursor>): TypeNode | undefined {
  if (!c.eat(":")) return undefined;
  return returnType(c);
}

// `throws T` after a function's result or parameters: the error type it may throw.
/** @throws {CompileError} */
export function throwsClause(c: Mut<Cursor>): TypeNode | undefined {
  if (!c.at("throws") || c.peek().newlineBefore) return undefined;
  c.next();
  return type(c);
}

// `x is T`, `asserts x is T` and `asserts x`; otherwise an ordinary type.
/** @throws {CompileError} */
function returnType(c: Mut<Cursor>): TypeNode {
  const start = c.peek().start;
  const after = c.token(1);
  // `asserts is T` narrows a parameter named `asserts`.
  const asserts = c.at("asserts") && after.kind === "ident" && !after.newlineBefore && !isToken(after, "is");
  if (asserts) c.next();
  const subject = c.token();
  const is = c.token(1);
  const narrows = subject.kind === "ident" && isToken(is, "is") && !is.newlineBefore;
  if (!asserts && !narrows) return type(c);
  c.next();
  const narrowed = narrows && c.eat("is") ? type(c) : undefined;
  return { id: nextId(c.ids), kind: "predicate", asserts, name: subject.text, type: narrowed, start, end: c.end() };
}

/** @throws {CompileError} */
export function type(c: Mut<Cursor>, allowConditional = true): TypeNode {
  const outer = c.conditionalAllowed;
  c.conditionalAllowed = allowConditional;
  const t = conditionalType(c);
  c.conditionalAllowed = outer;
  return t;
}

// An `extends` on a new line isn't a conditional, so the statement ends before it.
/** @throws {CompileError} */
function conditionalType(c: Mut<Cursor>): TypeNode {
  if (atFunctionType(c)) return functionType(c);
  const check = composite(c, "union", "|", (c) => composite(c, "intersection", "&", (c) => typeOperator(c)));
  if (!c.conditionalAllowed || !c.at("extends") || c.peek().newlineBefore) return check;
  c.next();
  const extendsType = type(c, false);
  c.expect("?");
  const then = type(c);
  c.expect(":");
  const otherwise = type(c);
  const checkStart: usize = check.start;
  const otherwiseEnd: usize = otherwise.end;
  return { id: nextId(c.ids), kind: "conditional", check, extends: extendsType, then, else: otherwise, start: checkStart, end: otherwiseEnd };
}

// Whether `t` can follow a parameter's name or pattern.
function paramFollows(t: Ref<Token>): boolean {
  return [":", ",", "?", "="].some((text) => isToken(t, text));
}

// `(` starts a function type only when what follows can't be a parenthesised type.
/** @throws {CompileError} */
function atFunctionType(c: Mut<Cursor>): boolean {
  if (c.at("<") || c.at("new") || (c.at("abstract") && isToken(c.peek(1), "new"))) return true;
  if (!c.at("(")) return false;
  const a = c.token(1);
  const b = c.token(2);
  const d = c.token(3);
  if (isToken(a, ")") || isToken(a, "...")) return true;
  if (isToken(a, "{") || isToken(a, "[")) {
    // A destructured first parameter: read the pattern on trial, then look past it.
    const before = c.pos;
    c.next();
    const follows = c.attempt((c) => {
      bindingPattern(c);
      return paramFollows(c.peek()) || (c.at(")") && isToken(c.peek(1), "=>"));
    });
    c.pos = before;
    return follows === true;
  }
  if (a.kind !== "ident") return false;
  return paramFollows(b) || (isToken(b, ")") && isToken(d, "=>"));
}

/** @throws {CompileError} */
function functionType(c: Mut<Cursor>): TypeNode {
  const start = c.peek().start;
  const abstract = c.eat("abstract");
  const construct = c.eat("new");
  const typeParams = typeParameters(c);
  const params = parameters(c);
  c.expect("=>");
  const returns = returnType(c);
  const throws = throwsClause(c);
  const end = throws === undefined ? returns.end : throws!.end;
  let t: Extract<TypeNode, { kind: "function" }> = { id: nextId(c.ids), kind: "function", typeParams, params, returns, construct, abstract, start, end };
  if (throws !== undefined) t.throws = throws;
  return t;
}

// A union or intersection; a leading separator is allowed, as in a multi-line union.
/** @throws {CompileError} */
function composite(c: Mut<Cursor>, kind: "union" | "intersection", separator: string, member: Parse<TypeNode>): TypeNode {
  const start = c.peek().start;
  c.eat(separator);
  let types = [member(c)];
  while (c.eat(separator)) types.push(member(c));
  if (types.length === 1) return types.pop()!;
  const end = types[types.length - 1]!.end;
  return { id: nextId(c.ids), kind, types, start, end };
}

/** @throws {CompileError} */
function typeOperator(c: Mut<Cursor>): TypeNode {
  const t = c.token();
  if (c.at("keyof") || c.at("readonly") || c.at("unique")) {
    c.next();
    const operand = typeOperator(c);
    const operandEnd: usize = operand.end;
    const op: "keyof" | "readonly" | "unique" = t.text === "keyof" ? "keyof" : t.text === "readonly" ? "readonly" : "unique";
    return { id: nextId(c.ids), kind: "operator", op, type: operand, start: t.start, end: operandEnd };
  }
  if (c.at("infer") && c.peek(1).kind === "ident") return inferType(c);
  return postfixType(c);
}

// `infer U extends C` is ambiguous with a conditional on `infer U`. Outside an `extends`
// clause, a `?` after the constraint means it was a conditional, so it is read again as one.
/** @throws {CompileError} */
function inferType(c: Mut<Cursor>): TypeNode {
  const start = c.next().start;
  const name = c.ident().text;
  const before = c.pos;
  let constraint = c.eat("extends") ? type(c, false) : undefined;
  if (constraint !== undefined && c.conditionalAllowed && c.at("?")) {
    c.pos = before;
    constraint = undefined;
  }
  return { id: nextId(c.ids), kind: "infer", name, constraint, start, end: c.end() };
}

// `T[]` and `T[K]`. A `[` on a new line starts the next statement instead, as in TypeScript.
/** @throws {CompileError} */
function postfixType(c: Mut<Cursor>): TypeNode {
  let t = primaryType(c);
  while (c.at("[") && !c.peek().newlineBefore) {
    c.next();
    if (c.at("]")) {
      const tStart: usize = t.start;
      t = { id: nextId(c.ids), kind: "array", element: t, start: tStart, end: c.next().end };
    } else {
      const index = type(c);
      const tStart: usize = t.start;
      t = { id: nextId(c.ids), kind: "indexed", object: t, index, start: tStart, end: c.expect("]").end };
    }
  }
  return t;
}

/** @throws {CompileError} */
function primaryType(c: Mut<Cursor>): TypeNode {
  const t = c.token();
  if (c.eat("(")) {
    const inner = type(c);
    c.expect(")");
    return inner;
  }
  const isNumber = (t: Ref<Token>) => t.kind === "int" || t.kind === "float" || t.kind === "bigint";
  if (t.kind === "string" || isNumber(t) || c.at("true") || c.at("false")) {
    return { id: nextId(c.ids), kind: "literal", value: primary(c), start: t.start, end: t.end };
  }
  if (c.at("-") && isNumber(c.peek(1))) {
    const value = unary(c);
    const valueStart: usize = value.start;
    const valueEnd: usize = value.end;
    return { id: nextId(c.ids), kind: "literal", value, start: valueStart, end: valueEnd };
  }
  if (t.kind === "template" || t.kind === "templateHead") {
    const { quasis, parts, start, end } = templateParts(c, (c) => type(c));
    return { id: nextId(c.ids), kind: "template", quasis, types: parts, start, end };
  }
  if (c.at("[")) return tuple(c);
  if (c.at("{")) return atMappedType(c) ? mappedType(c) : objectType(c);
  if (c.at("import")) return importType(c);
  if (c.eat("typeof")) {
    const target = c.at("import") ? importType(c) : typeReference(c);
    const targetEnd: usize = target.end;
    return { id: nextId(c.ids), kind: "query", target, start: t.start, end: targetEnd };
  }
  return typeReference(c);
}

/** @throws {CompileError} */
function tuple(c: Mut<Cursor>): TypeNode {
  const start = c.expect("[").start;
  const elements = c.list((c): TupleElement => {
    const start = c.peek().start;
    const rest = c.eat("...");
    const after = c.token(1);
    const then = c.token(2);
    const named = c.peek().kind === "ident" && (isToken(after, ":") || (isToken(after, "?") && isToken(then, ":")));
    const name = named ? c.next().text : undefined;
    let optional = named && c.eat("?");
    if (named) c.expect(":");
    const element = type(c);
    if (!named) optional = c.eat("?");
    return { id: nextId(c.ids), name, optional, rest, type: element, start, end: c.end() };
  }, "]");
  return { id: nextId(c.ids), kind: "tuple", elements, start, end: c.end() };
}

/** @throws {CompileError} */
function atMappedType(c: Mut<Cursor>): boolean {
  let i = 1;
  if (isToken(c.peek(i), "+") || isToken(c.peek(i), "-")) i++;
  if (isToken(c.peek(i), "readonly")) i++;
  return isToken(c.peek(i), "[") && c.peek(i + 1).kind === "ident" && isToken(c.peek(i + 2), "in");
}

// `{ readonly [K in T as N]?: V }`, where each modifier may carry `+` or `-`.
/** @throws {CompileError} */
function mappedType(c: Mut<Cursor>): TypeNode {
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
  return { id: nextId(c.ids), kind: "mapped", name, constraint, as, type: valueType, readonly, optional, start, end: c.end() };
}

/** @throws {CompileError} */
function modifier(c: Mut<Cursor>, text: string): "+" | "-" | undefined {
  const sign = c.at("+") || c.at("-") ? c.next().text : undefined;
  if (sign !== undefined) c.expect(text);
  else if (!c.eat(text)) return undefined;
  return sign === "-" ? "-" : "+";
}

// `import("module").A.B<T>`
/** @throws {CompileError} */
function importType(c: Mut<Cursor>): TypeNode {
  const start = c.expect("import").start;
  c.expect("(");
  if (c.peek().kind !== "string") throw c.error("expected a module name");
  const module = c.next().text;
  c.expect(")");
  // The dotted name after the module, or "" before any.
  let dotted = "";
  while (c.eat(".")) {
    if (c.peek().kind !== "ident") throw c.error("expected an identifier");
    dotted = dotted === "" ? c.next().text : `${dotted}.${c.next().text}`;
  }
  const name = dotted === "" ? undefined : dotted;
  const args: TypeNode[] = c.eat("<") ? c.list((c) => type(c), ">") : [];
  return { id: nextId(c.ids), kind: "import", module, name, args, start, end: c.end() };
}

/** @throws {CompileError} */
function objectType(c: Mut<Cursor>): TypeNode {
  const start = c.expect("{").start;
  const members = typeMembers(c);
  return { id: nextId(c.ids), kind: "object", members, start, end: c.end() };
}

// Members up to and including `}`, separated by `;`, `,` or a newline.
/** @throws {CompileError} */
export function typeMembers(c: Mut<Cursor>): TypeMember[] {
  let members: TypeMember[] = [];
  while (!c.eat("}")) {
    if (c.peek().kind === "eof") throw c.error("expected '}'");
    members.push(typeMember(c));
    if (!c.eat(";") && !c.eat(",") && !c.at("}") && !c.peek().newlineBefore) throw c.error("expected ';'");
  }
  return members;
}

// `readonly`, `get`, `set` and `new` are only keywords here when what follows can't be
// read any other way, so `{ get: T; new: U }` declares ordinary properties.
/** @throws {CompileError} */
function typeMember(c: Mut<Cursor>): TypeMember {
  const start = c.peek().start;
  const startsName = (t: Ref<Token>) => isPropertyName(t) || isToken(t, "[");
  if (c.at("(") || c.at("<")) return { id: nextId(c.ids), kind: "call", ...signature(c), start, end: c.end() };
  const after = c.token(1);
  if (c.at("new") && (isToken(after, "(") || isToken(after, "<"))) {
    c.next();
    return { id: nextId(c.ids), kind: "construct", ...signature(c), start, end: c.end() };
  }
  if ((c.at("get") || c.at("set")) && startsName(after)) {
    const kind = accessorOf(c.next().text);
    const name = propertyName(c);
    const { params, returns } = signature(c);
    return { id: nextId(c.ids), kind, name, params, returns, start, end: c.end() };
  }
  const readonly = c.at("readonly") && startsName(after) && c.eat("readonly");
  if (c.at("[") && c.peek(1).kind === "ident" && isToken(c.peek(2), ":")) {
    c.next();
    const params = [parameter(c)];
    c.expect("]");
    const type = annotation(c);
    return { id: nextId(c.ids), kind: "index", readonly, params, type, start, end: c.end() };
  }
  const name = propertyName(c);
  const optional = c.eat("?");
  if (c.at("(") || c.at("<")) return { id: nextId(c.ids), kind: "method", name, optional, ...signature(c), start, end: c.end() };
  const type = c.at(":") ? annotation(c) : undefined;
  return { id: nextId(c.ids), kind: "property", name, optional, readonly, type, start, end: c.end() };
}

// Property names may be reserved words, so any identifier is accepted.
/** @throws {CompileError} */
export function propertyName(c: Mut<Cursor>): PropertyName {
  const t = c.token();
  if (c.eat("[")) {
    const key = expression(c);
    c.expect("]");
    return key;
  }
  if (!isPropertyName(t)) throw c.error("expected a property name");
  return c.next().text;
}

export function isPropertyName(t: Ref<Token>): boolean {
  return ["ident", "string", "int", "float", "bigint"].includes(t.kind);
}

// Type parameters, parameters and an optional return type, as in a method signature.
/** @throws {CompileError} */
function signature(c: Mut<Cursor>) {
  const typeParams = typeParameters(c);
  const params = parameters(c);
  const returns = returnAnnotation(c);
  return { typeParams, params, returns };
}

// Type names may be reserved words, as in `void`, so any identifier is accepted.
/** @throws {CompileError} */
export function typeReference(c: Mut<Cursor>): TypeNode {
  if (c.peek().kind !== "ident") throw c.error("expected a type");
  const first = c.next();
  let name = first.text;
  while (c.eat(".")) {
    if (c.peek().kind !== "ident") throw c.error("expected an identifier");
    name += "." + c.next().text;
  }
  const args: TypeNode[] = c.eat("<") ? c.list((c) => type(c), ">") : [];
  return { id: nextId(c.ids), kind: "ref", name, args, start: first.start, end: c.end() };
}
