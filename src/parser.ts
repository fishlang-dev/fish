import { CompileError } from "./diag.ts";
import { expression, sequence } from "./expressions.ts";
import { isToken, lexer, type Comment, type Lexer, type Token } from "./lexer.ts";
import { atClass, atDeclarationKeyword, classDeclaration, decoratorList, exportDeclaration } from "./declarations.ts";
import { bindingPattern, toPattern } from "./patterns.ts";
import { annotation, parameters, returnAnnotation, throwsClause, type, typeMembers, typeParameters, typeReference } from "./types.ts";
import { nextId, type Id, type Ids } from "./ids.ts";

export type Span = { start: usize; end: usize };

// `id` is not part of `Span`, so spreading a span never copies one.
export type { Id };

export type TypeNode = Span & Id & (
  // Keyword types are refs too; `name` is dotted for qualified names, e.g. "A.B".
  | { kind: "ref"; name: string; args: TypeNode[] }
  // A string, number, bigint or bool literal, or `-` applied to a number or bigint.
  | { kind: "literal"; value: Expr }
  | { kind: "array"; element: TypeNode }
  | { kind: "tuple"; elements: TupleElement[] }
  | { kind: "object"; members: TypeMember[] }
  | { kind: "function"; typeParams: TypeParam[]; params: Param[]; returns: TypeNode; throws?: TypeNode; construct: boolean; abstract: boolean }
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

export type Expr = Span & Id & (
  // Every integer form, in any base.
  | { kind: "int"; value: bigint }
  // Has a fraction or an exponent.
  | { kind: "float"; value: f64 }
  | { kind: "bigint"; value: bigint }
  | { kind: "null" } | { kind: "this" } | { kind: "super" }
  | { kind: "regex"; pattern: string; flags: string }
  // Decoded text; `quasis` has one more entry than `exprs`, and `raw` holds each as written.
  | { kind: "template"; quasis: string[]; raw: string[]; exprs: Expr[] }
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
  | { kind: "arrow"; move: boolean; async: boolean; typeParams: TypeParam[]; params: Param[];
      returnType: TypeNode | undefined; throws?: TypeNode; body: Expr | Stmt[] }
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
  // `throw` as an expression, which never gives a value.
  | { kind: "throw"; value: Expr }
  | (ClassNode & { kind: "class" })
  // `#x` on its own, which is only valid as the left side of `in`.
  | { kind: "privateName"; name: string }
  | { kind: "unary"; op: UnaryOp; operand: Expr }
  | { kind: "update"; op: "++" | "--"; prefix: boolean; operand: Expr }
  | { kind: "binary"; op: BinaryOp; left: Expr; right: Expr }
  | { kind: "conditional"; cond: Expr; then: Expr; else: Expr }
  | { kind: "assign"; op: AssignOp; target: Expr; value: Expr }
  // `value |> body`, where `body` refers to `value` as `%`.
  | { kind: "pipe"; value: Expr; body: Expr }
  | { kind: "topic" }
  | { kind: "match"; subject: Expr; arms: MatchArm[] }
  // `comptime expr`: evaluated while compiling.
  | { kind: "comptime"; expr: Expr }
  | { kind: "unsafe"; expr: Expr }
  // `[a, b] = [b, a]`: an assignment whose left side is a pattern.
  | { kind: "destructure"; pattern: Pattern; value: Expr }
  // `a, b`; only where a full expression is allowed, never as an argument or element.
  | { kind: "sequence"; exprs: Expr[] }
  | { kind: "yield"; value: Expr | undefined; delegate: boolean }
  // `as const` is an `as` whose type is a ref named "const".
  | { kind: "as" | "satisfies"; expr: Expr; type: TypeNode }
  // `<T>x`
  | { kind: "assertion"; type: TypeNode; expr: Expr }
);

export type Stmt = Span & Id & (
  | { kind: "expr"; expr: Expr }
  | { kind: "let"; keyword: "let" | "const" | "var"; declarations: Declarator[] }
  | { kind: "return"; value: Expr | undefined }
  | { kind: "if"; cond: Expr; then: Stmt[]; else: Stmt[] | undefined }
  | { kind: "while"; cond: Expr; body: Stmt[] }
  | { kind: "doWhile"; body: Stmt[]; cond: Expr }
  | { kind: "switch"; discriminant: Expr; cases: SwitchCase[] }
  | { kind: "labeled"; label: string; body: Stmt }
  | { kind: "break" | "continue"; label: string | undefined }
  | { kind: "throw"; value: Expr }
  // At least one of `handler` and `finalizer` is present; `catch {}` has no `param`.
  | { kind: "try"; block: Stmt[]; param: Pattern | undefined; paramType: TypeNode | undefined;
      handler: Stmt[] | undefined; finalizer: Stmt[] | undefined }
  // `init` is a declaration or an expression.
  | { kind: "for"; init: Stmt | undefined; test: Expr | undefined; update: Expr | undefined; body: Stmt[] }
  // `left` is a declaration without an initializer, or an assignment target.
  | { kind: "forIn" | "forOf"; await: boolean; left: Stmt | Pattern; right: Expr; body: Stmt[] }
  | { kind: "block"; body: Stmt[] }
  | { kind: "empty" }
  | { kind: "debugger" }
  // `derives`: what `@derive` gave it, which `===` and `JSON` read.
  | { kind: "enum"; name: string; const: boolean; typeParams: TypeParam[]; members: EnumMember[]; decorators?: Expr[]; derives?: string[] }
  // `name` is dotted (`A.B`), or the module string in `declare module "m"`, where `quoted` is
  // set; `global` marks `declare global`. `body` is undefined for `declare module "m";`.
  | { kind: "namespace"; name: string; quoted: boolean; global: boolean; body: Stmt[] | undefined }
  | { kind: "declare"; body: Stmt }
  | { kind: "comptime"; body: Stmt[] }
  | { kind: "unsafe"; body: Stmt[] }
  // `named` is undefined without braces; `attributes` is the object after `with`.
  | { kind: "import"; typeOnly: boolean; defer: boolean; default: string | undefined; namespace: string | undefined;
      named: Specifier[] | undefined; module: string; attributes: Expr | undefined }
  // `import x = require("m")` sets `require`; `import x = A.B` sets `entity`.
  | { kind: "importEquals"; typeOnly: boolean; name: string; require: string | undefined; entity: string | undefined }
  // `export` before a declaration.
  | { kind: "export"; body: Stmt }
  // Exactly one is set: a function, class or interface declaration, or an expression. They
  // are kept apart because a function or class could otherwise be either.
  | { kind: "exportDefault"; declaration: Stmt | undefined; value: Expr | undefined }
  | { kind: "exportNamed"; typeOnly: boolean; specifiers: Specifier[]; module: string | undefined }
  | { kind: "exportAll"; typeOnly: boolean; alias: string | undefined; module: string }
  // `export = value`
  | { kind: "exportAssign"; value: Expr }
  | { kind: "exportAsNamespace"; name: string }
) | TypeAlias | Interface | Func | (ClassNode & { kind: "class" });

export type TupleElement = Span & Id & { name: string | undefined; optional: boolean; rest: boolean; type: TypeNode };

// A string name covers identifier, string and number keys; an Expr is a computed `[key]`.
export type PropertyName = string | Expr;

export type TypeMember = Span & Id & (
  | { kind: "property"; name: PropertyName; optional: boolean; readonly: boolean; type: TypeNode | undefined }
  | { kind: "method"; name: PropertyName; optional: boolean; typeParams: TypeParam[]; params: Param[]; returns: TypeNode | undefined }
  | { kind: "call" | "construct"; typeParams: TypeParam[]; params: Param[]; returns: TypeNode | undefined }
  | { kind: "index"; readonly: boolean; params: Param[]; type: TypeNode }
  | { kind: "get" | "set"; name: PropertyName; params: Param[]; returns: TypeNode | undefined }
);

export type ObjectProp = Span & Id & (
  | { kind: "property"; key: PropertyName; value: Expr }
  // A default, as in `{ a = 1 }`, is only valid once the literal turns out to be a pattern.
  | { kind: "shorthand"; name: string; default: Expr | undefined }
  | { kind: "spread"; value: Expr }
  | { kind: "method"; key: PropertyName; async: boolean; generator: boolean; typeParams: TypeParam[];
      params: Param[]; returnType: TypeNode | undefined; body: Stmt[] }
  | { kind: "get" | "set"; key: PropertyName; params: Param[]; returnType: TypeNode | undefined; body: Stmt[] }
);

export type Modifier =
  | "public" | "private" | "protected" | "static" | "readonly" | "abstract"
  | "override" | "declare" | "accessor" | "async";

const MODIFIERS: Modifier[] = ["public", "private", "protected", "static", "readonly", "abstract", "override", "declare", "accessor", "async"];

export function isModifier(text: string): boolean {
  return MODIFIERS.some((m) => m === text);
}

// The modifier `text` is, which the caller has seen is one.
export function modifierOf(text: string): Modifier {
  return MODIFIERS.find((m) => m === text)!;
}

// `get` or `set`, from a token the caller has seen is one.
export function accessorOf(text: string): "get" | "set" {
  return text === "get" ? "get" : "set";
}

export type ClassNode = Span & Id & {
  // Undefined for an anonymous class expression or `export default class`.
  name: string | undefined; abstract: boolean; decorators: Expr[]; typeParams: TypeParam[];
  // An instantiation expression when written with type arguments, as in `extends Base<T>`.
  extends: Expr | undefined; implements: TypeNode[]; members: ClassMember[];
  // What `@derive` gave it, which `JSON` reads.
  derives?: string[];
};

// A private name is a string starting with "#". A missing body is an overload signature.
export type ClassMember = Span & Id & { modifiers: Modifier[]; decorators: Expr[] } & (
  | { kind: "field"; name: PropertyName; optional: boolean; definite: boolean; type: TypeNode | undefined; init: Expr | undefined }
  | { kind: "method"; name: PropertyName; optional: boolean; generator: boolean; typeParams: TypeParam[];
      params: Param[]; returnType: TypeNode | undefined; throws?: TypeNode; body: Stmt[] | undefined }
  | { kind: "constructor"; params: Param[]; throws?: TypeNode; body: Stmt[] | undefined }
  | { kind: "get" | "set"; name: PropertyName; params: Param[]; returnType: TypeNode | undefined; throws?: TypeNode; body: Stmt[] | undefined }
  | { kind: "index"; params: Param[]; type: TypeNode }
  | { kind: "staticBlock"; body: Stmt[] }
);

// `this` is an identifier pattern named "this".
// `modifiers` make a constructor parameter a parameter property, as in `private readonly x`.
export type Param = Span & Id & {
  pattern: Pattern; type: TypeNode | undefined; optional: boolean; rest: boolean; default: Expr | undefined;
  modifiers: Modifier[]; decorators: Expr[]; comptime: boolean;
};

export type Pattern = Span & Id & (
  | { kind: "ident"; name: string }
  | { kind: "object"; props: PatternProp[]; rest: Pattern | undefined }
  // A hole, as in `[, b]`, is undefined.
  | { kind: "array"; elements: (Pattern | undefined)[]; rest: Pattern | undefined }
  // `target = value`: a default inside a pattern.
  | { kind: "default"; target: Pattern; value: Expr }
  // Only in assignment patterns: a target such as `obj.prop` or `list[0]`.
  | { kind: "expr"; expr: Expr }
  // The rest appear only in `match` patterns.
  | { kind: "wildcard" }
  // A string, number, bigint, boolean or null literal, or a negated number.
  | { kind: "literal"; value: Expr }
  // `Some(v)`, or a dotted name such as `ApiError.NotFound`; `args` is undefined without
  // parentheses. A bare name such as `None` stays an `ident`: binding or variant is the
  // checker's call.
  | { kind: "variant"; name: string; args: Pattern[] | undefined }
  // `P | Q`: either matches.
  | { kind: "or"; patterns: Pattern[] }
);

// `body` reads like an arrow function's: an expression, or a block's statements.
export type MatchArm = Span & Id & { pattern: Pattern; guard: Expr | undefined; body: Expr | Extract<Stmt, { kind: "block" }> };

// In `{ a }` the value is the identifier pattern `a`.
export type PatternProp = Span & Id & { key: PropertyName; value: Pattern };

// `name` may be a string, as in `import { "a-b" as ab }`.
export type Specifier = Span & Id & { name: string; alias: string | undefined; typeOnly: boolean };

export type EnumMember = Span & Id & { name: string; init: Expr | undefined; payload: TypeNode[] | undefined };

// `default:` has no test.
export type SwitchCase = Span & Id & { test: Expr | undefined; body: Stmt[] };

export type Declarator = Span & Id & { target: Pattern; type: TypeNode | undefined; init: Expr | undefined };

export type TypeParam = Span & Id & { name: string; constraint: TypeNode | undefined; default: TypeNode | undefined; modifiers: ("const" | "in" | "out")[] };

// `decorators`, on these and on functions, are the macros applied to them.
// A package's type, declared in its `.d.ts`, sets `js`: an object type alias is then a JS handle.
export type TypeAlias = Span & Id & { kind: "typeAlias"; name: string; typeParams: TypeParam[]; type: TypeNode; decorators?: Expr[]; js?: JsName };

// A package's interface or class, from its `.d.ts`, sets `js`, its values JS handles; a class
// also has `jsClass`, its constructors' parameters and its statics.
export type Interface = Span & Id & { kind: "interface"; name: string; typeParams: TypeParam[]; extends: TypeNode[]; members: TypeMember[]; decorators?: Expr[];
  js?: JsName; jsClass?: { constructors: Param[][]; statics: TypeMember[] };
  // The declaration a package's interface was copied from, which every copy of it is typed by.
  jsSource?: Stmt };

// What a package's declaration names: the package and the name it exports it by. A const is
// read as a value.
// `package` is the specifier's index among the program's, naming it in the bundle.
export type JsName = { module: string; package: usize; name: string; const?: true;
  // A function declared with several signatures: its other signatures, in the order declared.
  overloads?: Func[] };

export type Func = Span & Id & {
  // `macro` marks `macro function`, a comptime function over syntax trees.
  kind: "function"; name: string; async: boolean; generator: boolean; macro: boolean;
  // Undefined for an overload signature or a `declare function`. `throws` is the error type.
  typeParams: TypeParam[]; params: Param[]; returnType: TypeNode | undefined; throws?: TypeNode; body: Stmt[] | undefined;
  decorators?: Expr[];
  // A package's function, or a const read as one, declared in its `.d.ts`.
  js?: JsName;
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


// Whether `name` is reserved in strict-mode JavaScript, so never usable as a name. A switch, as a
// `Set` built at the top level can't be in Fish.
export function isReserved(name: string): boolean {
  switch (name) {
    case "break": case "case": case "catch": case "class": case "const": case "continue": case "debugger": case "default": case "delete":
    case "do": case "else": case "enum": case "export": case "extends": case "false": case "finally": case "for": case "function": case "if":
    case "import": case "in": case "instanceof": case "let": case "new": case "null": case "return": case "static": case "super": case "switch":
    case "this": case "throw": case "true": case "try": case "typeof": case "var": case "void": case "while": case "with": case "yield":
      return true;
  }
  return false;
}

// A grammar function, as the cursor's helpers take one.
/** @throws {CompileError} */
export type Parse<T> = (c: Mut<Cursor>) => T;

// How a token is named in an error.
function describe(t: Ref<Token>): string {
  if (t.kind === "eof") return "end of file";
  if (t.kind === "string") return "a string literal";
  return t.kind.startsWith("template") ? "a template literal" : `'${t.text}'`;
}

// The parser's position in the token stream, shared by the grammar modules.
export class Cursor {
  lex: Lexer;
  // Every token lexed so far, in source order: once a whole program is parsed, all its tokens,
  // each `/` read as the parser decided. Lookahead and backtracking move `pos` within it.
  tokens: Token[];
  pos: usize;
  // False only directly inside a conditional type's `extends` clause, as in TypeScript.
  conditionalAllowed: boolean;
  // False only directly inside a `for` initializer, so `for (x in y)` isn't read as an
  // expression; any bracket, list or block allows `in` again, as in TypeScript.
  inAllowed: boolean;
  // Set while parsing the right side of `|>`, with whether it used the topic `%` so far.
  inPipe: boolean;
  topicUsed: boolean;
  src: string;
  // Whether JSDoc `@throws` tags declare what a function throws: when compiling, not when
  // formatting or linting, which keep the comment as written.
  docs: boolean;
  // Where each node's id comes from: a copy of the caller's counter, given back when parsing ends.
  ids: Ids;

  constructor(src: string, ids: Ids, from: usize, docs: boolean) {
    this.lex = lexer(src, from);
    this.tokens = [];
    this.pos = 0;
    this.conditionalAllowed = true;
    this.inAllowed = true;
    this.inPipe = false;
    this.topicUsed = false;
    this.src = src;
    this.docs = docs;
    this.ids = ids;
  }

  // The token `offset` places ahead of the current one. Never look past a `/` where an
  // expression starts: it may begin a regex, and lexing its body as tokens can fail.
  /** @throws {CompileError} */
  peek(this: Mut<this>, offset: usize = 0): Ref<Token> {
    while (this.tokens.length <= this.pos + offset && (this.tokens.length === 0 || this.tokens[this.tokens.length - 1]!.kind !== "eof")) this.tokens.push(this.lex.next());
    return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)]!;
  }

  // A copy of the token `offset` places ahead, to keep while the cursor moves on.
  /** @throws {CompileError} */
  token(this: Mut<this>, offset: usize = 0): Token {
    return { ...this.peek(offset) };
  }

  /** @throws {CompileError} */
  next(this: Mut<this>): Token {
    const t = this.token();
    this.pos++;
    return t;
  }

  /** @throws {CompileError} */
  at(this: Mut<this>, text: string): boolean {
    return isToken(this.peek(), text);
  }

  // Whether the token is any of `texts`.
  /** @throws {CompileError} */
  atAny(this: Mut<this>, texts: string[]): boolean {
    const t = this.peek();
    return texts.some((text) => isToken(t, text));
  }

  // Consumes the token when it is `text`.
  /** @throws {CompileError} */
  eat(this: Mut<this>, text: string): boolean {
    if (!this.at(text)) return false;
    this.next();
    return true;
  }

  /** @throws {CompileError} */
  expect(this: Mut<this>, text: string): Token {
    if (!this.at(text)) throw this.error(`expected '${text}'`);
    return this.next();
  }

  // A name that isn't a reserved word.
  /** @throws {CompileError} */
  ident(this: Mut<this>): Token {
    if (this.peek().kind !== "ident") throw this.error("expected an identifier");
    if (isReserved(this.peek().text)) throw this.error("expected a name");
    return this.next();
  }

  /** @throws {CompileError} */
  error(this: Mut<this>, message: string, t: Token | undefined = undefined): CompileError {
    const at = t === undefined ? this.token() : t!;
    return new CompileError(`${message}, found ${describe(at)}`, at.start, at.end);
  }

  // Items up to and including `close`, separated by commas, with an optional trailing comma.
  /** @throws {CompileError} */
  list<T>(this: Mut<this>, item: Parse<T>, close: string): T[] {
    return allowingIn(this, true, (c) => {
      let items: T[] = [];
      while (!c.at(close)) {
        items.push(item(c));
        if (!c.at(close)) c.expect(",");
      }
      c.next();
      return items;
    });
  }

  // Where the last consumed token ended.
  end(): usize {
    return this.tokens[this.pos - 1]!.end;
  }

  // Runs `parse`; if it throws a CompileError, puts the cursor back and returns undefined. Any
  // other error goes on, which only the Bun build can meet: in Fish `parse` throws nothing else.
  /** @throws {CompileError} */
  attempt<T>(this: Mut<this>, parse: Parse<T>): T | undefined {
    const pos = this.pos;
    const conditionalAllowed = this.conditionalAllowed;
    const inAllowed = this.inAllowed;
    const inPipe = this.inPipe;
    const topicUsed = this.topicUsed;
    try {
      return parse(this);
    } catch (e) {
      if (!(e instanceof CompileError)) throw e;
      this.pos = pos;
      this.conditionalAllowed = conditionalAllowed;
      this.inAllowed = inAllowed;
      this.inPipe = inPipe;
      this.topicUsed = topicUsed;
      return undefined;
    }
  }

  // Takes the `/` or `/=` at the cursor as the start of a regular expression instead.
  /** @throws {CompileError} */
  regex(this: Mut<this>): Token {
    const slash = this.token();
    while (this.tokens.length > this.pos) this.tokens.pop();
    this.tokens.push(this.lex.regex(slash));
    return this.next();
  }
}

