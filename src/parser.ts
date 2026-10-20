import { CompileError } from "./diag.ts";
import { expression } from "./expressions.ts";
import { isToken, lex, type Token } from "./lexer.ts";
import { annotation, parameters, returnAnnotation, type, typeMembers, typeParameters, typeReference } from "./types.ts";

export type Span = { start: number; end: number };

export type TypeNode = Span & (
  // Keyword types are refs too; `name` is dotted for qualified names, e.g. "A.B".
  | { kind: "ref"; name: string; args: TypeNode[] }
  // A string, number, bigint or bool literal, or `-` applied to a number or bigint.
  | { kind: "literal"; value: Expr }
  | { kind: "array"; element: TypeNode }
  | { kind: "tuple"; elements: TupleElement[] }
  | { kind: "object"; members: TypeMember[] }
  | { kind: "function"; typeParams: TypeParam[]; params: Param[]; returns: TypeNode; construct: boolean; abstract: boolean }
  | { kind: "union" | "intersection"; types: TypeNode[] }
  | { kind: "operator"; op: "keyof" | "readonly" | "unique"; type: TypeNode }
  | { kind: "indexed"; object: TypeNode; index: TypeNode }
  // `typeof x.y<T>`; target is a ref or import naming a value.
  | { kind: "query"; target: TypeNode }
  | { kind: "import"; module: string; name: string | undefined; args: TypeNode[] }
  | { kind: "conditional"; check: TypeNode; extends: TypeNode; then: TypeNode; else: TypeNode }
  | { kind: "infer"; name: string; constraint: TypeNode | undefined }
  | { kind: "template"; quasis: string[]; types: TypeNode[] }
  | { kind: "mapped"; name: string; constraint: TypeNode; as: TypeNode | undefined;
      type: TypeNode | undefined; readonly: "+" | "-" | undefined; optional: "+" | "-" | undefined }
  // Only in return positions; name may be "this".
  | { kind: "predicate"; asserts: boolean; name: string; type: TypeNode | undefined }
);

export type Expr = Span & (
  // Every integer form, in any base.
  | { kind: "int"; value: bigint }
  // Has a fraction or an exponent.
  | { kind: "float"; value: number }
  | { kind: "bigint"; value: bigint }
  | { kind: "null" } | { kind: "this" } | { kind: "super" }
  // Decoded text; `quasis` has one more entry than `exprs`.
  | { kind: "template"; quasis: string[]; exprs: Expr[] }
  | { kind: "tagged"; tag: Expr; typeArgs: TypeNode[]; template: Expr }
  | { kind: "bool"; value: boolean }
  | { kind: "string"; value: string }
  | { kind: "ident"; name: string }
  | { kind: "member"; object: Expr; name: string }
  | { kind: "call"; callee: Expr; args: Expr[] }
  | { kind: "unary"; op: "-" | "!"; operand: Expr }
  | { kind: "binary"; op: BinaryOp; left: Expr; right: Expr }
);

export type Stmt = Span & (
  | { kind: "expr"; expr: Expr }
  | { kind: "let"; name: string; mutable: boolean; type: TypeNode | undefined; init: Expr }
  // `x += v` is stored as op "+"; `x++` as op "+" with value 1.
  | { kind: "assign"; target: Expr; op: ArithmeticOp | "="; value: Expr }
  | { kind: "return"; value: Expr | undefined }
  | { kind: "if"; cond: Expr; then: Stmt[]; else: Stmt[] | undefined }
  | { kind: "while"; cond: Expr; body: Stmt[] }
) | TypeAlias | Interface;

export type TupleElement = Span & { name: string | undefined; optional: boolean; rest: boolean; type: TypeNode };

// A string name covers identifier, string and number keys; an Expr is a computed `[key]`.
export type PropertyName = string | Expr;

export type TypeMember = Span & (
  | { kind: "property"; name: PropertyName; optional: boolean; readonly: boolean; type: TypeNode | undefined }
  | { kind: "method"; name: PropertyName; optional: boolean; typeParams: TypeParam[]; params: Param[]; returns: TypeNode | undefined }
  | { kind: "call" | "construct"; typeParams: TypeParam[]; params: Param[]; returns: TypeNode | undefined }
  | { kind: "index"; readonly: boolean; params: Param[]; type: TypeNode }
  | { kind: "get" | "set"; name: PropertyName; params: Param[]; returns: TypeNode | undefined }
);

export type Param = Span & { name: string; type: TypeNode | undefined; optional: boolean; rest: boolean };

