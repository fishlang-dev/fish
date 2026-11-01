import { CompileError } from "./diag.ts";
import { isToken } from "./lexer.ts";
import {
  accessorOf, allowingIn, block, isReserved, type AssignOp, type BinaryOp, type Cursor, type Parse, type Expr, type ObjectProp, type Stmt, type Param, type TypeNode,
  type MatchArm, type Pattern, type TypeParam, type UnaryOp,
} from "./parser.ts";
import { classNode, decoratorList } from "./declarations.ts";
import { matchPattern, toPattern } from "./patterns.ts";
import { isPropertyName, parameters, propertyName, returnAnnotation, throwsClause, type, typeParameters } from "./types.ts";
import { nextId } from "./ids.ts";

// The expression grammar: recursive descent, with Pratt parsing for binary operators.

const BINARY_OPERATORS: BinaryOp[] = [
  "??", "||", "&&", "|", "^", "&", "===", "!==", "==", "!=", "<", "<=", ">", ">=", "instanceof", "in",
  "<<", ">>", ">>>", "+", "-", "*", "/", "%", "**",
];

// Binding power of each binary operator, as in TypeScript. All are left-associative but `**`.
function precedence(op: BinaryOp): usize {
  switch (op) {
    case "??": return 1;
    case "||": return 2;
    case "&&": return 3;
    case "|": return 4;
    case "^": return 5;
    case "&": return 6;
    case "===": case "!==": case "==": case "!=": return 7;
    case "<": case "<=": case ">": case ">=": case "instanceof": case "in": return 8;
    case "<<": case ">>": case ">>>": return 9;
    case "+": case "-": return 10;
    case "*": case "/": case "%": return 11;
    case "**": return 12;
  }
  return 0;
}

const UNARY_OPERATORS: UnaryOp[] = ["-", "+", "!", "~", "typeof", "void", "delete", "await"];

function unaryOperator(text: string): UnaryOp | undefined {
  return UNARY_OPERATORS.find((op) => op === text);
}

// A full expression, commas included, as in a statement, a condition or parentheses.
/** @throws {CompileError} */
export function sequence(c: Mut<Cursor>): Expr {
  const first = expression(c);
  if (!c.at(",")) return first;
  const start = first.start;
  let exprs = [first];
  while (c.eat(",")) exprs.push(expression(c));
  return { id: nextId(c.ids), kind: "sequence", exprs, start, end: c.end() };
}

// One expression without a top-level comma: an argument, an element, an initializer.
/** @throws {CompileError} */
export function expression(c: Mut<Cursor>): Expr {
  if (c.at("yield")) return yieldExpression(c);
  const arrow = atArrow(c) ? arrowFunction(c) : undefined;
  if (arrow !== undefined) return arrow!;
  const target = pipeline(c);
  const found = assignOperator(c);
  if (found === undefined) return target;
  const [op, width] = found!;
  c.pos += width;
  // Right-associative: `a = b = c` is `a = (b = c)`.
  const value = expression(c);
  if (op === "=" && (target.kind === "object" || target.kind === "array")) {
    const [targetStart, valueEnd] = [target.start, value.end];
    return { id: nextId(c.ids), kind: "destructure", pattern: toPattern(c, target), value, start: targetStart, end: valueEnd };
  }
  const targetStart: usize = target.start;
  const valueEnd: usize = value.end;
  return { id: nextId(c.ids), kind: "assign", op, target, value, start: targetStart, end: valueEnd };
}

// What can start an arrow function; the head is then tried in full before committing.
/** @throws {CompileError} */
function atArrow(c: Mut<Cursor>): boolean {
  return c.at("(") || c.at("<") || c.at("async") || c.at("move") || (c.peek().kind === "ident" && isToken(c.peek(1), "=>"));
}

