import { CompileError } from "./diag.ts";
import { lex, type Token } from "./lexer.ts";

export type Span = { start: number; end: number };

export type TypeNode = Span & (
  // Keyword types are refs too; `name` is dotted for qualified names, e.g. "A.B".
  | { kind: "ref"; name: string; args: TypeNode[] }
  // A string, int or bool literal, or `-` applied to an int.
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
  | { kind: "mapped"; name: string; constraint: TypeNode; as: TypeNode | undefined;
      type: TypeNode | undefined; readonly: "+" | "-" | undefined; optional: "+" | "-" | undefined }
  // Only in return positions; name may be "this".
  | { kind: "predicate"; asserts: boolean; name: string; type: TypeNode | undefined }
);

export type Expr = Span & (
  | { kind: "int"; value: bigint }
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

// Binding power of each binary operator, as in TypeScript. All are left-associative.
const PRECEDENCE = {
  "||": 1,
  "&&": 2,
  "===": 3, "!==": 3,
  "<": 4, "<=": 4, ">": 4, ">=": 4,
  "+": 5, "-": 5,
  "*": 6, "/": 6, "%": 6,
} as const;

export type BinaryOp = keyof typeof PRECEDENCE;

export type ArithmeticOp = "+" | "-" | "*" | "/" | "%";

const isBinaryOp = (text: string): text is BinaryOp => Object.hasOwn(PRECEDENCE, text);

// Each assignment operator and the binary operator it applies, if any.
const ASSIGNMENT: Record<string, ArithmeticOp | "="> = { "=": "=", "+=": "+", "-=": "-", "*=": "*", "/=": "/", "%=": "%" };

// Reserved in strict-mode JavaScript, so never usable as names.
const RESERVED = new Set([
  "break", "case", "catch", "class", "const", "continue", "debugger", "default", "delete",
  "do", "else", "enum", "export", "extends", "false", "finally", "for", "function", "if",
  "import", "in", "instanceof", "let", "new", "null", "return", "static", "super", "switch",
  "this", "throw", "true", "try", "typeof", "var", "void", "while", "with", "yield",
]);

// Matches punctuation and keywords, never a string literal with the same text.
const isToken = (t: Token, text: string) => t.kind !== "string" && t.text === text;

// Recursive descent, with Pratt parsing for binary operators.
export function parse(src: string): Item[] {
  const tokens = lex(src);
  let pos = 0;
  const peek = () => tokens[pos]!;
  const next = () => tokens[pos++]!;
  const at = (text: string) => isToken(peek(), text);
  const describe = (t: Token) => {
    if (t.kind === "eof") return "end of file";
    return t.kind === "string" ? "a string literal" : `'${t.text}'`;
  };
  const error = (msg: string, t = peek()) => new CompileError(`${msg}, found ${describe(t)}`, t.start, t.end);
  const expect = (text: string) => {
    if (!at(text)) throw error(`expected '${text}'`);
    return next();
  };
  // Consumes the token when it is `text`.
  const eat = (text: string) => {
    if (!at(text)) return false;
    next();
    return true;
  };
  const ident = () => {
    if (peek().kind !== "ident") throw error("expected an identifier");
    if (RESERVED.has(peek().text)) throw error("expected a name");
    return next();
  };

  // False only directly inside a conditional's `extends` clause, as in TypeScript.
  let conditionalAllowed = true;

  const items: Item[] = [];
  while (peek().kind !== "eof") {
    if (at("function")) {
      items.push(func());
    } else if (at("interface")) {
      items.push(interfaceDeclaration());
    } else if (atTypeAlias()) {
      items.push(typeAlias());
      endStatement();
    } else {
      const t = peek();
      throw new CompileError("only declarations are allowed at the top level; move this into main()", t.start, t.end);
    }
  }
  return items;

  function func(): Func {
    const start = expect("function").start;
    const name = ident().text;
    const typeParams = typeParameters();
    const params = parameters();
    const returnType = returnAnnotation();
    const body = block();
    return { kind: "function", name, typeParams, params, returnType, body, start, end: tokens[pos - 1]!.end };
  }

  function block(): Stmt[] {
    expect("{");
    const stmts: Stmt[] = [];
    while (!at("}")) {
      if (peek().kind === "eof") throw error("expected '}'");
      stmts.push(statement());
    }
    next();
    return stmts;
  }

  // A braced block, or a single statement as in `if (x) return 1`.
  function body(): Stmt[] {
    return at("{") ? block() : [statement()];
  }

  // Statements that end in a block need nothing after them; the rest end as in JavaScript.
  function statement(): Stmt {
    if (at("if")) return ifStatement();
    if (at("while")) return whileStatement();
    if (at("interface")) return interfaceDeclaration();
    const s = atTypeAlias() ? typeAlias() : simpleStatement();
    endStatement();
    return s;
  }

  function ifStatement(): Stmt {
    const start = next().start;
    expect("(");
    const cond = expression();
    expect(")");
    const then = body();
    let otherwise: Stmt[] | undefined;
    if (at("else")) {
      next();
      otherwise = body();
    }
    return { kind: "if", cond, then, else: otherwise, start, end: tokens[pos - 1]!.end };
  }

  function whileStatement(): Stmt {
    const start = next().start;
    expect("(");
    const cond = expression();
    expect(")");
    const loop = body();
    return { kind: "while", cond, body: loop, start, end: tokens[pos - 1]!.end };
  }

  function simpleStatement(): Stmt {
    const start = peek().start;
    if (at("var")) throw new CompileError("'var' is not supported; use 'let' or 'const'", start, peek().end);
    if (at("let") || at("const")) {
      const mutable = next().text === "let";
      const name = ident().text;
      const type = at(":") ? annotation() : undefined;
      if (!at("=")) throw error("expected '=' (declarations need an initializer for now)");
      next();
      const init = expression();
      return { kind: "let", name, mutable, type, init, start, end: init.end };
    }
    if (at("return")) {
      const end = next().end;
      // A newline after `return` ends the statement, as in JavaScript.
      if (at(";") || at("}") || peek().newlineBefore || peek().kind === "eof") return { kind: "return", value: undefined, start, end };
      const value = expression();
      return { kind: "return", value, start, end: value.end };
    }
    if (at("++") || at("--")) {
      const op = next();
      return increment(expression(), op, start);
    }
    const expr = expression();
    const t = peek();
    const op = t.kind === "punct" ? ASSIGNMENT[t.text] : undefined;
    if (op) {
      next();
      const value = expression();
      return { kind: "assign", target: expr, op, value, start, end: value.end };
    }
    // A newline before `++` ends the statement instead, as in JavaScript.
    if ((at("++") || at("--")) && !t.newlineBefore) return increment(expr, next(), start);
    return { kind: "expr", expr, start, end: expr.end };
  }

  // `type` is contextual: only a name following on the same line makes it a declaration.
  function atTypeAlias() {
    const after = tokens[pos + 1]!;
    return at("type") && after.kind === "ident" && !after.newlineBefore;
  }

  function typeAlias(): TypeAlias {
    const start = next().start;
    const name = ident().text;
    const typeParams = typeParameters();
    expect("=");
    const t = type();
    return { kind: "typeAlias", name, typeParams, type: t, start, end: t.end };
  }

  function parameters(): Param[] {
    expect("(");
    return list(parameter, ")");
  }

  function parameter(): Param {
    const start = peek().start;
    const rest = eat("...");
    const name = at("this") ? next().text : ident().text;
    const optional = eat("?");
    const type = at(":") ? annotation() : undefined;
    return { name, type, optional, rest, start, end: tokens[pos - 1]!.end };
  }

  function interfaceDeclaration(): Interface {
    const start = next().start;
    const name = ident().text;
    const typeParams = typeParameters();
    const bases: TypeNode[] = [];
    if (eat("extends")) {
      do bases.push(typeReference());
      while (eat(","));
    }
    expect("{");
    const members = typeMembers();
    return { kind: "interface", name, typeParams, extends: bases, members, start, end: tokens[pos - 1]!.end };
  }

  function typeParameters(): TypeParam[] {
    return eat("<") ? list(typeParameter, ">") : [];
  }

  // A modifier is only a modifier when a name follows it, so `<out>` names a parameter `out`.
  function typeParameter(): TypeParam {
    const start = peek().start;
    const modifiers: TypeParam["modifiers"] = [];
    while ((at("const") || at("in") || at("out")) && tokens[pos + 1]!.kind === "ident") {
      modifiers.push(next().text as "const" | "in" | "out");
    }
    const name = ident().text;
    const constraint = eat("extends") ? type() : undefined;
    const fallback = eat("=") ? type() : undefined;
    return { name, constraint, default: fallback, modifiers, start, end: tokens[pos - 1]!.end };
  }

  // `: Type` after a declaration or parameter list.
  function annotation(): TypeNode {
    expect(":");
    return type();
  }

  function type(allowConditional = true): TypeNode {
    const outer = conditionalAllowed;
    conditionalAllowed = allowConditional;
    const t = conditionalType();
    conditionalAllowed = outer;
    return t;
  }

  // An `extends` on a new line isn't a conditional, so the statement ends before it.
  function conditionalType(): TypeNode {
    if (atFunctionType()) return functionType();
    const check = composite("union", "|", () => composite("intersection", "&", typeOperator));
    if (!conditionalAllowed || !at("extends") || peek().newlineBefore) return check;
    next();
    const extendsType = type(false);
    expect("?");
    const then = type();
    expect(":");
    const otherwise = type();
    return { kind: "conditional", check, extends: extendsType, then, else: otherwise, start: check.start, end: otherwise.end };
  }

  // `(` starts a function type only when what follows can't be a parenthesised type.
  function atFunctionType(): boolean {
    if (at("<") || at("new") || (at("abstract") && isToken(tokens[pos + 1]!, "new"))) return true;
    if (!at("(")) return false;
    const [a, b, c] = [tokens[pos + 1]!, tokens[pos + 2]!, tokens[pos + 3]!];
    if (isToken(a, ")") || isToken(a, "...")) return true;
    if (a.kind !== "ident") return false;
    return [":", ",", "?", "="].some((text) => isToken(b, text)) || (isToken(b, ")") && isToken(c, "=>"));
  }

  function functionType(): TypeNode {
    const start = peek().start;
    const abstract = eat("abstract");
    const construct = eat("new");
    const typeParams = typeParameters();
    const params = parameters();
    expect("=>");
    const returns = returnType();
    return { kind: "function", typeParams, params, returns, construct, abstract, start, end: returns.end };
  }

  // `: Type` where a function's result goes, which may also be a type predicate.
  function returnAnnotation(): TypeNode | undefined {
    if (!eat(":")) return undefined;
    return returnType();
  }

  // `x is T`, `asserts x is T` and `asserts x`; otherwise an ordinary type.
  function returnType(): TypeNode {
    const start = peek().start;
    const after = tokens[pos + 1]!;
    // `asserts is T` narrows a parameter named `asserts`.
    const asserts = at("asserts") && after.kind === "ident" && !after.newlineBefore && !isToken(after, "is");
    if (asserts) next();
    const subject = peek();
    const is = tokens[pos + 1]!;
    const narrows = subject.kind === "ident" && isToken(is, "is") && !is.newlineBefore;
    if (!asserts && !narrows) return type();
    next();
    const narrowed = narrows && eat("is") ? type() : undefined;
    return { kind: "predicate", asserts, name: subject.text, type: narrowed, start, end: tokens[pos - 1]!.end };
  }

  // A union or intersection; a leading separator is allowed, as in a multi-line union.
  function composite(kind: "union" | "intersection", separator: string, member: () => TypeNode): TypeNode {
    const start = peek().start;
    eat(separator);
    const types = [member()];
    while (eat(separator)) types.push(member());
    if (types.length === 1) return types[0]!;
    return { kind, types, start, end: types.at(-1)!.end };
  }

  function typeOperator(): TypeNode {
    const t = peek();
    if (at("keyof") || at("readonly") || at("unique")) {
      next();
      const operand = typeOperator();
      return { kind: "operator", op: t.text as "keyof" | "readonly" | "unique", type: operand, start: t.start, end: operand.end };
    }
    if (at("infer") && tokens[pos + 1]!.kind === "ident") return inferType();
    return postfixType();
  }

  // `infer U extends C` is ambiguous with a conditional on `infer U`. Outside an `extends`
  // clause, a `?` after the constraint means it was a conditional, so it is read again as one.
  function inferType(): TypeNode {
    const start = next().start;
    const name = ident().text;
    const before = pos;
    let constraint = eat("extends") ? type(false) : undefined;
    if (constraint && conditionalAllowed && at("?")) {
      pos = before;
      constraint = undefined;
    }
    return { kind: "infer", name, constraint, start, end: tokens[pos - 1]!.end };
  }

  // `T[]` and `T[K]`. A `[` on a new line starts the next statement instead, as in TypeScript.
  function postfixType(): TypeNode {
    let t = primaryType();
    while (at("[") && !peek().newlineBefore) {
      next();
      if (at("]")) {
        t = { kind: "array", element: t, start: t.start, end: next().end };
      } else {
        const index = type();
        t = { kind: "indexed", object: t, index, start: t.start, end: expect("]").end };
      }
    }
    return t;
  }

  function primaryType(): TypeNode {
    const t = peek();
    if (eat("(")) {
      const inner = type();
      expect(")");
      return inner;
    }
    if (t.kind === "string" || t.kind === "int" || at("true") || at("false")) return { kind: "literal", value: primary(), start: t.start, end: t.end };
    if (at("-") && tokens[pos + 1]!.kind === "int") {
      const value = unary();
      return { kind: "literal", value, start: value.start, end: value.end };
    }
    if (at("[")) return tuple();
    if (at("{")) return atMappedType() ? mappedType() : objectType();
    if (at("import")) return importType();
    if (eat("typeof")) {
      const target = at("import") ? importType() : typeReference();
      return { kind: "query", target, start: t.start, end: target.end };
    }
    return typeReference();
  }

  function tuple(): TypeNode {
    const start = expect("[").start;
    const elements = list(() => {
      const start = peek().start;
      const rest = eat("...");
      const [after, then] = [tokens[pos + 1]!, tokens[pos + 2]!];
      const named = peek().kind === "ident" && (isToken(after, ":") || (isToken(after, "?") && isToken(then, ":")));
      const name = named ? next().text : undefined;
      let optional = named && eat("?");
      if (named) expect(":");
      const element = type();
      if (!named) optional = eat("?");
      return { name, optional, rest, type: element, start, end: tokens[pos - 1]!.end };
    }, "]");
    return { kind: "tuple", elements, start, end: tokens[pos - 1]!.end };
  }

  function atMappedType(): boolean {
    let i = pos + 1;
    if (isToken(tokens[i]!, "+") || isToken(tokens[i]!, "-")) i++;
    if (isToken(tokens[i]!, "readonly")) i++;
    return isToken(tokens[i]!, "[") && tokens[i + 1]!.kind === "ident" && isToken(tokens[i + 2]!, "in");
  }

  // `{ readonly [K in T as N]?: V }`, where each modifier may carry `+` or `-`.
  function mappedType(): TypeNode {
    const start = expect("{").start;
    const readonly = modifier("readonly");
    expect("[");
    const name = ident().text;
    expect("in");
    const constraint = type();
    const as = eat("as") ? type() : undefined;
    expect("]");
    const optional = modifier("?");
    const valueType = at(":") ? annotation() : undefined;
    if (!eat(";")) eat(",");
    expect("}");
    return { kind: "mapped", name, constraint, as, type: valueType, readonly, optional, start, end: tokens[pos - 1]!.end };
  }

  function modifier(text: string): "+" | "-" | undefined {
    const sign = at("+") || at("-") ? next().text : undefined;
    if (sign) expect(text);
    else if (!eat(text)) return undefined;
    return sign === "-" ? "-" : "+";
  }

  // `import("module").A.B<T>`
  function importType(): TypeNode {
    const start = expect("import").start;
    expect("(");
    if (peek().kind !== "string") throw error("expected a module name");
    const module = next().text;
    expect(")");
    let name: string | undefined;
    while (eat(".")) {
      if (peek().kind !== "ident") throw error("expected an identifier");
      name = name === undefined ? next().text : `${name}.${next().text}`;
    }
    const args = eat("<") ? list(type, ">") : [];
    return { kind: "import", module, name, args, start, end: tokens[pos - 1]!.end };
  }

  function objectType(): TypeNode {
    const start = expect("{").start;
    const members = typeMembers();
    return { kind: "object", members, start, end: tokens[pos - 1]!.end };
  }

  // Members up to and including `}`, separated by `;`, `,` or a newline.
  function typeMembers(): TypeMember[] {
    const members: TypeMember[] = [];
    while (!eat("}")) {
      if (peek().kind === "eof") throw error("expected '}'");
      members.push(typeMember());
      if (!eat(";") && !eat(",") && !at("}") && !peek().newlineBefore) throw error("expected ';'");
    }
    return members;
  }

  // `readonly`, `get`, `set` and `new` are only keywords here when what follows can't be
  // read any other way, so `{ get: T; new: U }` declares ordinary properties.
  function typeMember(): TypeMember {
    const start = peek().start;
    const end = () => tokens[pos - 1]!.end;
    const startsName = (t: Token) => t.kind === "ident" || t.kind === "string" || t.kind === "int" || isToken(t, "[");
    if (at("(") || at("<")) return { kind: "call", ...signature(), start, end: end() };
    const after = tokens[pos + 1]!;
    if (at("new") && (isToken(after, "(") || isToken(after, "<"))) {
      next();
      return { kind: "construct", ...signature(), start, end: end() };
    }
    if ((at("get") || at("set")) && startsName(after)) {
      const kind = next().text as "get" | "set";
      const name = propertyName();
      const { params, returns } = signature();
      return { kind, name, params, returns, start, end: end() };
    }
    const readonly = at("readonly") && startsName(after) && eat("readonly");
    if (at("[") && tokens[pos + 1]!.kind === "ident" && isToken(tokens[pos + 2]!, ":")) {
      next();
      const params = [parameter()];
      expect("]");
      const type = annotation();
      return { kind: "index", readonly, params, type, start, end: end() };
    }
    const name = propertyName();
    const optional = eat("?");
    if (at("(") || at("<")) return { kind: "method", name, optional, ...signature(), start, end: end() };
    const type = at(":") ? annotation() : undefined;
    return { kind: "property", name, optional, readonly, type, start, end: end() };
  }

  // Property names may be reserved words, so any identifier is accepted.
  function propertyName(): PropertyName {
    const t = peek();
    if (eat("[")) {
      const key = expression();
      expect("]");
      return key;
    }
    if (t.kind !== "ident" && t.kind !== "string" && t.kind !== "int") throw error("expected a property name");
    return next().text;
  }

  // Type parameters, parameters and an optional return type, as in a method signature.
  function signature() {
    const typeParams = typeParameters();
    const params = parameters();
    const returns = returnAnnotation();
    return { typeParams, params, returns };
  }

  // Type names may be reserved words, as in `void`, so any identifier is accepted.
  function typeReference(): TypeNode {
    if (peek().kind !== "ident") throw error("expected a type");
    const first = next();
    let name = first.text;
    while (at(".")) {
      next();
      if (peek().kind !== "ident") throw error("expected an identifier");
      name += "." + next().text;
    }
    const args = eat("<") ? list(type, ">") : [];
    return { kind: "ref", name, args, start: first.start, end: tokens[pos - 1]!.end };
  }

  // Items up to and including `close`, separated by commas, with an optional trailing comma.
  function list<T>(item: () => T, close: string): T[] {
    const items: T[] = [];
    while (!at(close)) {
      items.push(item());
      if (!at(close)) expect(",");
    }
    next();
    return items;
  }

  function increment(target: Expr, op: Token, start: number): Stmt {
    const one: Expr = { kind: "int", value: 1n, start: op.start, end: op.end };
    const end = Math.max(target.end, op.end);
    return { kind: "assign", target, op: op.text === "++" ? "+" : "-", value: one, start, end };
  }

  // Automatic semicolon insertion: a `;`, a newline or a closing brace ends a statement.
  function endStatement() {
    if (at(";")) next();
    else if (!at("}") && !peek().newlineBefore && peek().kind !== "eof") throw error("expected ';'");
  }

  function expression(minPrecedence = 0): Expr {
    let left = unary();
    for (;;) {
      const op = binaryOperator();
      if (!op || PRECEDENCE[op] <= minPrecedence) return left;
      if (next().text !== op) next();
      const right = expression(PRECEDENCE[op]);
      left = { kind: "binary", op, left, right, start: left.start, end: right.end };
    }
  }

  // `>=` arrives as `>` then `=`, so that generics can later close on `>`; rejoin it here.
  // Migration rule A3 rewrites loose equality to strict, so native code never uses it.
  function binaryOperator(): BinaryOp | undefined {
    const t = peek();
    if (t.kind !== "punct") return undefined;
    if (t.text === "==" || t.text === "!=") throw new CompileError(`'${t.text}' is not supported; use '${t.text}='`, t.start, t.end);
    const after = tokens[pos + 1]!;
    const text = t.text === ">" && after.text === "=" && after.start === t.end ? ">=" : t.text;
    return isBinaryOp(text) ? text : undefined;
  }

  function unary(): Expr {
    if (!at("-") && !at("!")) return postfix();
    const op = next();
    const operand = unary();
    return { kind: "unary", op: op.text === "-" ? "-" : "!", operand, start: op.start, end: operand.end };
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
        if (t.text === "true" || t.text === "false") return { kind: "bool", value: t.text === "true", ...span };
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