function cursor(src: string, ids: Ref<Ids>, from: usize = 0, docs = false): Cursor {
  return new Cursor(src, { last: ids.last }, from, docs);
}

// Parses with the `in` operator allowed or not, restoring the outer setting after.
/** @throws {CompileError} */
export function allowingIn<T>(c: Mut<Cursor>, allowed: boolean, parse: Parse<T>): T {
  const outer = c.inAllowed;
  c.inAllowed = allowed;
  const result = parse(c);
  c.inAllowed = outer;
  return result;
}

// A program is a list of statements; which of them may appear at the top level is the
// checker's call. Its nodes' ids come from `ids`.
/** @throws {CompileError} */
export function parse(src: string, ids: Mut<Ids>): Stmt[] {
  return parseWithComments(src, ids, true).program;
}

// The program, and the comments the lexer kept, for the formatter, and its tokens.
/** @throws {CompileError} */
export function parseWithComments(src: string, ids: Mut<Ids>, docs = false): { program: Stmt[]; comments: Comment[]; tokens: Token[] } {
  let c = cursor(src, ids, 0, docs);
  try {
    let program: Stmt[] = [];
    while (c.peek().kind !== "eof") program.push(statement(c));
    return { program, comments: c.lex.comments, tokens: c.tokens };
  } finally {
    ids.last = c.ids.last;
  }
}