// The head decides: `(a)` and `(a) => a` differ only at the `=>`, so the head is parsed on a
// trial basis and the body only once it is certain this is an arrow.
/** @throws {CompileError} */
function arrowFunction(c: Mut<Cursor>): Expr | undefined {
  const start = c.peek().start;
  const head = c.attempt((c) => arrowHead(c));
  if (head === undefined) return undefined;
  const body: Expr | Stmt[] = c.at("{") ? block(c) : expression(c);
  const h = head!;
  let arrow: Extract<Expr, { kind: "arrow" }> = { id: nextId(c.ids), kind: "arrow", move: h.move, async: h.async, typeParams: h.typeParams, params: h.params, returnType: h.returnType, body, start, end: c.end() };
  if (h.throws !== undefined) arrow.throws = h.throws;
  return arrow;
}

// What an arrow function has before its body.
type ArrowHead = { move: boolean; async: boolean; typeParams: TypeParam[]; params: Param[]; returnType: TypeNode | undefined; throws?: TypeNode };

/** @throws {CompileError} */
function arrowHead(c: Mut<Cursor>): ArrowHead {
  // `move` makes a closure take over what it captures. Like `async`, `move => 1` takes a
  // parameter named `move`, and `move(x)` without `=>` is a call.
  const move = c.at("move") && !isToken(c.peek(1), "=>") && !c.peek(1).newlineBefore && c.eat("move");
  // `async => 1` takes a parameter named `async`; `async(x)` without `=>` is a call.
  const async = c.at("async") && !isToken(c.peek(1), "=>") && !c.peek(1).newlineBefore && c.eat("async");
  let typeParams: TypeParam[] = [];
  let params: Param[];
  let returnType: TypeNode | undefined = undefined;
  let throws: TypeNode | undefined = undefined;
  if (c.peek().kind === "ident" && isToken(c.peek(1), "=>")) {
    const name = c.ident();
    const pattern: Pattern = { id: nextId(c.ids), kind: "ident", name: name.text, start: name.start, end: name.end };
    params = [{ id: nextId(c.ids), pattern, type: undefined, optional: false, rest: false, default: undefined, modifiers: [], decorators: [], comptime: false, start: name.start, end: name.end }];
  } else {
    typeParams = typeParameters(c);
    params = parameters(c);
    returnType = returnAnnotation(c);
    throws = throwsClause(c);
  }
  // No line break may come before `=>`, as in JavaScript.
  if (c.peek().newlineBefore) throw c.error("expected '=>'");
  c.expect("=>");
  let head: ArrowHead = { move, async, typeParams, params, returnType };
  if (throws !== undefined) head.throws = throws;
  return head;
}

// Hack-style pipes, as in the TC39 proposal: left-associative, looser than `? :`, with `%`
// standing for the value on the left. A right side that never uses `%` is an error there too.
/** @throws {CompileError} */
function pipeline(c: Mut<Cursor>): Expr {
  let value = conditional(c);
  while (c.eat("|>")) {
    const [inPipe, topicUsed] = [c.inPipe, c.topicUsed];
    c.inPipe = true;
    c.topicUsed = false;
    const body = conditional(c);
    const used = c.topicUsed;
    c.inPipe = inPipe;
    c.topicUsed = topicUsed;
    if (!used) throw new CompileError("E0004", "the right side of '|>' must use the topic '%'", body.start, body.end);
    const valueStart: usize = value.start;
    const bodyEnd: usize = body.end;
    value = { id: nextId(c.ids), kind: "pipe", value, body, start: valueStart, end: bodyEnd };
  }
  return value;
}

/** @throws {CompileError} */
function conditional(c: Mut<Cursor>): Expr {
  const cond = binary(c);
  if (!c.eat("?")) return cond;
  const then = allowingIn(c, true, (c) => expression(c));
  c.expect(":");
  const otherwise = expression(c);
  const condStart: usize = cond.start;
  const otherwiseEnd: usize = otherwise.end;
  return { id: nextId(c.ids), kind: "conditional", cond, then, else: otherwise, start: condStart, end: otherwiseEnd };
}