export type TypeParam = Span & { name: string; constraint: TypeNode | undefined; default: TypeNode | undefined; modifiers: ("const" | "in" | "out")[] };

export type TypeAlias = Span & { kind: "typeAlias"; name: string; typeParams: TypeParam[]; type: TypeNode };

export type Interface = Span & { kind: "interface"; name: string; typeParams: TypeParam[]; extends: TypeNode[]; members: TypeMember[] };

export type Func = Span & { kind: "function"; name: string; typeParams: TypeParam[]; params: Param[]; returnType: TypeNode | undefined; body: Stmt[] };

export type Item = Func | TypeAlias | Interface;

export type BinaryOp = "||" | "&&" | "===" | "!==" | "<" | "<=" | ">" | ">=" | "+" | "-" | "*" | "/" | "%";

export type ArithmeticOp = "+" | "-" | "*" | "/" | "%";

// Each assignment operator and the binary operator it applies, if any.
const ASSIGNMENT: Record<string, ArithmeticOp | "="> = { "=": "=", "+=": "+", "-=": "-", "*=": "*", "/=": "/", "%=": "%" };

// Reserved in strict-mode JavaScript, so never usable as names.
export const RESERVED = new Set([
  "break", "case", "catch", "class", "const", "continue", "debugger", "default", "delete",
  "do", "else", "enum", "export", "extends", "false", "finally", "for", "function", "if",
  "import", "in", "instanceof", "let", "new", "null", "return", "static", "super", "switch",
  "this", "throw", "true", "try", "typeof", "var", "void", "while", "with", "yield",
]);

// The parser's position in the token stream, shared by the grammar modules.
export type Cursor = {
  pos: number;
  // False only directly inside a conditional type's `extends` clause, as in TypeScript.
  conditionalAllowed: boolean;
  // The token `offset` places ahead of the current one.
  peek(offset?: number): Token;
  next(): Token;
  at(text: string): boolean;
  // Consumes the token when it is `text`.
  eat(text: string): boolean;
  expect(text: string): Token;
  // A name that isn't a reserved word.
  ident(): Token;
  error(message: string, t?: Token): CompileError;
  // Items up to and including `close`, separated by commas, with an optional trailing comma.
  list<T>(item: () => T, close: string): T[];
  // Where the last consumed token ended.
  end(): number;
};

function cursor(tokens: Token[]): Cursor {
  const describe = (t: Token) => {
    if (t.kind === "eof") return "end of file";
    if (t.kind === "string") return "a string literal";
    return t.kind.startsWith("template") ? "a template literal" : `'${t.text}'`;
  };
  const c: Cursor = {
    pos: 0,
    conditionalAllowed: true,
    peek: (offset = 0) => tokens[Math.min(c.pos + offset, tokens.length - 1)]!,
    next: () => tokens[c.pos++]!,
    at: (text) => isToken(c.peek(), text),
    eat: (text) => {
      if (!c.at(text)) return false;
      c.next();
      return true;
    },
    expect: (text) => {
      if (!c.at(text)) throw c.error(`expected '${text}'`);
      return c.next();
    },
    ident: () => {
      if (c.peek().kind !== "ident") throw c.error("expected an identifier");
      if (RESERVED.has(c.peek().text)) throw c.error("expected a name");
      return c.next();
    },
    error: (message, t = c.peek()) => new CompileError(`${message}, found ${describe(t)}`, t.start, t.end),
    list: (item, close) => {
      const items = [];
      while (!c.at(close)) {
        items.push(item());
        if (!c.at(close)) c.expect(",");
      }
      c.next();
      return items;
    },
    end: () => tokens[c.pos - 1]!.end,
  };
  return c;
}

export function parse(src: string): Item[] {
  const c = cursor(lex(src));
  const items: Item[] = [];
  while (c.peek().kind !== "eof") {
    if (c.at("function")) {
      items.push(func(c));
    } else if (c.at("interface")) {
      items.push(interfaceDeclaration(c));
    } else if (atTypeAlias(c)) {
      items.push(typeAlias(c));
      endStatement(c);
    } else {
      const t = c.peek();
      throw new CompileError("only declarations are allowed at the top level; move this into main()", t.start, t.end);
    }
  }
  return items;
}

function func(c: Cursor): Func {
  const start = c.expect("function").start;
  const name = c.ident().text;
  const typeParams = typeParameters(c);
  const params = parameters(c);
  const returnType = returnAnnotation(c);
  const body = block(c);
  return { kind: "function", name, typeParams, params, returnType, body, start, end: c.end() };
}