// One expression filling the whole text, as a quote's is.
/** @throws {CompileError} */
export function parseExpression(src: string, ids: Mut<Ids>): Expr {
  let c = cursor(src, ids);
  try {
    const e = expression(c);
    if (c.peek().kind !== "eof") throw c.error("expected the end of the expression");
    return e;
  } finally {
    ids.last = c.ids.last;
  }
}

// One type filling the whole text.
/** @throws {CompileError} */
export function parseType(src: string, ids: Mut<Ids>): TypeNode {
  let c = cursor(src, ids);
  try {
    const t = type(c);
    if (c.peek().kind !== "eof") throw c.error("expected the end of the type");
    return t;
  } finally {
    ids.last = c.ids.last;
  }
}

// Words a declaration may start with before its keyword, all of which its JSDoc comes before.
const LEADING = ["export", "default", "declare", "macro"];

// Whether the token at `i` is a word starting the declaration after it, rather than a property
// name as in `a.default`.
/** @throws {CompileError} */
function leading(c: Mut<Cursor>, i: usize): boolean {
  const t: Ref<Token> = c.tokens[i]!;
  const member = i > 0 && (isToken(c.tokens[i - 1]!, ".") || isToken(c.tokens[i - 1]!, "?."));
  return t.kind === "ident" && LEADING.includes(t.text) && !member;
}