const ASSIGN_OPERATORS: AssignOp[] = ["=", "+=", "-=", "*=", "/=", "%=", "**=", "&=", "|=", "^=", "&&=", "||=", "??="];

// Like `>>`, `>>=`, `>>>=` and `<<=` arrive as separate adjacent tokens and are rejoined here.
/** @throws {CompileError} */
function assignOperator(c: Mut<Cursor>): [AssignOp, usize] | undefined {
  const t = c.token();
  if (t.kind !== "punct") return undefined;
  const op = ASSIGN_OPERATORS.find((op) => op === t.text);
  if (op !== undefined) return [op!, 1];
  // Only these start a rejoined operator. Looking ahead from anything else could lex past a
  // regex, as in `f(a,/'/)`.
  if (t.text !== "<" && t.text !== ">") return undefined;
  let text = "";
  for (let i = 0; i < 4; i++) {
    const n = c.token(i);
    if (n.kind !== "punct" || (i > 0 && n.start !== c.peek(i - 1).end)) break;
    text += n.text;
    if (text === ">>=") return [">>=", i + 1];
    if (text === ">>>=") return [">>>=", i + 1];
    if (text === "<<=") return ["<<=", i + 1];
  }
  return undefined;
}

// `yield` with nothing after it on the line yields undefined.
/** @throws {CompileError} */
function yieldExpression(c: Mut<Cursor>): Expr {
  const start = c.expect("yield").start;
  const delegate = c.eat("*");
  const t = c.token();
  const ends = t.newlineBefore || t.kind === "eof" || c.atAny([")", "]", "}", ",", ";", ":"]);
  const value = delegate || !ends ? expression(c) : undefined;
  return { id: nextId(c.ids), kind: "yield", value, delegate, start, end: c.end() };
}

/** @throws {CompileError} */
function binary(c: Mut<Cursor>, minPrecedence: usize = 0): Expr {
  const startsUnary = unaryOperator(c.peek().text) !== undefined && (c.peek().kind === "punct" || c.peek().kind === "ident");
  let left = unary(c);
  for (;;) {
    const found = binaryOperator(c);
    if (atTypeOperator(c) && minPrecedence < precedence("<")) {
      const kind: "as" | "satisfies" = c.next().text === "as" ? "as" : "satisfies";
      const t = type(c);
      const leftStart: usize = left.start;
      const tEnd: usize = t.end;
      left = { id: nextId(c.ids), kind, expr: left, type: t, start: leftStart, end: tEnd };
      continue;
    }
    if (found === undefined) return left;
    const [op, width] = found!;
    if (precedence(op) <= minPrecedence) return left;
    // TypeScript rejects `-a ** b` rather than pick a meaning for it.
    if (op === "**" && startsUnary && left.kind === "unary") throw c.error("parenthesise the left side of '**'");
    c.pos += width;
    // Right-associative: `a ** b ** c` is `a ** (b ** c)`.
    const right = binary(c, op === "**" ? precedence(op) - 1 : precedence(op));
    const leftStart: usize = left.start;
    const rightEnd: usize = right.end;
    left = { id: nextId(c.ids), kind: "binary", op, left, right, start: leftStart, end: rightEnd };
  }
}

// `comptime` is a modifier only before a name, a literal or `new` on the same line. Anything
// else keeps its TypeScript meaning: `comptime(x)` calls, `comptime[0]` indexes, and
// `comptime - 1` subtracts.
/** @throws {CompileError} */
function atComptime(c: Mut<Cursor>): boolean {
  if (!c.at("comptime")) return false;
  const next = c.token(1);
  if (next.newlineBefore) return false;
  if (["string", "int", "float", "bigint"].includes(next.kind)) return true;
  return next.kind === "ident" && !["in", "instanceof", "as", "satisfies"].includes(next.text);
}

// `as` and `satisfies` bind like relational operators, and only on the same line.
/** @throws {CompileError} */
function atTypeOperator(c: Mut<Cursor>): boolean {
  return (c.at("as") || c.at("satisfies")) && !c.peek().newlineBefore;
}

