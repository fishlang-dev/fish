import { CompileError } from "./diag.ts";
import { expression, sequence } from "./expressions.ts";
import { isToken, lexer, type Comment, type Token } from "./lexer.ts";
import { atClass, atDeclarationKeyword, classDeclaration, decoratorList, exportDeclaration } from "./declarations.ts";
import { bindingPattern, toPattern } from "./patterns.ts";
import { annotation, parameters, returnAnnotation, throwsClause, type, typeMembers, typeParameters, typeReference } from "./types.ts";
import { nextId, type Id, type Ids } from "./nodes.ts";

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


// Reserved in strict-mode JavaScript, so never usable as names.
export const RESERVED = new Set([
  "break", "case", "catch", "class", "const", "continue", "debugger", "default", "delete",
  "do", "else", "enum", "export", "extends", "false", "finally", "for", "function", "if",
  "import", "in", "instanceof", "let", "new", "null", "return", "static", "super", "switch",
  "this", "throw", "true", "try", "typeof", "var", "void", "while", "with", "yield",
]);

// The parser's position in the token stream, shared by the grammar modules.
export type Cursor = {
  // Every token lexed so far, in source order: once a whole program is parsed, all its tokens,
  // each `/` read as the parser decided.
  tokens: Token[];
  pos: usize;
  // False only directly inside a conditional type's `extends` clause, as in TypeScript.
  conditionalAllowed: boolean;
  // False only directly inside a `for` initializer, so `for (x in y)` isn't read as an
  // expression; any bracket, list or block allows `in` again, as in TypeScript.
  inAllowed: boolean;
  // Set while parsing the right side of `|>`, recording whether it used the topic `%`.
  topic: { used: boolean } | undefined;
  // The token `offset` places ahead of the current one. Never look past a `/` where an
  // expression starts: it may begin a regex, and lexing its body as tokens can fail.
  peek(offset?: usize): Token;
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
  end(): usize;
  // Takes the `/` or `/=` at the cursor as the start of a regular expression instead.
  regex(): Token;
  // Runs `parse`; if it throws a CompileError, puts the cursor back and returns undefined.
  attempt<T>(parse: () => T): T | undefined;
  // The comments scanned so far.
  comments: Comment[];
  src: string;
  // Whether JSDoc `@throws` tags declare what a function throws: when compiling, not when
  // formatting or linting, which keep the comment as written.
  docs: boolean;
  // Where each node's id comes from, given by the caller.
  ids: Ids;
};

