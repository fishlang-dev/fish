import { CompileError } from "./diag.ts";
import { expression, sequence } from "./expressions.ts";
import { isToken, lexer, type Token } from "./lexer.ts";
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
  | { kind: "regex"; pattern: string; flags: string }
  // Decoded text; `quasis` has one more entry than `exprs`.
  | { kind: "template"; quasis: string[]; exprs: Expr[] }
  | { kind: "tagged"; tag: Expr; typeArgs: TypeNode[]; template: Expr }
  | { kind: "bool"; value: boolean }
  | { kind: "string"; value: string }
  | { kind: "ident"; name: string }
  // Only as an array element, an argument, or inside an object literal.
  | { kind: "spread"; value: Expr }
  // A hole, as in `[a, , b]`, is undefined.
  | { kind: "array"; elements: (Expr | undefined)[] }
  | { kind: "object"; props: ObjectProp[] }
  | { kind: "function"; name: string | undefined; async: boolean; generator: boolean;
      typeParams: TypeParam[]; params: Param[]; returnType: TypeNode | undefined; body: Stmt[] }
  // `body` is an expression, or the statements of a braced block.
  | { kind: "arrow"; async: boolean; typeParams: TypeParam[]; params: Param[];
      returnType: TypeNode | undefined; body: Expr | Stmt[] }
  // `optional` marks the link written `?.`; later links in the same chain short-circuit with it.
  | { kind: "member"; object: Expr; name: string; optional: boolean }
  | { kind: "index"; object: Expr; index: Expr; optional: boolean }
  | { kind: "call"; callee: Expr; typeArgs: TypeNode[]; args: Expr[]; optional: boolean }
  // `args` is undefined for `new C` without parentheses.
  | { kind: "new"; callee: Expr; typeArgs: TypeNode[]; args: Expr[] | undefined }
  // `f<T>` without a call.
  | { kind: "instantiation"; expr: Expr; typeArgs: TypeNode[] }
  | { kind: "meta"; name: "import.meta" | "new.target" }
  // `import(specifier, options?)`
  | { kind: "import"; args: Expr[] }
  | { kind: "nonNull"; expr: Expr }
  | { kind: "unary"; op: UnaryOp; operand: Expr }
  | { kind: "update"; op: "++" | "--"; prefix: boolean; operand: Expr }
  | { kind: "binary"; op: BinaryOp; left: Expr; right: Expr }
  | { kind: "conditional"; cond: Expr; then: Expr; else: Expr }
  | { kind: "assign"; op: AssignOp; target: Expr; value: Expr }
  // `a, b`; only where a full expression is allowed, never as an argument or element.
  | { kind: "sequence"; exprs: Expr[] }
  | { kind: "yield"; value: Expr | undefined; delegate: boolean }
  // `as const` is an `as` whose type is a ref named "const".
  | { kind: "as" | "satisfies"; expr: Expr; type: TypeNode }
  // `<T>x`
  | { kind: "assertion"; type: TypeNode; expr: Expr }
);

export type Stmt = Span & (
  | { kind: "expr"; expr: Expr }
  | { kind: "let"; keyword: "let" | "const" | "var"; declarations: Declarator[] }
  // `x += v` is stored as op "+"; `x++` as op "+" with value 1.
  | { kind: "assign"; target: Expr; op: ArithmeticOp | "="; value: Expr }
  | { kind: "return"; value: Expr | undefined }
  | { kind: "if"; cond: Expr; then: Stmt[]; else: Stmt[] | undefined }
  | { kind: "while"; cond: Expr; body: Stmt[] }
  | { kind: "block"; body: Stmt[] }
  | { kind: "empty" }
  | { kind: "debugger" }
) | TypeAlias | Interface | Func;

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

export type ObjectProp = Span & (
  | { kind: "property"; key: PropertyName; value: Expr }
  | { kind: "shorthand"; name: string }
  | { kind: "spread"; value: Expr }
  | { kind: "method"; key: PropertyName; async: boolean; generator: boolean; typeParams: TypeParam[];
      params: Param[]; returnType: TypeNode | undefined; body: Stmt[] }
  | { kind: "get" | "set"; key: PropertyName; params: Param[]; returnType: TypeNode | undefined; body: Stmt[] }
);