// Adds the members of a union, nested ones included, to `into`, as a written `A | B | C` has them.
function addMembers(t: TypeNode, into: Mut<TypeNode[]>): void {
  if (t.kind !== "union") {
    into.push(t);
    return;
  }
  let types = t.types;
  types.reverse();
  while (types.length > 0) addMembers(types.pop()!, into);
}

// The `throws` type a declaration's JSDoc gives it: the types its `@throws {E}` tags name, as a
// union when there are several, when it has no `throws` clause written; the written clause
// stands otherwise, and must agree. `at` is where the declaration starts, and its JSDoc is the
// `/** ... */` comments between it and the token before.
/** @throws {CompileError} */
export function documentedThrows(c: Mut<Cursor>, at: usize, written: Ref<TypeNode | undefined>): TypeNode | undefined {
  if (!c.docs) return undefined;
  let i = c.pos - 1;
  while (i > 0 && c.tokens[i]!.start > at) i--;
  while (i > 0 && leading(c, i - 1)) i--;
  const from = i > 0 ? c.tokens[i - 1]!.end : 0;
  const to = c.tokens[i]!.start;
  const src = c.src;
  let jsdoc: Comment[] = [];
  for (let k = c.lex.comments.length; k > 0 && c.lex.comments[k - 1]!.end > from; k--) {
    const m: Ref<Comment> = c.lex.comments[k - 1]!;
    if (m.end <= to && /^\/\*\*[^/]/.test(m.text)) jsdoc.unshift({ ...m });
  }
  let types: TypeNode[] = [];
  for (const m of jsdoc) thrownTypes(src, c.ids, m, types);
  if (types.length === 0) return undefined;
  let shown = "";
  for (const t of types) shown += (shown === "" ? "" : " | ") + src.slice(t.start as i64, t.end as i64);
  const [start, end] = [types[0]!.start, types[types.length - 1]!.end];
  let doc: TypeNode;
  if (types.length === 1) doc = types.pop()!;
  else {
    let flat: TypeNode[] = [];
    types.reverse();
    while (types.length > 0) addMembers(types.pop()!, flat);
    doc = { id: nextId(c.ids), kind: "union", types: flat, start, end };
  }
  if (written === undefined) return doc;
  if (shape(src, doc) !== shape(src, written!)) {
    throw new CompileError(`the JSDoc says '@throws {${shown}}' but the function says 'throws ${src.slice(written!.start as i64, written!.end as i64)}'; make them the same type, or keep one`, doc.start, doc.end);
  }
  return undefined;
}