function cursor(src: string, ids: Ids, from = 0, docs = false): Cursor {
  const lex = lexer(src, from);
  // Every token lexed so far; lookahead and backtracking move `pos` within it.
  const tokens: Token[] = [];
  const describe = (t: Token) => {
    if (t.kind === "eof") return "end of file";
    if (t.kind === "string") return "a string literal";
    return t.kind.startsWith("template") ? "a template literal" : `'${t.text}'`;
  };
  const c: Cursor = {
    tokens,
    comments: lex.comments,
    src,
    docs,
    ids,
    pos: 0,
    conditionalAllowed: true,
    inAllowed: true,
    topic: undefined,
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
    error: (message, t: Token | undefined = c.peek()) => new CompileError(`${message}, found ${describe(t)}`, t.start, t.end),
    list: (item, close) => allowingIn(c, true, () => {
      const items = [];
      while (!c.at(close)) {
        items.push(item());
        if (!c.at(close)) c.expect(",");
      }
      c.next();
      return items;
    }),
    end: () => tokens[c.pos - 1]!.end,
    attempt: (parse) => {
      const [pos, conditionalAllowed, inAllowed, topic, used] = [c.pos, c.conditionalAllowed, c.inAllowed, c.topic, c.topic?.used];
      try {
        return parse();
      } catch (e) {
        if (!(e instanceof CompileError)) throw e;
        [c.pos, c.conditionalAllowed, c.inAllowed, c.topic] = [pos, conditionalAllowed, inAllowed, topic];
        if (topic && used !== undefined) topic.used = used;
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

// Parses with the `in` operator allowed or not, restoring the outer setting after.
export function allowingIn<T>(c: Cursor, allowed: boolean, parse: () => T): T {
  const outer = c.inAllowed;
  c.inAllowed = allowed;
  const result = parse();
  c.inAllowed = outer;
  return result;
}

// A program is a list of statements; which of them may appear at the top level is the
// checker's call. Its nodes' ids come from `ids`.
export function parse(src: string, ids: Ids): Stmt[] {
  return parseWithComments(src, ids, true).program;
}

// The program, and the comments the lexer kept, for the formatter, and its tokens.
export function parseWithComments(src: string, ids: Ids, docs = false): { program: Stmt[]; comments: Comment[]; tokens: Token[] } {
  const c = cursor(src, ids, 0, docs);
  const program: Stmt[] = [];
  while (c.peek().kind !== "eof") program.push(statement(c));
  return { program, comments: c.comments, tokens: c.tokens };
}

// One expression filling the whole text, as a quote's is.
export function parseExpression(src: string, ids: Ids): Expr {
  const c = cursor(src, ids);
  const e = expression(c);
  if (c.peek().kind !== "eof") throw c.error("expected the end of the expression");
  return e;
}

// One type filling the whole text.
export function parseType(src: string, ids: Ids): TypeNode {
  const c = cursor(src, ids);
  const t = type(c);
  if (c.peek().kind !== "eof") throw c.error("expected the end of the type");
  return t;
}

// Words a declaration may start with before its keyword, all of which its JSDoc comes before.
const LEADING = new Set(["export", "default", "declare", "macro"]);

// Whether the token at `i` is a word starting the declaration after it, rather than a property
// name as in `a.default`.
function leading(c: Cursor, i: usize): boolean {
  const t = c.tokens[i]!;
  const before = c.tokens[i - 1];
  return t.kind === "ident" && LEADING.has(t.text) && !(before && (isToken(before, ".") || isToken(before, "?.")));
}

// The members of a union, nested ones included, as a written `A | B | C` has them.
const members = (t: TypeNode): TypeNode[] => (t.kind === "union" ? t.types.flatMap(members) : [t]);

// A declaration's `throws` type: its written clause, or else the types its JSDoc names in
// `@throws {E}` tags, as a union when there are several. `at` is where the declaration starts,
// and its JSDoc is the `/** ... */` comments between it and the token before.
export function documentedThrows(c: Cursor, at: usize, written: TypeNode | undefined): TypeNode | undefined {
  if (!c.docs) return written;
  let i = c.pos - 1;
  while (i > 0 && c.tokens[i]!.start > at) i--;
  while (i > 0 && leading(c, i - 1)) i--;
  const from = i > 0 ? c.tokens[i - 1]!.end : 0;
  const to = c.tokens[i]!.start;
  const jsdoc: Comment[] = [];
  for (let k = c.comments.length - 1; k >= 0 && c.comments[k]!.end > from; k--) {
    const m = c.comments[k]!;
    if (m.end <= to && /^\/\*\*[^/]/.test(m.text)) jsdoc.unshift(m);
  }
  const types = jsdoc.flatMap((m) => thrownTypes(c.src, c.ids, m));
  if (types.length === 0) return written;
  const doc: TypeNode = types.length === 1 ? types[0]! : { id: nextId(c.ids), kind: "union", types: types.flatMap(members), start: types[0]!.start, end: types.at(-1)!.end };
  if (!written) return doc;
  const shape = (t: TypeNode) => JSON.stringify(t, (k, v) => {
    if (k === "id" || k === "start" || k === "end") return undefined;
    if (typeof v === "bigint") return `${v}n`;
    // A union is its members as a set, so neither their order nor a repeat makes a difference.
    return v?.kind === "union" ? { kind: "union", types: [...new Set(members(v).map(shape))].sort() } : v;
  });
  if (shape(doc) !== shape(written)) {
    const text = (t: TypeNode) => c.src.slice(t.start, t.end);
    throw new CompileError(`the JSDoc says '@throws {${types.map(text).join(" | ")}}' but the function says 'throws ${text(written)}'; make them the same type, or keep one`, doc.start, doc.end);
  }
  return written;
}

// The types of a JSDoc comment's `@throws` tags. As in TypeScript, only `@throws {E} why` names a
// type: `@throws INVALID_PARAM` only describes, and so does a tag whose type doesn't parse, such
// as `{@link E}` or `{?E}`, so any TypeScript file still parses.
function thrownTypes(src: string, ids: Ids, m: Comment): TypeNode[] {
  const types: TypeNode[] = [];
  const close = m.end - 2;
  for (const tag of m.text.matchAll(/(?<![^\s*])@throws(?![\p{ID_Continue}$])[ \t]*/gu)) {
    const start = m.start + tag.index + tag[0].length;
    if (src[start] === "{") {
      let end = start;
      for (let depth = 0; end < close; end++) {
        if (src[end] === "{") depth++;
        else if (src[end] === "}" && --depth === 0) break;
      }
      const t = end < close ? typeAt(src, ids, start + 1, end) : undefined;
      if (t) types.push(t);
    }
  }
  return types;
}

// The type written from `start` to `end` of `src`, its spans offsets into the whole text, or
// undefined when that text isn't one type.
function typeAt(src: string, ids: Ids, start: usize, end: usize): TypeNode | undefined {
  const c = cursor(src.slice(0, end), ids, start);
  return c.attempt(() => {
    const t = type(c);
    if (c.peek().kind !== "eof") throw c.error("expected the end of the type");
    return t;
  });
}

// A function, type alias, interface or enum after decorators, which Fish applies as macros
// where TypeScript allows only classes.
export function decorated(c: Cursor, start: usize, decorators: Expr[]): Stmt {
  const next = c.peek(1);
  const at = c.at("function") || (c.at("async") && isToken(next, "function") && !next.newlineBefore) || (c.at("type") && next.kind === "ident")
    || c.at("interface") || c.at("enum") || (c.at("const") && isToken(next, "enum"));
  if (!at) throw c.error("expected a class, function, type, interface or enum after decorators");
  const s = statement(c);
  return { ...s, id: nextId(c.ids), decorators, start } as Stmt;
}

// Only `export default function` may leave out the name, so `name` is "" there.
export function func(c: Cursor, anonymous = false): Func {
  const start = c.peek().start;
  const async = c.eat("async");
  c.expect("function");
  const generator = c.eat("*");
  const name = anonymous && (c.at("(") || c.at("<")) ? "" : c.ident().text;
  const typeParams = typeParameters(c);
  const params = parameters(c);
  const returnType = returnAnnotation(c);
  const throws = documentedThrows(c, start, throwsClause(c));
  // An overload signature or a `declare function` ends where its body would start.
  let body: Stmt[] | undefined;
  if (c.at("{")) body = block(c);
  else endStatement(c);
  return { id: nextId(c.ids), kind: "function", name, async, generator, macro: false, typeParams, params, returnType, ...(throws && { throws }), body, start, end: c.end() };
}

export function block(c: Cursor): Stmt[] {
  c.expect("{");
  const stmts: Stmt[] = [];
  allowingIn(c, true, () => {
    while (!c.eat("}")) {
      if (c.peek().kind === "eof") throw c.error("expected '}'");
      stmts.push(statement(c));
    }
  });
  return stmts;
}

// A braced block, or a single statement as in `if (x) return 1`.
function body(c: Cursor): Stmt[] {
  return c.at("{") ? block(c) : [statement(c)];
}

// Statements that end in a block need nothing after them; the rest end as in JavaScript.
export function statement(c: Cursor): Stmt {
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
  if (declaration) return declaration;
  if (c.at(";")) return { id: nextId(c.ids), kind: "empty", start, end: c.next().end };
  if (c.at("if")) return ifStatement(c);
  if (c.at("while")) return whileStatement(c);
  if (c.at("for")) return forStatement(c);
  if (c.at("switch")) return switchStatement(c);
  if (c.at("try")) return tryStatement(c);
  if (c.peek().kind === "ident" && !RESERVED.has(c.peek().text) && isToken(c.peek(1), ":")) {
    const label = c.next().text;
    c.next();
    const labeled = statement(c);
    return { id: nextId(c.ids), kind: "labeled", label, body: labeled, start, end: labeled.end };
  }
  if (c.at("do")) return doWhileStatement(c);
  if (c.at("interface")) return interfaceDeclaration(c);
  const s: Stmt = c.at("debugger") ? { id: nextId(c.ids), kind: "debugger", start, end: c.next().end }
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
  return { id: nextId(c.ids), kind: "if", cond, then, else: otherwise, start, end: c.end() };
}

function whileStatement(c: Cursor): Stmt {
  const start = c.next().start;
  c.expect("(");
  const cond = sequence(c);
  c.expect(")");
  const loop = body(c);
  return { id: nextId(c.ids), kind: "while", cond, body: loop, start, end: c.end() };
}

// `for (init; test; update)`, `for (left in right)`, `for (left of right)` and `for await`.
function forStatement(c: Cursor): Stmt {
  const start = c.expect("for").start;
  const isAwait = c.eat("await");
  c.expect("(");
  const declared = atDeclaration(c) ? allowingIn(c, false, () => declaration(c)) : undefined;
  const expr = declared || c.at(";") ? undefined : allowingIn(c, false, () => sequence(c));
  const init = declared ?? expr;
  if (init && (c.at("in") || c.at("of"))) {
    const kind = c.next().text === "in" ? "forIn" : "forOf";
    const left = declared ?? toPattern(c, expr!);
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
  const initStmt: Stmt | undefined = declared ?? (expr && { id: nextId(c.ids), kind: "expr", expr, start: expr.start, end: expr.end });
  return { id: nextId(c.ids), kind: "for", init: initStmt, test, update, body: body(c), start, end: c.end() };
}

function switchStatement(c: Cursor): Stmt {
  const start = c.expect("switch").start;
  c.expect("(");
  const discriminant = sequence(c);
  c.expect(")");
  c.expect("{");
  const cases: SwitchCase[] = [];
  while (!c.eat("}")) {
    const caseStart = c.peek().start;
    let test: Expr | undefined;
    if (c.eat("case")) test = sequence(c);
    else if (!c.eat("default")) throw c.error("expected 'case' or 'default'");
    c.expect(":");
    const body: Stmt[] = [];
    while (!c.at("case") && !c.at("default") && !c.at("}")) {
      if (c.peek().kind === "eof") throw c.error("expected '}'");
      body.push(statement(c));
    }
    cases.push({ id: nextId(c.ids), test, body, start: caseStart, end: c.end() });
  }
  return { id: nextId(c.ids), kind: "switch", discriminant, cases, start, end: c.end() };
}

function tryStatement(c: Cursor): Stmt {
  const start = c.expect("try").start;
  const tried = block(c);
  let param: Pattern | undefined;
  let paramType: TypeNode | undefined;
  let handler: Stmt[] | undefined;
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
  if (!handler && !finalizer) throw c.error("expected 'catch' or 'finally'");
  return { id: nextId(c.ids), kind: "try", block: tried, param, paramType, handler, finalizer, start, end: c.end() };
}

// The `;` after `do...while (x)` is optional even on the same line, unlike other statements.
function doWhileStatement(c: Cursor): Stmt {
  const start = c.expect("do").start;
  const loop = body(c);
  c.expect("while");
  c.expect("(");
  const cond = sequence(c);
  c.expect(")");
  c.eat(";");
  return { id: nextId(c.ids), kind: "doWhile", body: loop, cond, start, end: c.end() };
}

const atDeclaration = (c: Cursor) => c.at("let") || c.at("const") || c.at("var");

function declaration(c: Cursor): Stmt {
  const start = c.peek().start;
  const keyword = c.next().text as "let" | "const" | "var";
  const declarations: Declarator[] = [];
  do declarations.push(declarator(c));
  while (c.eat(","));
  // As in TypeScript, a statement's JSDoc belongs to its only declarator, here an arrow's.
  const init = declarations.length === 1 ? declarations[0]!.init : undefined;
  if (init?.kind === "arrow") {
    const throws = documentedThrows(c, start, init.throws);
    if (throws) init.throws = throws;
  }
  return { id: nextId(c.ids), kind: "let", keyword, declarations, start, end: c.end() };
}

function simpleStatement(c: Cursor): Stmt {
  const start = c.peek().start;
  if (atDeclaration(c)) return declaration(c);
  if (c.at("break") || c.at("continue")) {
    const kind = c.next().text as "break" | "continue";
    // A label must be on the same line, as with `return`'s value.
    const label = c.peek().kind === "ident" && !c.peek().newlineBefore && !RESERVED.has(c.peek().text) ? c.next().text : undefined;
    return { id: nextId(c.ids), kind, label, start, end: c.end() };
  }
  if (c.at("throw")) {
    c.next();
    if (c.peek().newlineBefore) throw new CompileError("a line break is not allowed after 'throw'", start, c.peek().start);
    const value = sequence(c);
    return { id: nextId(c.ids), kind: "throw", value, start, end: value.end };
  }
  if (c.at("return")) {
    const end = c.next().end;
    // A newline after `return` ends the statement, as in JavaScript.
    if (c.at(";") || c.at("}") || c.peek().newlineBefore || c.peek().kind === "eof") return { id: nextId(c.ids), kind: "return", value: undefined, start, end };
    const value = sequence(c);
    return { id: nextId(c.ids), kind: "return", value, start, end: value.end };
  }
  const expr = sequence(c);
  return { id: nextId(c.ids), kind: "expr", expr, start, end: expr.end };
}

function declarator(c: Cursor): Declarator {
  const start = c.peek().start;
  const target = bindingPattern(c);
  const type = c.at(":") ? annotation(c) : undefined;
  const init = c.eat("=") ? expression(c) : undefined;
  return { id: nextId(c.ids), target, type, init, start, end: c.end() };
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
  let t = type(c);
  // A function type's alias takes its JSDoc `@throws` tags as that type's clause, in the place a
  // written clause has; any other alias has no clause for them to give.
  if (t.kind === "function") {
    const { construct, abstract, ...head } = t;
    const throws = documentedThrows(c, start, t.throws);
    if (throws) t = { ...head, throws, construct, abstract };
  }
  return { id: nextId(c.ids), kind: "typeAlias", name, typeParams, type: t, start, end: t.end };
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
  return { id: nextId(c.ids), kind: "interface", name, typeParams, extends: bases, members, start, end: c.end() };
}

// Automatic semicolon insertion: a `;`, a newline or a closing brace ends a statement.
export function endStatement(c: Cursor) {
  if (c.eat(";")) return;
  if (!c.at("}") && !c.peek().newlineBefore && c.peek().kind !== "eof") throw c.error("expected ';'");
}

// Moves every span in a parsed tree by `by`, for a source placed past others in one program.
export function shiftSpans(v: unknown, by: usize, seen: Set<unknown> = new Set<unknown>()) {
  if (typeof v !== "object" || v === null || seen.has(v)) return;
  seen.add(v);
  if (Array.isArray(v)) return v.forEach((x) => shiftSpans(x, by, seen));
  const node = v as Record<string, unknown>;
  if (typeof node.start === "number") node.start += by;
  if (typeof node.end === "number") node.end += by;
  Object.values(node).forEach((x) => shiftSpans(x, by, seen));
}