// The operator at the cursor and how many tokens it spans. The lexer emits `>` alone so that
// `A<B<C>>` closes two generics; `>>`, `>>>` and `>=` are rejoined here from adjacent tokens.
/** @throws {CompileError} */
function binaryOperator(c: Mut<Cursor>): [BinaryOp, usize] | undefined {
  const t = c.token();
  if (t.kind === "ident") {
    if (t.text === "instanceof") return ["instanceof", 1];
    return t.text === "in" && c.inAllowed ? ["in", 1] : undefined;
  }
  if (t.kind !== "punct") return undefined;
  if (t.text === "<") {
    // `<<=` arrives as `<` then `<=`, and is an assignment.
    if (adjacent(c, 1, "<=")) return undefined;
    return adjacent(c, 1, "<") ? ["<<", 2] : ["<", 1];
  }
  if (t.text !== ">") {
    const op = BINARY_OPERATORS.find((op) => op === t.text);
    return op === undefined ? undefined : [op!, 1];
  }
  let count: usize = 1;
  while (count < 3 && adjacent(c, count, ">")) count++;
  // `>>=` and `>>>=` are assignments, not comparisons.
  if (adjacent(c, count, "=")) return count === 1 ? [">=", 2] : undefined;
  if (count === 1) return [">", 1];
  return count === 2 ? [">>", 2] : [">>>", 3];
}

// Whether the token `i` ahead is `text`, written right after the one before it.
/** @throws {CompileError} */
function adjacent(c: Mut<Cursor>, i: usize, text: string): boolean {
  return isToken(c.peek(i), text) && c.peek(i).start === c.peek(i - 1).end;
}

/** @throws {CompileError} */
export function unary(c: Mut<Cursor>): Expr {
  const t = c.token();
  // A throw expression, as the TC39 proposal has it, as in `x ?? throw err`.
  if (c.eat("throw")) {
    const value = unary(c);
    const valueEnd: usize = value.end;
    return { id: nextId(c.ids), kind: "throw", value, start: t.start, end: valueEnd };
  }
  if (atComptime(c)) {
    c.next();
    const expr = unary(c);
    const exprEnd: usize = expr.end;
    return { id: nextId(c.ids), kind: "comptime", expr, start: t.start, end: exprEnd };
  }
  // `unsafe { expr }` gives `expr`'s value; like `comptime {`, it is a syntax error in TypeScript.
  if (c.at("unsafe") && isToken(c.peek(1), "{") && !c.peek(1).newlineBefore) {
    c.next();
    c.expect("{");
    const expr = expression(c);
    c.eat(";");
    c.expect("}");
    return { id: nextId(c.ids), kind: "unsafe", expr, start: t.start, end: c.end() };
  }
  if (c.eat("<")) {
    const asserted = type(c);
    c.expect(">");
    const expr = unary(c);
    const exprEnd: usize = expr.end;
    return { id: nextId(c.ids), kind: "assertion", type: asserted, expr, start: t.start, end: exprEnd };
  }
  if (c.at("++") || c.at("--")) {
    c.next();
    const operand = unary(c);
    const operandEnd: usize = operand.end;
    const op: "++" | "--" = t.text === "++" ? "++" : "--";
    return { id: nextId(c.ids), kind: "update", op, prefix: true, operand, start: t.start, end: operandEnd };
  }
  const op = unaryOperator(t.text);
  if (op === undefined || (t.kind !== "punct" && t.kind !== "ident")) return postfix(c);
  c.next();
  const operand = unary(c);
  const operandEnd: usize = operand.end;
  return { id: nextId(c.ids), kind: "unary", op: op!, operand, start: t.start, end: operandEnd };
}

// A newline before `++` or `--` ends the expression instead, as in JavaScript.
// A member chain with calls, as in `extends mixin(Base)`.
/** @throws {CompileError} */
export function leftHandSide(c: Mut<Cursor>): Expr {
  const head = c.at("new") ? newExpression(c) : primary(c);
  return chain(c, head, true);
}

