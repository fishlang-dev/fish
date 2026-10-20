import { CompileError } from "./diag.ts";
import { isToken } from "./lexer.ts";
import {
  allowingIn, block, RESERVED, type AssignOp, type BinaryOp, type Cursor, type Expr, type ObjectProp, type Param, type TypeNode,
  type MatchArm, type Pattern, type TypeParam, type UnaryOp,
} from "./parser.ts";
import { classNode, decoratorList } from "./declarations.ts";
import { matchPattern, toPattern } from "./patterns.ts";
import { isPropertyName, parameters, propertyName, returnAnnotation, type, typeParameters } from "./types.ts";

// The expression grammar: recursive descent, with Pratt parsing for binary operators.

// Binding power of each binary operator, as in TypeScript. All are left-associative but `**`.
const PRECEDENCE: Record<BinaryOp, number> = {
  "??": 1,
  "||": 2,
  "&&": 3,
  "|": 4,
  "^": 5,
  "&": 6,
  "===": 7, "!==": 7, "==": 7, "!=": 7,
  "<": 8, "<=": 8, ">": 8, ">=": 8, "instanceof": 8, "in": 8,
  "<<": 9, ">>": 9, ">>>": 9,
  "+": 10, "-": 10,
  "*": 11, "/": 11, "%": 11,
  "**": 12,
};

const isBinaryOp = (text: string): text is BinaryOp => Object.hasOwn(PRECEDENCE, text);

const UNARY = new Set(["-", "+", "!", "~", "typeof", "void", "delete", "await"]);

// A full expression, commas included, as in a statement, a condition or parentheses.
export function sequence(c: Cursor): Expr {
  const first = expression(c);
  if (!c.at(",")) return first;
  const exprs = [first];
  while (c.eat(",")) exprs.push(expression(c));
  return { kind: "sequence", exprs, start: first.start, end: c.end() };
}

// One expression without a top-level comma: an argument, an element, an initializer.
export function expression(c: Cursor): Expr {
  if (c.at("yield")) return yieldExpression(c);
  const arrow = atArrow(c) ? arrowFunction(c) : undefined;
  if (arrow) return arrow;
  const target = pipeline(c);
  const [op, width] = assignOperator(c) ?? [];
  if (!op || !width) return target;
  c.pos += width;
  // Right-associative: `a = b = c` is `a = (b = c)`.
  const value = expression(c);
  if (op === "=" && (target.kind === "object" || target.kind === "array")) {
    return { kind: "destructure", pattern: toPattern(target), value, start: target.start, end: value.end };
  }
  return { kind: "assign", op, target, value, start: target.start, end: value.end };
}

// What can start an arrow function; the head is then tried in full before committing.
function atArrow(c: Cursor): boolean {
  return c.at("(") || c.at("<") || c.at("async") || (c.peek().kind === "ident" && isToken(c.peek(1), "=>"));
}

// The head decides: `(a)` and `(a) => a` differ only at the `=>`, so the head is parsed on a
// trial basis and the body only once it is certain this is an arrow.
function arrowFunction(c: Cursor): Expr | undefined {
  const start = c.peek().start;
  const head = c.attempt(() => arrowHead(c));
  if (!head) return undefined;
  const body = c.at("{") ? block(c) : expression(c);
  return { kind: "arrow", ...head, body, start, end: c.end() };
}

function arrowHead(c: Cursor) {
  // `async => 1` takes a parameter named `async`; `async(x)` without `=>` is a call.
  const async = c.at("async") && !isToken(c.peek(1), "=>") && !c.peek(1).newlineBefore && c.eat("async");
  let typeParams: TypeParam[] = [];
  let params: Param[];
  let returnType: TypeNode | undefined;
  if (c.peek().kind === "ident" && isToken(c.peek(1), "=>")) {
    const name = c.ident();
    const pattern: Pattern = { kind: "ident", name: name.text, start: name.start, end: name.end };
    params = [{ pattern, type: undefined, optional: false, rest: false, default: undefined, modifiers: [], decorators: [], comptime: false, start: name.start, end: name.end }];
  } else {
    typeParams = typeParameters(c);
    params = parameters(c);
    returnType = returnAnnotation(c);
  }
  // No line break may come before `=>`, as in JavaScript.
  if (c.peek().newlineBefore) throw c.error("expected '=>'");
  c.expect("=>");
  return { async, typeParams, params, returnType };
}

// Hack-style pipes, as in the TC39 proposal: left-associative, looser than `? :`, with `%`
// standing for the value on the left. A right side that never uses `%` is an error there too.
function pipeline(c: Cursor): Expr {
  let value = conditional(c);
  while (c.eat("|>")) {
    const outer = c.topic;
    c.topic = { used: false };
    const body = conditional(c);
    const used = c.topic.used;
    c.topic = outer;
    if (!used) throw new CompileError("the right side of '|>' must use the topic '%'", body.start, body.end);
    value = { kind: "pipe", value, body, start: value.start, end: body.end };
  }
  return value;
}

