import { CompileError } from "./diag.ts";
import { isToken } from "./lexer.ts";
import { block, RESERVED, type BinaryOp, type Cursor, type Expr, type ObjectProp, type TypeNode } from "./parser.ts";
import { isPropertyName, parameters, propertyName, returnAnnotation, type, typeParameters } from "./types.ts";

// The expression grammar: recursive descent, with Pratt parsing for binary operators.

// Binding power of each binary operator, as in TypeScript. All are left-associative.
const PRECEDENCE: Record<BinaryOp, number> = {
  "||": 1,
  "&&": 2,
  "===": 3, "!==": 3,
  "<": 4, "<=": 4, ">": 4, ">=": 4,
  "+": 5, "-": 5,
  "*": 6, "/": 6, "%": 6,
};

const isBinaryOp = (text: string): text is BinaryOp => Object.hasOwn(PRECEDENCE, text);

export function expression(c: Cursor, minPrecedence = 0): Expr {
  let left = unary(c);
  for (;;) {
    const op = binaryOperator(c);
    if (!op || PRECEDENCE[op] <= minPrecedence) return left;
    if (c.next().text !== op) c.next();
    const right = expression(c, PRECEDENCE[op]);
    left = { kind: "binary", op, left, right, start: left.start, end: right.end };
  }
}

// `>=` arrives as `>` then `=`, so that generics can later close on `>`; rejoin it here.
// Migration rule A3 rewrites loose equality to strict, so native code never uses it.
function binaryOperator(c: Cursor): BinaryOp | undefined {
  const t = c.peek();
  if (t.kind !== "punct") return undefined;
  if (t.text === "==" || t.text === "!=") throw new CompileError(`'${t.text}' is not supported; use '${t.text}='`, t.start, t.end);
  const after = c.peek(1);
  const text = t.text === ">" && after.text === "=" && after.start === t.end ? ">=" : t.text;
  return isBinaryOp(text) ? text : undefined;
}

export function unary(c: Cursor): Expr {
  if (!c.at("-") && !c.at("!")) return postfix(c);
  const op = c.next();
  const operand = unary(c);
  return { kind: "unary", op: op.text === "-" ? "-" : "!", operand, start: op.start, end: operand.end };
}

function postfix(c: Cursor): Expr {
  return chain(c, c.at("new") ? newExpression(c) : primary(c), true);
}

// Member accesses, calls, tagged templates and `!` after `e`. Without `calls`, it stops
// before a call, as the callee of `new` does: `new a.b()` constructs `a.b`.
function chain(c: Cursor, e: Expr, calls: boolean): Expr {
  const start = e.start;
  for (;;) {
    const t = c.peek();
    const optional = calls && c.eat("?.");
    if (c.eat("[")) {
      const index = expression(c);
      e = { kind: "index", object: e, index, optional, start, end: c.expect("]").end };
    } else if (c.eat(".") || (optional && !c.at("(") && !c.at("<"))) {
      e = { kind: "member", object: e, name: propertyKey(c), optional, start, end: c.end() };
    } else if (calls && (c.at("(") || c.at("<"))) {
      // After `?.` a `<` can only start type arguments, so a failure there is a real error.
      const typeArgs = !c.at("<") ? [] : optional ? typeArguments(c, true) : c.attempt(() => typeArguments(c, false));
      if (!typeArgs) return e;
      if (c.at("(")) {
        c.next();
        const args = c.list(() => element(c), ")");
        e = { kind: "call", callee: e, typeArgs, args, optional, start, end: c.end() };
      } else if (atTemplate(c)) {
        const quoted = template(c);
        e = { kind: "tagged", tag: e, typeArgs, template: quoted, start, end: quoted.end };
      } else {
        e = { kind: "instantiation", expr: e, typeArgs, start, end: c.end() };
      }
    } else if (atTemplate(c)) {
      const quoted = template(c);
      e = { kind: "tagged", tag: e, typeArgs: [], template: quoted, start, end: quoted.end };
    } else if (c.at("!") && !t.newlineBefore) {
      e = { kind: "nonNull", expr: e, start, end: c.next().end };
    } else {
      return e;
    }
  }
}