/** @throws {CompileError} */
function postfix(c: Mut<Cursor>): Expr {
  const head = c.at("new") ? newExpression(c) : primary(c);
  const e = chain(c, head, true);
  if ((!c.at("++") && !c.at("--")) || c.peek().newlineBefore) return e;
  const op = c.next();
  const update: "++" | "--" = op.text === "++" ? "++" : "--";
  const eStart: usize = e.start;
  return { id: nextId(c.ids), kind: "update", op: update, prefix: false, operand: e, start: eStart, end: op.end };
}

// Member accesses, calls, tagged templates and `!` after `e`. Without `calls`, it stops
// before a call, as the callee of `new` does: `new a.b()` constructs `a.b`.
/** @throws {CompileError} */
function chain(c: Mut<Cursor>, head: Expr, calls: boolean): Expr {
  const start = head.start;
  let e = head;
  for (;;) {
    const t = c.token();
    const optional = calls && c.eat("?.");
    if (c.eat("[")) {
      const index = allowingIn(c, true, (c) => sequence(c));
      e = { id: nextId(c.ids), kind: "index", object: e, index, optional, start, end: c.expect("]").end };
    } else if (c.eat(".") || (optional && !c.at("(") && !c.at("<"))) {
      e = { id: nextId(c.ids), kind: "member", object: e, name: propertyKey(c), optional, start, end: c.end() };
    } else if (calls && (c.at("(") || c.at("<"))) {
      // After `?.` a `<` can only start type arguments, so a failure there is a real error.
      let typeArgs: TypeNode[] | undefined = [];
      if (c.at("<")) typeArgs = optional ? typeArguments(c, true) : c.attempt((c) => typeArguments(c, false));
      if (typeArgs === undefined) return e;
      const written = typeArgs!;
      if (c.at("(")) {
        c.next();
        const args = c.list((c) => element(c), ")");
        e = { id: nextId(c.ids), kind: "call", callee: e, typeArgs: written, args, optional, start, end: c.end() };
      } else if (atTemplate(c)) {
        const quoted = template(c);
        const quotedEnd: usize = quoted.end;
        e = { id: nextId(c.ids), kind: "tagged", tag: e, typeArgs: written, template: quoted, start, end: quotedEnd };
      } else {
        e = { id: nextId(c.ids), kind: "instantiation", expr: e, typeArgs: written, start, end: c.end() };
      }
    } else if (atTemplate(c)) {
      const quoted = template(c);
      const quotedEnd: usize = quoted.end;
      e = { id: nextId(c.ids), kind: "tagged", tag: e, typeArgs: [], template: quoted, start, end: quotedEnd };
    } else if (c.at("!") && !t.newlineBefore) {
      e = { id: nextId(c.ids), kind: "nonNull", expr: e, start, end: c.next().end };
    } else {
      return e;
    }
  }
}

// Property names after `.` may be reserved words, as in `a.default`.
/** @throws {CompileError} */
function propertyKey(c: Mut<Cursor>): string {
  if (c.peek().kind !== "ident" && c.peek().kind !== "private") throw c.error("expected a property name");
  return c.next().text;
}

/** @throws {CompileError} */
function atTemplate(c: Mut<Cursor>): boolean {
  return c.peek().kind === "template" || c.peek().kind === "templateHead";
}

// `<T>` before a call is only type arguments when what follows confirms it, as in
// TypeScript; otherwise `a < b > c` would be read as a generic. After `?.` it always is.
/** @throws {CompileError} */
function typeArguments(c: Mut<Cursor>, certain: boolean): TypeNode[] {
  c.expect("<");
  const args = c.list((c) => type(c), ">");
  const t = c.token();
  const follows = c.at("(") || atTemplate(c) || certain || t.newlineBefore || t.kind === "eof" ||
    c.atAny([")", "]", "}", ";", ",", ".", "?."]);
  if (!follows) throw c.error("expected '('");
  return args;
}