function conditional(c: Cursor): Expr {
  const cond = binary(c);
  if (!c.eat("?")) return cond;
  const then = allowingIn(c, true, () => expression(c));
  c.expect(":");
  const otherwise = expression(c);
  return { kind: "conditional", cond, then, else: otherwise, start: cond.start, end: otherwise.end };
}

const ASSIGN_OPERATORS = new Set(["=", "+=", "-=", "*=", "/=", "%=", "**=", "&=", "|=", "^=", "&&=", "||=", "??="]);

// Like `>>`, `>>=`, `>>>=` and `<<=` arrive as separate adjacent tokens and are rejoined here.
function assignOperator(c: Cursor): [AssignOp, number] | undefined {
  const t = c.peek();
  if (t.kind !== "punct") return undefined;
  if (ASSIGN_OPERATORS.has(t.text)) return [t.text as AssignOp, 1];
  // Only these start a rejoined operator. Looking ahead from anything else could lex past a
  // regex, as in `f(a,/'/)`.
  if (t.text !== "<" && t.text !== ">") return undefined;
  let text = "";
  for (let i = 0; i < 4; i++) {
    const n = c.peek(i);
    if (n.kind !== "punct" || (i > 0 && n.start !== c.peek(i - 1).end)) break;
    text += n.text;
    if (text === ">>=" || text === ">>>=" || text === "<<=") return [text, i + 1];
  }
  return undefined;
}

// `yield` with nothing after it on the line yields undefined.
function yieldExpression(c: Cursor): Expr {
  const start = c.expect("yield").start;
  const delegate = c.eat("*");
  const t = c.peek();
  const ends = t.newlineBefore || t.kind === "eof" || [")", "]", "}", ",", ";", ":"].some((text) => c.at(text));
  const value = delegate || !ends ? expression(c) : undefined;
  return { kind: "yield", value, delegate, start, end: c.end() };
}

function binary(c: Cursor, minPrecedence = 0): Expr {
  const startsUnary = UNARY.has(c.peek().text) && (c.peek().kind === "punct" || c.peek().kind === "ident");
  let left = unary(c);
  for (;;) {
    const [op, width] = binaryOperator(c) ?? [];
    if (atTypeOperator(c) && minPrecedence < PRECEDENCE["<"]) {
      const kind = c.next().text as "as" | "satisfies";
      const t = type(c);
      left = { kind, expr: left, type: t, start: left.start, end: t.end };
      continue;
    }
    if (!op || !width || PRECEDENCE[op] <= minPrecedence) return left;
    // TypeScript rejects `-a ** b` rather than pick a meaning for it.
    if (op === "**" && startsUnary && left.kind === "unary") throw c.error("parenthesise the left side of '**'");
    c.pos += width;
    // Right-associative: `a ** b ** c` is `a ** (b ** c)`.
    const right = binary(c, op === "**" ? PRECEDENCE[op] - 1 : PRECEDENCE[op]);
    left = { kind: "binary", op, left, right, start: left.start, end: right.end };
  }
}

// `comptime` is a modifier only before a name, a literal or `new` on the same line. Anything
// else keeps its TypeScript meaning: `comptime(x)` calls, `comptime[0]` indexes, and
// `comptime - 1` subtracts.
function atComptime(c: Cursor): boolean {
  if (!c.at("comptime")) return false;
  const next = c.peek(1);
  if (next.newlineBefore) return false;
  if (["string", "int", "float", "bigint"].includes(next.kind)) return true;
  return next.kind === "ident" && !["in", "instanceof", "as", "satisfies"].includes(next.text);
}

// `as` and `satisfies` bind like relational operators, and only on the same line.
const atTypeOperator = (c: Cursor) => (c.at("as") || c.at("satisfies")) && !c.peek().newlineBefore;

// The operator at the cursor and how many tokens it spans. The lexer emits `>` alone so that
// `A<B<C>>` closes two generics; `>>`, `>>>` and `>=` are rejoined here from adjacent tokens.
function binaryOperator(c: Cursor): [BinaryOp, number] | undefined {
  const t = c.peek();
  if (t.kind === "ident") return t.text === "instanceof" || (t.text === "in" && c.inAllowed) ? [t.text, 1] : undefined;
  if (t.kind !== "punct") return undefined;
  const adjacent = (i: number, text: string) => isToken(c.peek(i), text) && c.peek(i).start === c.peek(i - 1).end;
  if (t.text === "<") {
    // `<<=` arrives as `<` then `<=`, and is an assignment.
    if (adjacent(1, "<=")) return undefined;
    return adjacent(1, "<") ? ["<<", 2] : ["<", 1];
  }
  if (t.text !== ">") return isBinaryOp(t.text) ? [t.text, 1] : undefined;
  let count = 1;
  while (count < 3 && adjacent(count, ">")) count++;
  // `>>=` and `>>>=` are assignments, not comparisons.
  if (adjacent(count, "=")) return count === 1 ? [">=", 2] : undefined;
  return [count === 1 ? ">" : count === 2 ? ">>" : ">>>", count];
}

