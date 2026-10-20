import { CompileError } from "./diag.ts";
import { RESERVED, type BinaryOp, type Cursor, type Expr } from "./parser.ts";

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
  let e = primary(c);
  for (;;) {
    if (c.eat(".")) {
      const name = c.ident();
      e = { kind: "member", object: e, name: name.text, start: e.start, end: name.end };
    } else if (c.eat("(")) {
      const args = c.list(() => expression(c), ")");
      e = { kind: "call", callee: e, args, start: e.start, end: c.end() };
    } else {
      return e;
    }
  }
}

export function primary(c: Cursor): Expr {
  const t = c.next();
  const span = { start: t.start, end: t.end };
  switch (t.kind) {
    case "int":
      return { kind: "int", value: BigInt(t.text.replaceAll("_", "")), ...span };
    case "string":
      return { kind: "string", value: t.text, ...span };
    case "ident":
      if (t.text === "true" || t.text === "false") return { kind: "bool", value: t.text === "true", ...span };
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