/** @throws {CompileError} */
function newExpression(c: Mut<Cursor>): Expr {
  const start = c.expect("new").start;
  if (c.eat(".")) {
    if (!c.at("target")) throw c.error("expected 'target'");
    return { id: nextId(c.ids), kind: "meta", name: "new.target", start, end: c.next().end };
  }
  const head = c.at("new") ? newExpression(c) : primary(c);
  const callee = chain(c, head, false);
  let typeArgs: TypeNode[] = [];
  if (c.at("<")) {
    const written = c.attempt((c) => typeArguments(c, false));
    if (written !== undefined) typeArgs = written!;
  }
  const args = c.eat("(") ? c.list((c) => element(c), ")") : undefined;
  return { id: nextId(c.ids), kind: "new", callee, typeArgs, args, start, end: c.end() };
}

// A template's pieces, with each substitution parsed by `part`; shared with template literal types.
/** @throws {CompileError} */
export function templateParts<T>(c: Mut<Cursor>, part: Parse<T>): { quasis: string[]; raw: string[]; parts: T[]; start: usize; end: usize } {
  const first = c.next();
  const start = first.start;
  let quasis = [first.text];
  let raw = [first.raw ?? ""];
  let parts: T[] = [];
  let piece = first;
  while (piece.kind !== "template" && piece.kind !== "templateTail") {
    parts.push(part(c));
    piece = c.token();
    if (piece.kind !== "templateMiddle" && piece.kind !== "templateTail") throw c.error("expected '}'");
    const next = c.next();
    quasis.push(next.text);
    raw.push(next.raw ?? "");
  }
  return { quasis, raw, parts, start, end: piece.end };
}

/** @throws {CompileError} */
function template(c: Mut<Cursor>): Expr {
  const { quasis, raw, parts, start, end } = templateParts(c, (c) => allowingIn(c, true, (c) => sequence(c)));
  return { id: nextId(c.ids), kind: "template", quasis, raw, exprs: parts, start, end };
}

/** @throws {CompileError} */
export function primary(c: Mut<Cursor>): Expr {
  if (c.peek().kind === "template" || c.peek().kind === "templateHead") return template(c);
  if (c.at("%")) {
    const t = c.next();
    if (!c.inPipe) throw new CompileError("E0004", "'%' is only valid on the right of '|>'", t.start, t.end);
    c.topicUsed = true;
    return { id: nextId(c.ids), kind: "topic", start: t.start, end: t.end };
  }
  if (c.at("/") || c.at("/=")) {
    const t = c.regex();
    const close = t.text.lastIndexOf("/");
    return { id: nextId(c.ids), kind: "regex", pattern: t.text.slice(1, close), flags: t.text.slice(close + 1), start: t.start, end: t.end };
  }
  if (c.at("[")) return array(c);
  if (c.at("{")) return object(c);
  if (c.at("function") || atAsync(c, "function")) return functionExpression(c);
  if (c.at("import")) return importExpression(c);
  if (c.at("match")) {
    const start = c.peek().start;
    const subject = c.attempt((c) => matchHead(c));
    if (subject !== undefined) return matchExpression(c, start, subject!);
  }
  if (c.at("class") || c.at("@")) {
    const start = c.peek().start;
    const decorators = decoratorList(c);
    let node = classNode(c, start, false, decorators);
    node.id = nextId(c.ids);
    return node;
  }
  if (c.peek().kind === "private") {
    const t = c.next();
    return { id: nextId(c.ids), kind: "privateName", name: t.text, start: t.start, end: t.end };
  }
  const t = c.next();
  const span = { start: t.start, end: t.end };
  switch (t.kind) {
    case "int":
      return { id: nextId(c.ids), kind: "int", value: integerValue(t.text), ...span };
    case "float":
      return { id: nextId(c.ids), kind: "float", value: Number(t.text.replaceAll("_", ""))!, ...span };
    case "bigint":
      return { id: nextId(c.ids), kind: "bigint", value: integerValue(t.text.slice(0, (t.text.length - 1) as i64)), ...span };
    case "string":
      return { id: nextId(c.ids), kind: "string", value: t.text, ...span };
    case "ident":
      if (t.text === "true" || t.text === "false") return { id: nextId(c.ids), kind: "bool", value: t.text === "true", ...span };
      if (t.text === "null") return { id: nextId(c.ids), kind: "null", ...span };
      if (t.text === "this") return { id: nextId(c.ids), kind: "this", ...span };
      if (t.text === "super") return { id: nextId(c.ids), kind: "super", ...span };
      if (isReserved(t.text)) break;
      return { id: nextId(c.ids), kind: "ident", name: t.text, ...span };
  }
  if (t.text === "(") {
    const e = allowingIn(c, true, (c) => sequence(c));
    c.expect(")");
    return e;
  }
  throw c.error("expected an expression", t);
}