export type Param = Span & { name: string; type: TypeNode | undefined; optional: boolean; rest: boolean; default: Expr | undefined };

export type Pattern = Span & (
  | { kind: "ident"; name: string }
);

export type Declarator = Span & { target: Pattern; type: TypeNode | undefined; init: Expr | undefined };

export type TypeParam = Span & { name: string; constraint: TypeNode | undefined; default: TypeNode | undefined; modifiers: ("const" | "in" | "out")[] };

export type TypeAlias = Span & { kind: "typeAlias"; name: string; typeParams: TypeParam[]; type: TypeNode };

export type Interface = Span & { kind: "interface"; name: string; typeParams: TypeParam[]; extends: TypeNode[]; members: TypeMember[] };

export type Func = Span & {
  kind: "function"; name: string; async: boolean; generator: boolean;
  typeParams: TypeParam[]; params: Param[]; returnType: TypeNode | undefined; body: Stmt[];
};

export type BinaryOp =
  | "??" | "||" | "&&" | "|" | "^" | "&" | "===" | "!==" | "==" | "!="
  | "<" | "<=" | ">" | ">=" | "instanceof" | "in" | "<<" | ">>" | ">>>"
  | "+" | "-" | "*" | "/" | "%" | "**";

export type UnaryOp = "-" | "+" | "!" | "~" | "typeof" | "void" | "delete" | "await";

export type ArithmeticOp = "+" | "-" | "*" | "/" | "%";

export type AssignOp =
  | "=" | "+=" | "-=" | "*=" | "/=" | "%=" | "**=" | "<<=" | ">>=" | ">>>="
  | "&=" | "|=" | "^=" | "&&=" | "||=" | "??=";

// The assignments a statement can make so far, and the operator each applies.
const ASSIGNMENT: Partial<Record<AssignOp, ArithmeticOp | "=">> = { "=": "=", "+=": "+", "-=": "-", "*=": "*", "/=": "/", "%=": "%" };

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
  // Takes the `/` or `/=` at the cursor as the start of a regular expression instead.
  regex(): Token;
  // Runs `parse`; if it throws a CompileError, puts the cursor back and returns undefined.
  attempt<T>(parse: () => T): T | undefined;
};

function cursor(src: string): Cursor {
  const lex = lexer(src);
  // Every token lexed so far; lookahead and backtracking move `pos` within it.
  const tokens: Token[] = [];
  const describe = (t: Token) => {
    if (t.kind === "eof") return "end of file";
    if (t.kind === "string") return "a string literal";
    return t.kind.startsWith("template") ? "a template literal" : `'${t.text}'`;
  };
  const c: Cursor = {
    pos: 0,
    conditionalAllowed: true,
    peek: (offset = 0) => {
      while (tokens.length <= c.pos + offset && tokens.at(-1)?.kind !== "eof") tokens.push(lex.next());
      return tokens[Math.min(c.pos + offset, tokens.length - 1)]!;
    },
    next: () => {
      const t = c.peek();
      c.pos++;
      return t;
    },
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
    attempt: (parse) => {
      const [pos, conditionalAllowed] = [c.pos, c.conditionalAllowed];
      try {
        return parse();
      } catch (e) {
        if (!(e instanceof CompileError)) throw e;
        [c.pos, c.conditionalAllowed] = [pos, conditionalAllowed];
        return undefined;
      }
    },
    regex: () => {
      const slash = c.peek();
      tokens.length = c.pos;
      tokens.push(lex.regex(slash));
      return c.next();
    },
  };
  return c;
}

// A program is a list of statements; which of them may appear at the top level is the
// checker's call.
export function parse(src: string): Stmt[] {
  const c = cursor(src);
  const program: Stmt[] = [];
  while (c.peek().kind !== "eof") program.push(statement(c));
  return program;
}