// `e`, an arrow given the `throws` type its declaration's JSDoc names, as `documentedThrows`
// reads it; any other expression as it is.
/** @throws {CompileError} */
export function documentedArrow(c: Mut<Cursor>, at: usize, e: Expr): Expr {
  let arrow = e;
  if (arrow.kind === "arrow") {
    const doc = documentedThrows(c, at, arrow.throws);
    if (doc !== undefined) arrow.throws = doc;
  }
  return arrow;
}

// What a type says, as text, its ids and spans left out, so two types read the same exactly when
// they are the same type. A union is its members as a set, so neither their order nor a repeat
// makes a difference. Expressions and patterns inside a type are their tokens as written.
/** @throws {CompileError} */
function shape(src: string, t: Ref<TypeNode>): string {
  switch (t.kind) {
    case "ref": return `ref ${t.name}<${shapes(src, t.args)}>`;
    case "literal": return `literal ${exprShape(src, t.value)}`;
    case "array": return `array ${shape(src, t.element)}`;
    case "tuple": {
      let out = "tuple [";
      for (const e of t.elements) out += `${orEmpty(e.name)} ${e.optional} ${e.rest} ${shape(src, e.type)}, `;
      return out + "]";
    }
    case "object": {
      let out = "object {";
      for (const m of t.members) out += memberShape(src, m) + "; ";
      return out + "}";
    }
    case "function":
      return `function ${t.construct} ${t.abstract} <${typeParamShapes(src, t.typeParams)}>(${paramShapes(src, t.params)}) ${shape(src, t.returns)} throws ${optionalShape(src, t.throws)}`;
    case "union": {
      let flat: string[] = [];
      unionShapes(src, t, flat);
      let unique = [...new Set(flat)];
      unique.sort();
      return `union ${unique.join(" | ")}`;
    }
    case "intersection": return `intersection ${shapes(src, t.types)}`;
    case "operator": return `operator ${t.op} ${shape(src, t.type)}`;
    case "indexed": return `indexed ${shape(src, t.object)}[${shape(src, t.index)}]`;
    case "query": return `query ${shape(src, t.target)}`;
    case "import": return `import ${JSON.stringify(t.module)} ${orEmpty(t.name)}<${shapes(src, t.args)}>`;
    case "conditional": return `conditional ${shape(src, t.check)} extends ${shape(src, t.extends)} ? ${shape(src, t.then)} : ${shape(src, t.else)}`;
    case "infer": return `infer ${t.name} ${optionalShape(src, t.constraint)}`;
    case "template": return `template ${JSON.stringify(t.quasis)} ${shapes(src, t.types)}`;
    case "mapped":
      return `mapped ${t.name} ${shape(src, t.constraint)} ${optionalShape(src, t.as)} ${optionalShape(src, t.type)} ${orEmpty(t.readonly)} ${orEmpty(t.optional)}`;
    case "predicate": return `predicate ${t.asserts} ${t.name} ${optionalShape(src, t.type)}`;
  }
  // Every kind returns above; Fish doesn't count a switch over all of them as returning yet.
  return "";
}

function orEmpty(s: string | undefined): string {
  return s === undefined ? "" : s;
}

// The shapes of a union's members, nested unions' included, added to `into`.
/** @throws {CompileError} */
function unionShapes(src: string, t: Ref<TypeNode>, into: Mut<string[]>): void {
  if (t.kind !== "union") {
    into.push(shape(src, t));
    return;
  }
  for (const m of t.types) unionShapes(src, m, into);
}

/** @throws {CompileError} */
function shapes(src: string, types: Ref<TypeNode[]>): string {
  let out = "";
  for (const t of types) out += shape(src, t) + ", ";
  return out;
}

/** @throws {CompileError} */
function optionalShape(src: string, t: Ref<TypeNode | undefined>): string {
  return t === undefined ? "" : shape(src, t!);
}

/** @throws {CompileError} */
function typeParamShapes(src: string, params: Ref<TypeParam[]>): string {
  let out = "";
  for (const p of params) out += `${p.modifiers.join(" ")} ${p.name} ${optionalShape(src, p.constraint)} ${optionalShape(src, p.default)}, `;
  return out;
}

/** @throws {CompileError} */
function paramShapes(src: string, params: Ref<Param[]>): string {
  let out = "";
  for (const p of params) {
    let decorators = "";
    for (const d of p.decorators) decorators += exprShape(src, d) + " ";
    const fallback = p.default === undefined ? "" : exprShape(src, p.default!);
    out += `${decorators}${p.modifiers.join(" ")} ${p.comptime} ${p.rest} ${tokenShape(src, p.pattern.start, p.pattern.end)} ${p.optional} ${optionalShape(src, p.type)} ${fallback}, `;
  }
  return out;
}