// The value of an integer literal in any base, its `_` separators left out, as `BigInt` reads it.
function integerValue(text: string): bigint {
  const prefix = text.charAt(0) === "0" ? text.charAt(1).toLowerCase() : "";
  const base: i64 = prefix === "x" ? 16 : prefix === "o" ? 8 : prefix === "b" ? 2 : 10;
  let value = 0n;
  for (let i: usize = base === 10 ? 0 : 2; i < text.length; i++) {
    const digit = "0123456789abcdef".indexOf(text.charAt(i as i64).toLowerCase());
    if (digit >= 0) value = value * BigInt(base) + BigInt(digit);
  }
  return value;
}

// `import.meta`, or `import(specifier)` loading a module at run time.
/** @throws {CompileError} */
function importExpression(c: Mut<Cursor>): Expr {
  const start = c.expect("import").start;
  if (c.eat(".")) {
    if (!c.at("meta")) throw c.error("expected 'meta'");
    return { id: nextId(c.ids), kind: "meta", name: "import.meta", start, end: c.next().end };
  }
  c.expect("(");
  const args = c.list((c) => expression(c), ")");
  return { id: nextId(c.ids), kind: "import", args, start, end: c.end() };
}

// `match (subject)` followed by `{` on the same line. In TypeScript that is a syntax error, so
// anything else is a call to a function named `match`.
/** @throws {CompileError} */
function matchHead(c: Mut<Cursor>): Expr {
  c.expect("match");
  c.expect("(");
  const subject = allowingIn(c, true, (c) => sequence(c));
  c.expect(")");
  if (!c.at("{") || c.peek().newlineBefore) throw c.error("expected '{'");
  return subject;
}

/** @throws {CompileError} */
function matchExpression(c: Mut<Cursor>, start: usize, subject: Expr): Expr {
  c.expect("{");
  const arms = c.list((c) => matchArm(c), "}");
  return { id: nextId(c.ids), kind: "match", subject, arms, start, end: c.end() };
}

// `case P if guard => body`. The guard is parsed below the arrow and conditional levels, so in
// `case x if (a) => b` the `(a)` is the guard rather than an arrow's parameters.
/** @throws {CompileError} */
function matchArm(c: Mut<Cursor>): MatchArm {
  const start = c.expect("case").start;
  const pattern = matchPattern(c);
  const guard = c.eat("if") ? binary(c) : undefined;
  c.expect("=>");
  const at = c.peek().start;
  const body: MatchArm["body"] = c.at("{") ? { id: nextId(c.ids), kind: "block", body: block(c), start: at, end: c.end() } : expression(c);
  return { id: nextId(c.ids), pattern, guard, body, start, end: c.end() };
}

// An array element or a call argument: an expression, or `...` and one.
/** @throws {CompileError} */
function element(c: Mut<Cursor>): Expr {
  const start = c.peek().start;
  if (!c.eat("...")) return expression(c);
  const value = expression(c);
  const valueEnd: usize = value.end;
  return { id: nextId(c.ids), kind: "spread", value, start, end: valueEnd };
}