function func(c: Cursor): Func {
  const start = c.peek().start;
  const async = c.eat("async");
  c.expect("function");
  const generator = c.eat("*");
  const name = c.ident().text;
  const typeParams = typeParameters(c);
  const params = parameters(c);
  const returnType = returnAnnotation(c);
  const body = block(c);
  return { kind: "function", name, async, generator, typeParams, params, returnType, body, start, end: c.end() };
}

export function block(c: Cursor): Stmt[] {
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
  const start = c.peek().start;
  if (c.at("function") || (c.at("async") && isToken(c.peek(1), "function") && !c.peek(1).newlineBefore)) return func(c);
  if (c.at("{")) return { kind: "block", body: block(c), start, end: c.end() };
  if (c.at(";")) return { kind: "empty", start, end: c.next().end };
  if (c.at("if")) return ifStatement(c);
  if (c.at("while")) return whileStatement(c);
  if (c.at("interface")) return interfaceDeclaration(c);
  const s: Stmt = c.at("debugger") ? { kind: "debugger", start, end: c.next().end }
    : atTypeAlias(c) ? typeAlias(c)
    : simpleStatement(c);
  endStatement(c);
  return s;
}

function ifStatement(c: Cursor): Stmt {
  const start = c.next().start;
  c.expect("(");
  const cond = sequence(c);
  c.expect(")");
  const then = body(c);
  const otherwise = c.eat("else") ? body(c) : undefined;
  return { kind: "if", cond, then, else: otherwise, start, end: c.end() };
}

function whileStatement(c: Cursor): Stmt {
  const start = c.next().start;
  c.expect("(");
  const cond = sequence(c);
  c.expect(")");
  const loop = body(c);
  return { kind: "while", cond, body: loop, start, end: c.end() };
}

function simpleStatement(c: Cursor): Stmt {
  const start = c.peek().start;
  if (c.at("let") || c.at("const") || c.at("var")) {
    const keyword = c.next().text as "let" | "const" | "var";
    const declarations: Declarator[] = [];
    do declarations.push(declarator(c));
    while (c.eat(","));
    return { kind: "let", keyword, declarations, start, end: c.end() };
  }
  if (c.at("return")) {
    const end = c.next().end;
    // A newline after `return` ends the statement, as in JavaScript.
    if (c.at(";") || c.at("}") || c.peek().newlineBefore || c.peek().kind === "eof") return { kind: "return", value: undefined, start, end };
    const value = sequence(c);
    return { kind: "return", value, start, end: value.end };
  }
  const expr = sequence(c);
  if (expr.kind === "update") return increment(expr);
  const op = expr.kind === "assign" ? ASSIGNMENT[expr.op] : undefined;
  if (expr.kind === "assign" && op) return { kind: "assign", target: expr.target, op, value: expr.value, start, end: expr.end };
  return { kind: "expr", expr, start, end: expr.end };
}

function declarator(c: Cursor): Declarator {
  const start = c.peek().start;
  const name = c.ident();
  const target: Pattern = { kind: "ident", name: name.text, start: name.start, end: name.end };
  const type = c.at(":") ? annotation(c) : undefined;
  const init = c.eat("=") ? expression(c) : undefined;
  return { target, type, init, start, end: c.end() };
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

// A statement `x++` or `++x` is `x += 1`; the 1 takes the operator's span.
function increment(e: Extract<Expr, { kind: "update" }>): Stmt {
  const at = e.prefix ? e.start : e.end - 2;
  const one: Expr = { kind: "int", value: 1n, start: at, end: at + 2 };
  return { kind: "assign", target: e.operand, op: e.op === "++" ? "+" : "-", value: one, start: e.start, end: e.end };
}

// Automatic semicolon insertion: a `;`, a newline or a closing brace ends a statement.
function endStatement(c: Cursor) {
  if (c.eat(";")) return;
  if (!c.at("}") && !c.peek().newlineBefore && c.peek().kind !== "eof") throw c.error("expected ';'");
}