// Property names after `.` may be reserved words, as in `a.default`.
function propertyKey(c: Cursor): string {
  if (c.peek().kind !== "ident") throw c.error("expected a property name");
  return c.next().text;
}

const atTemplate = (c: Cursor) => c.peek().kind === "template" || c.peek().kind === "templateHead";

// `<T>` before a call is only type arguments when what follows confirms it, as in
// TypeScript; otherwise `a < b > c` would be read as a generic. After `?.` it always is.
function typeArguments(c: Cursor, certain: boolean): TypeNode[] {
  c.expect("<");
  const args = c.list(() => type(c), ">");
  const t = c.peek();
  const follows = c.at("(") || atTemplate(c) || certain || t.newlineBefore || t.kind === "eof" ||
    [")", "]", "}", ";", ",", ".", "?."].some((text) => c.at(text));
  if (!follows) throw c.error("expected '('");
  return args;
}

function newExpression(c: Cursor): Expr {
  const start = c.expect("new").start;
  if (c.eat(".")) {
    if (!c.at("target")) throw c.error("expected 'target'");
    return { kind: "meta", name: "new.target", start, end: c.next().end };
  }
  const callee = chain(c, c.at("new") ? newExpression(c) : primary(c), false);
  const typeArgs = c.at("<") ? c.attempt(() => typeArguments(c, false)) ?? [] : [];
  const args = c.eat("(") ? c.list(() => element(c), ")") : undefined;
  return { kind: "new", callee, typeArgs, args, start, end: c.end() };
}

// A template's pieces, with each substitution parsed by `part`; shared with template literal types.
export function templateParts<T>(c: Cursor, part: (c: Cursor) => T): { quasis: string[]; parts: T[]; start: number; end: number } {
  const first = c.next();
  const quasis = [first.text];
  const parts: T[] = [];
  let piece = first;
  while (piece.kind !== "template" && piece.kind !== "templateTail") {
    parts.push(part(c));
    piece = c.peek();
    if (piece.kind !== "templateMiddle" && piece.kind !== "templateTail") throw c.error("expected '}'");
    quasis.push(c.next().text);
  }
  return { quasis, parts, start: first.start, end: piece.end };
}

function template(c: Cursor): Expr {
  const { quasis, parts, start, end } = templateParts(c, (c) => expression(c));
  return { kind: "template", quasis, exprs: parts, start, end };
}

export function primary(c: Cursor): Expr {
  if (c.peek().kind === "template" || c.peek().kind === "templateHead") return template(c);
  if (c.at("/") || c.at("/=")) {
    const t = c.regex();
    const close = t.text.lastIndexOf("/");
    return { kind: "regex", pattern: t.text.slice(1, close), flags: t.text.slice(close + 1), start: t.start, end: t.end };
  }
  if (c.at("[")) return array(c);
  if (c.at("{")) return object(c);
  if (c.at("function") || atAsync(c, "function")) return functionExpression(c);
  if (c.at("import")) return importExpression(c);
  const t = c.next();
  const span = { start: t.start, end: t.end };
  switch (t.kind) {
    case "int":
      return { kind: "int", value: BigInt(t.text.replaceAll("_", "")), ...span };
    case "float":
      return { kind: "float", value: Number(t.text.replaceAll("_", "")), ...span };
    case "bigint":
      return { kind: "bigint", value: BigInt(t.text.slice(0, -1).replaceAll("_", "")), ...span };
    case "string":
      return { kind: "string", value: t.text, ...span };
    case "ident":
      if (t.text === "true" || t.text === "false") return { kind: "bool", value: t.text === "true", ...span };
      if (t.text === "null" || t.text === "this" || t.text === "super") return { kind: t.text, ...span };
      if (RESERVED.has(t.text)) break;
      return { kind: "ident", name: t.text, ...span };
  }
  if (t.text === "(") {
    const e = expression(c);
    c.expect(")");
    return e;
  }
  throw c.error("expected an expression", t);
}