/** @throws {CompileError} */
function array(c: Mut<Cursor>): Expr {
  const start = c.expect("[").start;
  const elements = allowingIn(c, true, (c) => {
    let elements: Extract<Expr, { kind: "array" }>["elements"] = [];
    while (!c.eat("]")) {
      if (c.eat(",")) {
        elements.push(undefined);
        continue;
      }
      elements.push(element(c));
      if (!c.at("]")) c.expect(",");
    }
    return elements;
  });
  return { id: nextId(c.ids), kind: "array", elements, start, end: c.end() };
}

/** @throws {CompileError} */
function object(c: Mut<Cursor>): Expr {
  const start = c.expect("{").start;
  const props = c.list((c) => objectProp(c), "}");
  return { id: nextId(c.ids), kind: "object", props, start, end: c.end() };
}

// `async`, `get` and `set` are modifiers only when a property name follows, so
// `{ get: 1, async() {} }` has a property and a method with those names.
/** @throws {CompileError} */
function objectProp(c: Mut<Cursor>): ObjectProp {
  const start = c.peek().start;
  if (c.eat("...")) {
    const value = expression(c);
    const valueEnd: usize = value.end;
    return { id: nextId(c.ids), kind: "spread", value, start, end: valueEnd };
  }
  const async = c.at("async") && namedAt(c, 1) && !c.peek(1).newlineBefore && c.eat("async");
  const generator = c.eat("*");
  if (!async && !generator && (c.at("get") || c.at("set")) && namedAt(c, 1)) {
    const kind = accessorOf(c.next().text);
    const key = propertyName(c);
    const { params, returnType, body } = functionRest(c);
    return { id: nextId(c.ids), kind, key, params, returnType, body, start, end: c.end() };
  }
  const keyToken = c.token();
  const key = propertyName(c);
  if (async || generator || c.at("(") || c.at("<")) {
    return { id: nextId(c.ids), kind: "method", key, async, generator, ...functionRest(c), start, end: c.end() };
  }
  if (c.eat(":")) {
    const value = expression(c);
    const valueEnd: usize = value.end;
    return { id: nextId(c.ids), kind: "property", key, value, start, end: valueEnd };
  }
  if (keyToken.kind !== "ident" || isReserved(keyToken.text)) throw c.error("expected ':'");
  const fallback = c.eat("=") ? expression(c) : undefined;
  return { id: nextId(c.ids), kind: "shorthand", name: keyToken.text, default: fallback, start, end: c.end() };
}

// Whether a property name, a computed `[key]` or a generator's `*` is `offset` tokens ahead.
/** @throws {CompileError} */
function namedAt(c: Mut<Cursor>, offset: usize): boolean {
  return isPropertyName(c.peek(offset)) || isToken(c.peek(offset), "[") || isToken(c.peek(offset), "*");
}

// `async` starts an async function only when `next` follows on the same line.
/** @throws {CompileError} */
function atAsync(c: Mut<Cursor>, next: string): boolean {
  return c.at("async") && isToken(c.peek(1), next) && !c.peek(1).newlineBefore;
}

/** @throws {CompileError} */
function functionExpression(c: Mut<Cursor>): Expr {
  const start = c.peek().start;
  const async = c.eat("async");
  c.expect("function");
  const generator = c.eat("*");
  const name = c.at("(") || c.at("<") ? undefined : c.ident().text;
  return { id: nextId(c.ids), kind: "function", name, async, generator, ...functionRest(c), start, end: c.end() };
}

// What follows a function's name: type parameters, parameters, return type and body.
/** @throws {CompileError} */
function functionRest(c: Mut<Cursor>) {
  const typeParams = typeParameters(c);
  const params = parameters(c);
  const returnType = returnAnnotation(c);
  const body = block(c);
  return { typeParams, params, returnType, body };
}