/** @throws {CompileError} */
function nameShape(src: string, name: Ref<PropertyName>): string {
  return typeof name === "string" ? JSON.stringify(name) : `[${exprShape(src, name)}]`;
}

/** @throws {CompileError} */
function memberShape(src: string, m: Ref<TypeMember>): string {
  switch (m.kind) {
    case "property": return `property ${nameShape(src, m.name)} ${m.optional} ${m.readonly} ${optionalShape(src, m.type)}`;
    case "method":
      return `method ${nameShape(src, m.name)} ${m.optional} <${typeParamShapes(src, m.typeParams)}>(${paramShapes(src, m.params)}) ${optionalShape(src, m.returns)}`;
    case "call":
    case "construct":
      return `${m.kind} <${typeParamShapes(src, m.typeParams)}>(${paramShapes(src, m.params)}) ${optionalShape(src, m.returns)}`;
    case "index": return `index ${m.readonly} (${paramShapes(src, m.params)}) ${shape(src, m.type)}`;
    case "get":
    case "set":
      return `${m.kind} ${nameShape(src, m.name)} (${paramShapes(src, m.params)}) ${optionalShape(src, m.returns)}`;
  }
  return "";
}

// A literal's value, or else an expression's tokens.
/** @throws {CompileError} */
function exprShape(src: string, e: Ref<Expr>): string {
  switch (e.kind) {
    case "int": return `int ${e.value}`;
    case "bigint": return `bigint ${e.value}`;
    case "float": return `float ${e.value}`;
    case "string": return `string ${JSON.stringify(e.value)}`;
    case "bool": return `bool ${e.value}`;
    case "unary": return `unary ${e.op} ${exprShape(src, e.operand)}`;
  }
  return tokenShape(src, e.start, e.end);
}

// The tokens from `start` to `end` of `src`, whitespace and comments left out.
/** @throws {CompileError} */
function tokenShape(src: string, start: usize, end: usize): string {
  let lex = lexer(src, start);
  let out = "";
  for (let t = lex.next(); t.kind !== "eof" && t.start < end; t = lex.next()) out += `${t.kind} ${JSON.stringify(t.text)} `;
  return out;
}

// The types of a JSDoc comment's `@throws` tags. As in TypeScript, only `@throws {E} why` names a
// type: `@throws INVALID_PARAM` only describes, and so does a tag whose type doesn't parse, such
// as `{@link E}` or `{?E}`, so any TypeScript file still parses. They're added to `types`.
/** @throws {CompileError} */
function thrownTypes(src: string, ids: Mut<Ids>, m: Ref<Comment>, types: Mut<TypeNode[]>): void {
  const close = m.end - 2;
  for (const tag of m.text.matchAll(/(?<![^\s*])@throws(?![\p{ID_Continue}$])[ \t]*/gu)) {
    const start = m.start + (tag.index as usize) + tag[0]!.length;
    if (src.charAt(start as i64) === "{") {
      let end = start;
      for (let depth = 0; end < close; end++) {
        const ch = src.charAt(end as i64);
        if (ch === "{") depth++;
        else if (ch === "}") {
          depth--;
          if (depth === 0) break;
        }
      }
      const t = end < close ? typeAt(src, ids, start + 1, end) : undefined;
      if (t !== undefined) types.push(t!);
    }
  }
}

// The type written from `start` to `end` of `src`, its spans offsets into the whole text, or
// undefined when that text isn't one type.
/** @throws {CompileError} */
function typeAt(src: string, ids: Mut<Ids>, start: usize, end: usize): TypeNode | undefined {
  let c = cursor(src.slice(0, end as i64), ids, start);
  const t = c.attempt((c) => {
    const t = type(c);
    if (c.peek().kind !== "eof") throw c.error("expected the end of the type");
    return t;
  });
  ids.last = c.ids.last;
  return t;
}

// A function, type alias, interface or enum after decorators, which Fish applies as macros
// where TypeScript allows only classes.
/** @throws {CompileError} */
export function decorated(c: Mut<Cursor>, start: usize, decorators: Expr[]): Stmt {
  const next = c.token(1);
  const at = c.at("function") || (c.at("async") && isToken(next, "function") && !next.newlineBefore) || (c.at("type") && next.kind === "ident")
    || c.at("interface") || c.at("enum") || (c.at("const") && isToken(next, "enum"));
  if (!at) throw c.error("expected a class, function, type, interface or enum after decorators");
  let s = statement(c);
  const id = nextId(c.ids);
  // Each kind is written to on its own, which Fish needs to write a field of a union.
  if (s.kind === "function") {
    s.id = id;
    s.start = start;
    s.decorators = decorators;
  } else if (s.kind === "typeAlias") {
    s.id = id;
    s.start = start;
    s.decorators = decorators;
  } else if (s.kind === "interface") {
    s.id = id;
    s.start = start;
    s.decorators = decorators;
  } else if (s.kind === "enum") {
    s.id = id;
    s.start = start;
    s.decorators = decorators;
  }
  return s;
}

// Only `export default function` may leave out the name, so `name` is "" there.
/** @throws {CompileError} */
export function func(c: Mut<Cursor>, anonymous = false): Func {
  const start = c.peek().start;
  const async = c.eat("async");
  c.expect("function");
  const generator = c.eat("*");
  const name = anonymous && (c.at("(") || c.at("<")) ? "" : c.ident().text;
  const typeParams = typeParameters(c);
  const params = parameters(c);
  const returnType = returnAnnotation(c);
  const written = throwsClause(c);
  const doc = documentedThrows(c, start, written);
  const throws = written ?? doc;
  // An overload signature or a `declare function` ends where its body would start.
  let body: Stmt[] | undefined = undefined;
  if (c.at("{")) body = block(c);
  else endStatement(c);
  let f: Func = { id: nextId(c.ids), kind: "function", name, async, generator, macro: false, typeParams, params, returnType, body, start, end: c.end() };
  if (throws !== undefined) f.throws = throws;
  return f;
}

