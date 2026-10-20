import { CompileError } from "./diag.ts";
import { lex, type Token } from "./lexer.ts";

export type Span = { start: number; end: number };

export type TypeRef = Span & { name: string };

export type Expr = Span & (
  | { kind: "int"; value: bigint }
  | { kind: "string"; value: string }
  | { kind: "ident"; name: string }
  | { kind: "member"; object: Expr; name: string }
  | { kind: "call"; callee: Expr; args: Expr[] }
  | { kind: "unary"; op: "-"; operand: Expr }
  | { kind: "binary"; op: BinaryOp; left: Expr; right: Expr }
);

export type Stmt = Span & (
  | { kind: "expr"; expr: Expr }
  | { kind: "let"; name: string; mutable: boolean; type: TypeRef | undefined; init: Expr }
);

export type Func = Span & { name: string; body: Stmt[] };

// Binding power of each binary operator, as in TypeScript. All are left-associative.
const PRECEDENCE = { "+": 5, "-": 5, "*": 6 } as const;

export type BinaryOp = keyof typeof PRECEDENCE;

const isBinaryOp = (text: string): text is BinaryOp => Object.hasOwn(PRECEDENCE, text);

// Reserved in strict-mode JavaScript, so never usable as names.
const RESERVED = new Set([
  "break", "case", "catch", "class", "const", "continue", "debugger", "default", "delete",
  "do", "else", "enum", "export", "extends", "false", "finally", "for", "function", "if",
  "import", "in", "instanceof", "let", "new", "null", "return", "static", "super", "switch",
  "this", "throw", "true", "try", "typeof", "var", "void", "while", "with", "yield",
]);

// Recursive descent, with Pratt parsing for binary operators.
export function parse(src: string): Func[] {
  const tokens = lex(src);
  let pos = 0;
  const peek = () => tokens[pos]!;
  const next = () => tokens[pos++]!;
  const at = (text: string) => peek().kind !== "string" && peek().text === text;
  const describe = (t: Token) => {
    if (t.kind === "eof") return "end of file";
    return t.kind === "string" ? "a string literal" : `'${t.text}'`;
  };
  const error = (msg: string, t = peek()) => new CompileError(`${msg}, found ${describe(t)}`, t.start, t.end);
  const expect = (text: string) => {
    if (!at(text)) throw error(`expected '${text}'`);
    return next();
  };
  const ident = () => {
    if (peek().kind !== "ident") throw error("expected an identifier");
    if (RESERVED.has(peek().text)) throw error("expected a name");
    return next();
  };

  const funcs: Func[] = [];
  while (peek().kind !== "eof") {
    if (!at("function")) {
      const t = peek();
      throw new CompileError("only declarations are allowed at the top level; move this into main()", t.start, t.end);
    }
    funcs.push(func());
  }
  return funcs;

  function func(): Func {
    const start = expect("function").start;
    const name = ident().text;
    expect("(");
    expect(")");
    const body = block();
    return { name, body, start, end: tokens[pos - 1]!.end };
  }

  function block(): Stmt[] {
    expect("{");
    const stmts: Stmt[] = [];
    while (!at("}")) {
      if (peek().kind === "eof") throw error("expected '}'");
      stmts.push(statement());
      endStatement();
    }
    next();
    return stmts;
  }

  function statement(): Stmt {
    const start = peek().start;
    if (at("var")) throw new CompileError("'var' is not supported; use 'let' or 'const'", start, peek().end);
    if (at("let") || at("const")) {
      const mutable = next().text === "let";
      const name = ident().text;
      let type: TypeRef | undefined;
      if (at(":")) {
        next();
        if (peek().kind !== "ident") throw error("expected a type");
        const t = next();
        type = { name: t.text, start: t.start, end: t.end };
      }
      if (!at("=")) throw error("expected '=' (declarations need an initializer for now)");
      next();
      const init = expression();
      return { kind: "let", name, mutable, type, init, start, end: init.end };
    }
    const expr = expression();
    return { kind: "expr", expr, start, end: expr.end };
  }

  // Automatic semicolon insertion: a `;`, a newline or a closing brace ends a statement.
  function endStatement() {
    if (at(";")) next();
    else if (!at("}") && !peek().newlineBefore && peek().kind !== "eof") throw error("expected ';'");
  }

  function expression(minPrecedence = 0): Expr {
    let left = unary();
    for (;;) {
      const t = peek();
      if (t.kind !== "punct" || !isBinaryOp(t.text) || PRECEDENCE[t.text] <= minPrecedence) return left;
      next();
      const right = expression(PRECEDENCE[t.text]);
      left = { kind: "binary", op: t.text, left, right, start: left.start, end: right.end };
    }
  }

  function unary(): Expr {
    if (!at("-")) return postfix();
    const op = next();
    const operand = unary();
    return { kind: "unary", op: "-", operand, start: op.start, end: operand.end };
  }

  function postfix(): Expr {
    let e = primary();
    for (;;) {
      if (at(".")) {
        next();
        const name = ident();
        e = { kind: "member", object: e, name: name.text, start: e.start, end: name.end };
      } else if (at("(")) {
        next();
        const args: Expr[] = [];
        while (!at(")")) {
          args.push(expression());
          if (!at(")")) expect(",");
        }
        e = { kind: "call", callee: e, args, start: e.start, end: next().end };
      } else {
        return e;
      }
    }
  }

  function primary(): Expr {
    const t = next();
    const span = { start: t.start, end: t.end };
    switch (t.kind) {
      case "int":
        return { kind: "int", value: BigInt(t.text.replaceAll("_", "")), ...span };
      case "string":
        return { kind: "string", value: t.text, ...span };
      case "ident":
        if (RESERVED.has(t.text)) break;
        return { kind: "ident", name: t.text, ...span };
    }
    if (t.text === "(") {
      const e = expression();
      expect(")");
      return e;
    }
    throw error("expected an expression", t);
  }
}