export function unary(c: Cursor): Expr {
  const t = c.peek();
  if (atComptime(c)) {
    c.next();
    const expr = unary(c);
    return { kind: "comptime", expr, start: t.start, end: expr.end };
  }
  if (c.eat("<")) {
    const asserted = type(c);
    c.expect(">");
    const expr = unary(c);
    return { kind: "assertion", type: asserted, expr, start: t.start, end: expr.end };
  }
  if (c.at("++") || c.at("--")) {
    c.next();
    const operand = unary(c);
    return { kind: "update", op: t.text as "++" | "--", prefix: true, operand, start: t.start, end: operand.end };
  }
  if (!UNARY.has(t.text) || (t.kind !== "punct" && t.kind !== "ident")) return postfix(c);
  c.next();
  const operand = unary(c);
  return { kind: "unary", op: t.text as UnaryOp, operand, start: t.start, end: operand.end };
}

// A newline before `++` or `--` ends the expression instead, as in JavaScript.
// A member chain with calls, as in `extends mixin(Base)`.
export function leftHandSide(c: Cursor): Expr {
  return chain(c, c.at("new") ? newExpression(c) : primary(c), true);
}

function postfix(c: Cursor): Expr {
  const e = chain(c, c.at("new") ? newExpression(c) : primary(c), true);
  if ((!c.at("++") && !c.at("--")) || c.peek().newlineBefore) return e;
  const op = c.next();
  return { kind: "update", op: op.text as "++" | "--", prefix: false, operand: e, start: e.start, end: op.end };
}

// Member accesses, calls, tagged templates and `!` after `e`. Without `calls`, it stops
// before a call, as the callee of `new` does: `new a.b()` constructs `a.b`.
function chain(c: Cursor, e: Expr, calls: boolean): Expr {
  const start = e.start;
  for (;;) {
    const t = c.peek();
    const optional = calls && c.eat("?.");
    if (c.eat("[")) {
      const index = allowingIn(c, true, () => sequence(c));
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
  if (c.peek().kind !== "ident" && c.peek().kind !== "private") throw c.error("expected a property name");
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
  const { quasis, parts, start, end } = templateParts(c, (c) => allowingIn(c, true, () => sequence(c)));
  return { kind: "template", quasis, exprs: parts, start, end };
}

export function primary(c: Cursor): Expr {
  if (c.peek().kind === "template" || c.peek().kind === "templateHead") return template(c);
  if (c.at("%")) {
    const t = c.next();
    if (!c.topic) throw new CompileError("'%' is only valid on the right of '|>'", t.start, t.end);
    c.topic.used = true;
    return { kind: "topic", start: t.start, end: t.end };
  }
  if (c.at("/") || c.at("/=")) {
    const t = c.regex();
    const close = t.text.lastIndexOf("/");
    return { kind: "regex", pattern: t.text.slice(1, close), flags: t.text.slice(close + 1), start: t.start, end: t.end };
  }
  if (c.at("[")) return array(c);
  if (c.at("{")) return object(c);
  if (c.at("function") || atAsync(c, "function")) return functionExpression(c);
  if (c.at("import")) return importExpression(c);
  if (c.at("match")) {
    const start = c.peek().start;
    const subject = c.attempt(() => matchHead(c));
    if (subject) return matchExpression(c, start, subject);
  }
  if (c.at("class") || c.at("@")) {
    const start = c.peek().start;
    const decorators = decoratorList(c);
    return { kind: "class", ...classNode(c, start, false, decorators) };
  }
  if (c.peek().kind === "private") {
    const t = c.next();
    return { kind: "privateName", name: t.text, start: t.start, end: t.end };
  }
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
    const e = allowingIn(c, true, () => sequence(c));
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

// `match (subject)` followed by `{` on the same line. In TypeScript that is a syntax error, so
// anything else is a call to a function named `match`.
function matchHead(c: Cursor): Expr {
  c.expect("match");
  c.expect("(");
  const subject = allowingIn(c, true, () => sequence(c));
  c.expect(")");
  if (!c.at("{") || c.peek().newlineBefore) throw c.error("expected '{'");
  return subject;
}

function matchExpression(c: Cursor, start: number, subject: Expr): Expr {
  c.expect("{");
  const arms = c.list(() => matchArm(c), "}");
  return { kind: "match", subject, arms, start, end: c.end() };
}

// `case P if guard => body`. The guard is parsed below the arrow and conditional levels, so in
// `case x if (a) => b` the `(a)` is the guard rather than an arrow's parameters.
function matchArm(c: Cursor): MatchArm {
  const start = c.expect("case").start;
  const pattern = matchPattern(c);
  const guard = c.eat("if") ? binary(c) : undefined;
  c.expect("=>");
  const body = c.at("{") ? block(c) : expression(c);
  return { pattern, guard, body, start, end: c.end() };
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
  allowingIn(c, true, () => {
    while (!c.eat("]")) {
      if (c.eat(",")) {
        elements.push(undefined);
        continue;
      }
      elements.push(element(c));
      if (!c.at("]")) c.expect(",");
    }
  });
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
  const fallback = c.eat("=") ? expression(c) : undefined;
  return { kind: "shorthand", name: keyToken.text, default: fallback, start, end: c.end() };
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