function block(c: Cursor): Stmt[] {
  c.expect("{");
  const stmts: Stmt[] = [];
  while (!c.eat("}")) {
    if (c.peek().kind === "eof") throw c.error("expected '}'");
    stmts.push(statement(c));
  }
  return stmts;
}

// A braced block, or a single statement as in `if (x) return 1`.
function body(c: Cursor): Stmt[] {
  return c.at("{") ? block(c) : [statement(c)];
}

// Statements that end in a block need nothing after them; the rest end as in JavaScript.
function statement(c: Cursor): Stmt {
  if (c.at("if")) return ifStatement(c);
  if (c.at("while")) return whileStatement(c);
  if (c.at("interface")) return interfaceDeclaration(c);
  const s = atTypeAlias(c) ? typeAlias(c) : simpleStatement(c);
  endStatement(c);
  return s;
}

function ifStatement(c: Cursor): Stmt {
  const start = c.next().start;
  c.expect("(");
  const cond = expression(c);
  c.expect(")");
  const then = body(c);
  const otherwise = c.eat("else") ? body(c) : undefined;
  return { kind: "if", cond, then, else: otherwise, start, end: c.end() };
}

function whileStatement(c: Cursor): Stmt {
  const start = c.next().start;
  c.expect("(");
  const cond = expression(c);
  c.expect(")");
  const loop = body(c);
  return { kind: "while", cond, body: loop, start, end: c.end() };
}

function simpleStatement(c: Cursor): Stmt {
  const start = c.peek().start;
  if (c.at("var")) throw new CompileError("'var' is not supported; use 'let' or 'const'", start, c.peek().end);
  if (c.at("let") || c.at("const")) {
    const mutable = c.next().text === "let";
    const name = c.ident().text;
    const type = c.at(":") ? annotation(c) : undefined;
    if (!c.eat("=")) throw c.error("expected '=' (declarations need an initializer for now)");
    const init = expression(c);
    return { kind: "let", name, mutable, type, init, start, end: init.end };
  }
  if (c.at("return")) {
    const end = c.next().end;
    // A newline after `return` ends the statement, as in JavaScript.
    if (c.at(";") || c.at("}") || c.peek().newlineBefore || c.peek().kind === "eof") return { kind: "return", value: undefined, start, end };
    const value = expression(c);
    return { kind: "return", value, start, end: value.end };
  }
  if (c.at("++") || c.at("--")) {
    const op = c.next();
    return increment(expression(c), op, start);
  }
  const expr = expression(c);
  const t = c.peek();
  const op = t.kind === "punct" ? ASSIGNMENT[t.text] : undefined;
  if (op) {
    c.next();
    const value = expression(c);
    return { kind: "assign", target: expr, op, value, start, end: value.end };
  }
  // A newline before `++` ends the statement instead, as in JavaScript.
  if ((c.at("++") || c.at("--")) && !t.newlineBefore) return increment(expr, c.next(), start);
  return { kind: "expr", expr, start, end: expr.end };
}

// `type` is contextual: only a name following on the same line makes it a declaration.
function atTypeAlias(c: Cursor) {
  const after = c.peek(1);
  return c.at("type") && after.kind === "ident" && !after.newlineBefore;
}

function typeAlias(c: Cursor): TypeAlias {
  const start = c.next().start;
  const name = c.ident().text;
  const typeParams = typeParameters(c);
  c.expect("=");
  const t = type(c);
  return { kind: "typeAlias", name, typeParams, type: t, start, end: t.end };
}

function interfaceDeclaration(c: Cursor): Interface {
  const start = c.next().start;
  const name = c.ident().text;
  const typeParams = typeParameters(c);
  const bases: TypeNode[] = [];
  if (c.eat("extends")) {
    do bases.push(typeReference(c));
    while (c.eat(","));
  }
  c.expect("{");
  const members = typeMembers(c);
  return { kind: "interface", name, typeParams, extends: bases, members, start, end: c.end() };
}

function increment(target: Expr, op: Token, start: number): Stmt {
  const one: Expr = { kind: "int", value: 1n, start: op.start, end: op.end };
  const end = Math.max(target.end, op.end);
  return { kind: "assign", target, op: op.text === "++" ? "+" : "-", value: one, start, end };
}

// Automatic semicolon insertion: a `;`, a newline or a closing brace ends a statement.
function endStatement(c: Cursor) {
  if (c.eat(";")) return;
  if (!c.at("}") && !c.peek().newlineBefore && c.peek().kind !== "eof") throw c.error("expected ';'");
}