/** @throws {CompileError} */
export function block(c: Mut<Cursor>): Stmt[] {
  c.expect("{");
  return allowingIn(c, true, (c) => {
    let stmts: Stmt[] = [];
    while (!c.eat("}")) {
      if (c.peek().kind === "eof") throw c.error("expected '}'");
      stmts.push(statement(c));
    }
    return stmts;
  });
}

// A braced block, or a single statement as in `if (x) return 1`.
/** @throws {CompileError} */
function body(c: Mut<Cursor>): Stmt[] {
  return c.at("{") ? block(c) : [statement(c)];
}

// Statements that end in a block need nothing after them; the rest end as in JavaScript.
/** @throws {CompileError} */
export function statement(c: Mut<Cursor>): Stmt {
  const start = c.peek().start;
  if (c.at("function") || (c.at("async") && isToken(c.peek(1), "function") && !c.peek(1).newlineBefore)) return func(c);
  if (c.at("{")) return { id: nextId(c.ids), kind: "block", body: block(c), start, end: c.end() };
  // Both are contextual: in TypeScript `comptime {` and `macro function` are syntax errors.
  if (c.at("comptime") && isToken(c.peek(1), "{") && !c.peek(1).newlineBefore) {
    c.next();
    return { id: nextId(c.ids), kind: "comptime", body: block(c), start, end: c.end() };
  }
  if (c.at("unsafe") && isToken(c.peek(1), "{") && !c.peek(1).newlineBefore) {
    c.next();
    return { id: nextId(c.ids), kind: "unsafe", body: block(c), start, end: c.end() };
  }
  if (c.at("macro") && isToken(c.peek(1), "function") && !c.peek(1).newlineBefore) {
    c.next();
    return { ...func(c), id: nextId(c.ids), macro: true, start };
  }
  const decorators = decoratorList(c);
  if (atClass(c)) return classDeclaration(c, start, decorators);
  if (c.at("export")) return exportDeclaration(c, start, decorators);
  if (decorators.length > 0) return decorated(c, start, decorators);
  const declaration = atDeclarationKeyword(c);
  if (declaration !== undefined) return declaration!;
  if (c.at(";")) return { id: nextId(c.ids), kind: "empty", start, end: c.next().end };
  if (c.at("if")) return ifStatement(c);
  if (c.at("while")) return whileStatement(c);
  if (c.at("for")) return forStatement(c);
  if (c.at("switch")) return switchStatement(c);
  if (c.at("try")) return tryStatement(c);
  if (c.peek().kind === "ident" && !isReserved(c.peek().text) && isToken(c.peek(1), ":")) {
    const label = c.next().text;
    c.next();
    const labeled = statement(c);
    const labeledEnd: usize = labeled.end;
    return { id: nextId(c.ids), kind: "labeled", label, body: labeled, start, end: labeledEnd };
  }
  if (c.at("do")) return doWhileStatement(c);
  if (c.at("interface")) return interfaceDeclaration(c);
  let s: Stmt;
  if (c.at("debugger")) s = { id: nextId(c.ids), kind: "debugger", start, end: c.next().end };
  else if (atTypeAlias(c)) s = typeAlias(c);
  else s = simpleStatement(c);
  endStatement(c);
  return s;
}

/** @throws {CompileError} */
function ifStatement(c: Mut<Cursor>): Stmt {
  const start = c.next().start;
  c.expect("(");
  const cond = sequence(c);
  c.expect(")");
  const then = body(c);
  const otherwise = c.eat("else") ? body(c) : undefined;
  return { id: nextId(c.ids), kind: "if", cond, then, else: otherwise, start, end: c.end() };
}

/** @throws {CompileError} */
function whileStatement(c: Mut<Cursor>): Stmt {
  const start = c.next().start;
  c.expect("(");
  const cond = sequence(c);
  c.expect(")");
  const loop = body(c);
  return { id: nextId(c.ids), kind: "while", cond, body: loop, start, end: c.end() };
}

// `for (init; test; update)`, `for (left in right)`, `for (left of right)` and `for await`.
/** @throws {CompileError} */
function forStatement(c: Mut<Cursor>): Stmt {
  const start = c.expect("for").start;
  const isAwait = c.eat("await");
  c.expect("(");
  const declared = atDeclaration(c) ? allowingIn(c, false, (c) => declaration(c)) : undefined;
  const expr = declared !== undefined || c.at(";") ? undefined : allowingIn(c, false, (c) => sequence(c));
  if ((declared !== undefined || expr !== undefined) && (c.at("in") || c.at("of"))) {
    const kind: "forIn" | "forOf" = c.next().text === "in" ? "forIn" : "forOf";
    let left: Stmt | Pattern;
    if (declared !== undefined) left = declared!;
    else left = toPattern(c, expr!);
    // `for...in` takes any expression; `for...of` one without a top-level comma.
    const right = kind === "forIn" ? sequence(c) : expression(c);
    c.expect(")");
    return { id: nextId(c.ids), kind, await: isAwait, left, right, body: body(c), start, end: c.end() };
  }
  c.expect(";");
  const test = c.at(";") ? undefined : sequence(c);
  c.expect(";");
  const update = c.at(")") ? undefined : sequence(c);
  c.expect(")");
  let initStmt: Stmt | undefined = declared;
  if (expr !== undefined) {
    const [exprStart, exprEnd] = [expr!.start, expr!.end];
    initStmt = { id: nextId(c.ids), kind: "expr", expr: expr!, start: exprStart, end: exprEnd };
  }
  return { id: nextId(c.ids), kind: "for", init: initStmt, test, update, body: body(c), start, end: c.end() };
}

/** @throws {CompileError} */
function switchStatement(c: Mut<Cursor>): Stmt {
  const start = c.expect("switch").start;
  c.expect("(");
  const discriminant = sequence(c);
  c.expect(")");
  c.expect("{");
  let cases: SwitchCase[] = [];
  while (!c.eat("}")) {
    const caseStart = c.peek().start;
    let test: Expr | undefined = undefined;
    if (c.eat("case")) test = sequence(c);
    else if (!c.eat("default")) throw c.error("expected 'case' or 'default'");
    c.expect(":");
    let body: Stmt[] = [];
    while (!c.at("case") && !c.at("default") && !c.at("}")) {
      if (c.peek().kind === "eof") throw c.error("expected '}'");
      body.push(statement(c));
    }
    cases.push({ id: nextId(c.ids), test, body, start: caseStart, end: c.end() });
  }
  return { id: nextId(c.ids), kind: "switch", discriminant, cases, start, end: c.end() };
}

