import { CompileError } from "./diag.ts";
import { lex, type Token } from "./lexer.ts";

type Span = { start: number; end: number };

export type Expr = Span & (
  | { kind: "int"; value: bigint }
  | { kind: "string"; value: string }
  | { kind: "ident"; name: string }
  | { kind: "member"; object: Expr; name: string }
  | { kind: "call"; callee: Expr; args: Expr[] }
);

export type Stmt = { kind: "expr"; expr: Expr };

export type Func = Span & { name: string; body: Stmt[] };

// Recursive descent; expressions will grow into a Pratt loop as operators arrive.
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
      stmts.push({ kind: "expr", expr: expression() });
      endStatement();
    }
    next();
    return stmts;
  }

  // Automatic semicolon insertion: a `;`, a newline or a closing brace ends a statement.
  function endStatement() {
    if (at(";")) next();
    else if (!at("}") && !peek().newlineBefore && peek().kind !== "eof") throw error("expected ';'");
  }

  function expression(): Expr {
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