// `import.meta`, or `import(specifier)` loading a module at run time.
function importExpression(c: Cursor): Expr {
  const start = c.expect("import").start;
  if (c.eat(".")) {
    if (!c.at("meta")) throw c.error("expected 'meta'");
    return { kind: "meta", name: "import.meta", start, end: c.next().end };
  }
  c.expect("(");
  const args = c.list(() => expression(c), ")");
  return { kind: "import", args, start, end: c.end() };
}

// An array element or a call argument: an expression, or `...` and one.
function element(c: Cursor): Expr {
  const start = c.peek().start;
  if (!c.eat("...")) return expression(c);
  const value = expression(c);
  return { kind: "spread", value, start, end: value.end };
}

function array(c: Cursor): Expr {
  const start = c.expect("[").start;
  const elements: (Expr | undefined)[] = [];
  while (!c.eat("]")) {
    if (c.eat(",")) {
      elements.push(undefined);
      continue;
    }
    elements.push(element(c));
    if (!c.at("]")) c.expect(",");
  }
  return { kind: "array", elements, start, end: c.end() };
}

function object(c: Cursor): Expr {
  const start = c.expect("{").start;
  const props = c.list(() => objectProp(c), "}");
  return { kind: "object", props, start, end: c.end() };
}

// `async`, `get` and `set` are modifiers only when a property name follows, so
// `{ get: 1, async() {} }` has a property and a method with those names.
function objectProp(c: Cursor): ObjectProp {
  const start = c.peek().start;
  if (c.eat("...")) {
    const value = expression(c);
    return { kind: "spread", value, start, end: value.end };
  }
  const named = (offset: number) => isPropertyName(c.peek(offset)) || isToken(c.peek(offset), "[") || isToken(c.peek(offset), "*");
  const async = c.at("async") && named(1) && !c.peek(1).newlineBefore && c.eat("async");
  const generator = c.eat("*");
  if (!async && !generator && (c.at("get") || c.at("set")) && named(1)) {
    const kind = c.next().text as "get" | "set";
    const key = propertyName(c);
    const { params, returnType, body } = functionRest(c);
    return { kind, key, params, returnType, body, start, end: c.end() };
  }
  const keyToken = c.peek();
  const key = propertyName(c);
  if (async || generator || c.at("(") || c.at("<")) {
    return { kind: "method", key, async, generator, ...functionRest(c), start, end: c.end() };
  }
  if (c.eat(":")) {
    const value = expression(c);
    return { kind: "property", key, value, start, end: value.end };
  }
  if (keyToken.kind !== "ident" || RESERVED.has(keyToken.text)) throw c.error("expected ':'");
  return { kind: "shorthand", name: keyToken.text, start, end: keyToken.end };
}

// `async` starts an async function only when `next` follows on the same line.
function atAsync(c: Cursor, next: string): boolean {
  return c.at("async") && isToken(c.peek(1), next) && !c.peek(1).newlineBefore;
}

function functionExpression(c: Cursor): Expr {
  const start = c.peek().start;
  const async = c.eat("async");
  c.expect("function");
  const generator = c.eat("*");
  const name = c.at("(") || c.at("<") ? undefined : c.ident().text;
  return { kind: "function", name, async, generator, ...functionRest(c), start, end: c.end() };
}

// What follows a function's name: type parameters, parameters, return type and body.
function functionRest(c: Cursor) {
  const typeParams = typeParameters(c);
  const params = parameters(c);
  const returnType = returnAnnotation(c);
  const body = block(c);
  return { typeParams, params, returnType, body };
}