/** @throws {CompileError} */
function tryStatement(c: Mut<Cursor>): Stmt {
  const start = c.expect("try").start;
  const tried = block(c);
  let param: Pattern | undefined = undefined;
  let paramType: TypeNode | undefined = undefined;
  let handler: Stmt[] | undefined = undefined;
  if (c.eat("catch")) {
    // The binding is optional: `catch {}` ignores the error.
    if (c.eat("(")) {
      param = bindingPattern(c);
      paramType = c.at(":") ? annotation(c) : undefined;
      c.expect(")");
    }
    handler = block(c);
  }
  const finalizer = c.eat("finally") ? block(c) : undefined;
  if (handler === undefined && finalizer === undefined) throw c.error("expected 'catch' or 'finally'");
  return { id: nextId(c.ids), kind: "try", block: tried, param, paramType, handler, finalizer, start, end: c.end() };
}

// The `;` after `do...while (x)` is optional even on the same line, unlike other statements.
/** @throws {CompileError} */
function doWhileStatement(c: Mut<Cursor>): Stmt {
  const start = c.expect("do").start;
  const loop = body(c);
  c.expect("while");
  c.expect("(");
  const cond = sequence(c);
  c.expect(")");
  c.eat(";");
  return { id: nextId(c.ids), kind: "doWhile", body: loop, cond, start, end: c.end() };
}

/** @throws {CompileError} */
function atDeclaration(c: Mut<Cursor>): boolean {
  return c.at("let") || c.at("const") || c.at("var");
}

/** @throws {CompileError} */
function declaration(c: Mut<Cursor>): Stmt {
  const start = c.peek().start;
  const word = c.next().text;
  const keyword: "let" | "const" | "var" = word === "let" ? "let" : word === "const" ? "const" : "var";
  let declarations: Declarator[] = [];
  do declarations.push(declarator(c));
  while (c.eat(","));
  // As in TypeScript, a statement's JSDoc belongs to its only declarator, here an arrow's.
  if (declarations.length === 1) {
    let only = declarations.pop()!;
    if (only.init !== undefined) only.init = documentedArrow(c, start, only.init!);
    declarations.push(only);
  }
  return { id: nextId(c.ids), kind: "let", keyword, declarations, start, end: c.end() };
}

/** @throws {CompileError} */
function simpleStatement(c: Mut<Cursor>): Stmt {
  const start = c.peek().start;
  if (atDeclaration(c)) return declaration(c);
  if (c.at("break") || c.at("continue")) {
    const kind: "break" | "continue" = c.next().text === "break" ? "break" : "continue";
    // A label must be on the same line, as with `return`'s value.
    const label = c.peek().kind === "ident" && !c.peek().newlineBefore && !isReserved(c.peek().text) ? c.next().text : undefined;
    return { id: nextId(c.ids), kind, label, start, end: c.end() };
  }
  if (c.at("throw")) {
    c.next();
    if (c.peek().newlineBefore) throw new CompileError("a line break is not allowed after 'throw'", start, c.peek().start);
    const value = sequence(c);
    const valueEnd: usize = value.end;
    return { id: nextId(c.ids), kind: "throw", value, start, end: valueEnd };
  }
  if (c.at("return")) {
    const end = c.next().end;
    // A newline after `return` ends the statement, as in JavaScript.
    if (c.at(";") || c.at("}") || c.peek().newlineBefore || c.peek().kind === "eof") return { id: nextId(c.ids), kind: "return", value: undefined, start, end };
    const value = sequence(c);
    const valueEnd: usize = value.end;
    return { id: nextId(c.ids), kind: "return", value, start, end: valueEnd };
  }
  const expr = sequence(c);
  const exprEnd: usize = expr.end;
  return { id: nextId(c.ids), kind: "expr", expr, start, end: exprEnd };
}

/** @throws {CompileError} */
function declarator(c: Mut<Cursor>): Declarator {
  const start = c.peek().start;
  const target = bindingPattern(c);
  const type = c.at(":") ? annotation(c) : undefined;
  const init = c.eat("=") ? expression(c) : undefined;
  return { id: nextId(c.ids), target, type, init, start, end: c.end() };
}

// `type` is contextual: only a name following on the same line makes it a declaration.
/** @throws {CompileError} */
function atTypeAlias(c: Mut<Cursor>) {
  const after = c.token(1);
  return c.at("type") && after.kind === "ident" && !after.newlineBefore;
}

/** @throws {CompileError} */
function typeAlias(c: Mut<Cursor>): TypeAlias {
  const start = c.next().start;
  const name = c.ident().text;
  const typeParams = typeParameters(c);
  c.expect("=");
  let t = type(c);
  // A function type's alias takes its JSDoc `@throws` tags as that type's clause, in the place a
  // written clause has; any other alias has no clause for them to give.
  if (t.kind === "function") {
    const doc = documentedThrows(c, start, t.throws);
    if (doc !== undefined) t.throws = doc;
  }
  const tEnd: usize = t.end;
  return { id: nextId(c.ids), kind: "typeAlias", name, typeParams, type: t, start, end: tEnd };
}

/** @throws {CompileError} */
function interfaceDeclaration(c: Mut<Cursor>): Interface {
  const start = c.next().start;
  const name = c.ident().text;
  const typeParams = typeParameters(c);
  let bases: TypeNode[] = [];
  if (c.eat("extends")) {
    do bases.push(typeReference(c));
    while (c.eat(","));
  }
  c.expect("{");
  const members = typeMembers(c);
  return { id: nextId(c.ids), kind: "interface", name, typeParams, extends: bases, members, start, end: c.end() };
}

// Automatic semicolon insertion: a `;`, a newline or a closing brace ends a statement.
/** @throws {CompileError} */
export function endStatement(c: Mut<Cursor>) {
  if (c.eat(";")) return;
  if (!c.at("}") && !c.peek().newlineBefore && c.peek().kind !== "eof") throw c.error("expected ';'");
}
