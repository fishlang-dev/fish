import { expression, leftHandSide, sequence } from "./expressions.ts";
import { isToken, type Token } from "./lexer.ts";
import {
  block, endStatement, func, statement, type ClassMember, type ClassNode, type Cursor, type EnumMember, type Expr, type Modifier,
  type PropertyName, type Specifier, type Stmt,
} from "./parser.ts";
import { annotation, parameters, propertyName, returnAnnotation, type, typeParameters, typeReference } from "./types.ts";

// Declarations beyond functions, aliases and interfaces: classes with their members,
// modifiers and decorators; enums; namespaces; and ambient `declare` forms.

// The declaration starting at the cursor, if its keyword is one of these, or undefined.
// Each keyword but `enum` is contextual, so it only counts with what follows on its line.
export function atDeclarationKeyword(c: Cursor): Stmt | undefined {
  const start = c.peek().start;
  const next = c.peek(1);
  const sameLine = !next.newlineBefore;
  if (c.at("enum") || (c.at("const") && isToken(next, "enum"))) return enumDeclaration(c);
  // `import(` and `import.meta` start expressions.
  if (c.at("import") && !isToken(next, "(") && !isToken(next, ".")) return importDeclaration(c);
  if ((c.at("namespace") || c.at("module")) && sameLine && (next.kind === "ident" || (c.at("module") && next.kind === "string"))) {
    return namespaceDeclaration(c);
  }
  // Inside `declare module "m" { }`, `global { }` augments the global scope without `declare`.
  if (c.at("global") && isToken(next, "{") && sameLine) return namespaceDeclaration(c);
  if (c.at("declare") && sameLine && (DECLARABLE.has(next.text) && next.kind === "ident")) {
    c.next();
    const body = c.at("global") ? namespaceDeclaration(c) : statement(c);
    return { kind: "declare", body, start, end: body.end };
  }
  return undefined;
}

const DECLARABLE = new Set([
  "var", "let", "const", "function", "async", "class", "abstract", "enum", "namespace", "module", "global",
  "interface", "type",
]);

function enumDeclaration(c: Cursor): Stmt {
  const start = c.peek().start;
  const isConst = c.eat("const");
  c.expect("enum");
  const name = c.ident().text;
  c.expect("{");
  const members = c.list((): EnumMember => {
    const t = c.next();
    if (t.kind !== "ident" && t.kind !== "string") throw c.error("expected a member name", t);
    const init = c.eat("=") ? expression(c) : undefined;
    return { name: t.text, init, start: t.start, end: c.end() };
  }, "}");
  return { kind: "enum", name, const: isConst, members, start, end: c.end() };
}

// `namespace A.B { }`, `module A { }`, `module "m" { }`, `declare module "m";`, `global { }`.
function namespaceDeclaration(c: Cursor): Stmt {
  const start = c.peek().start;
  const global = c.eat("global");
  if (!global) c.next();
  const quoted = !global && c.peek().kind === "string";
  let name = global ? "global" : quoted ? c.next().text : c.ident().text;
  while (!quoted && !global && c.eat(".")) name += "." + c.ident().text;
  if (c.at("{")) return { kind: "namespace", name, quoted, global, body: block(c), start, end: c.end() };
  endStatement(c);
  return { kind: "namespace", name, quoted, global, body: undefined, start, end: c.end() };
}

export const atClass = (c: Cursor) => c.at("class") || (c.at("abstract") && isToken(c.peek(1), "class") && !c.peek(1).newlineBefore);

export function classDeclaration(c: Cursor, start: number, decorators: Expr[]): Stmt {
  const abstract = c.eat("abstract");
  return { kind: "class", ...classNode(c, start, abstract, decorators) };
}

// `class Name<T> extends Base<T> implements I { ... }`, as a declaration or an expression.
// `start` is where the class's first decorator or modifier began.
export function classNode(c: Cursor, start: number, abstract: boolean, decorators: Expr[]): ClassNode {
  c.expect("class");
  // A class expression may be anonymous, and so may `export default class`.
  const name = c.peek().kind === "ident" && !c.at("extends") && !c.at("implements") ? c.ident().text : undefined;
  const typeParams = typeParameters(c);
  const heritage = c.eat("extends") ? baseClass(c) : undefined;
  const implemented = [];
  if (c.eat("implements")) {
    do implemented.push(typeReference(c));
    while (c.eat(","));
  }
  c.expect("{");
  const members: ClassMember[] = [];
  while (!c.eat("}")) {
    if (c.peek().kind === "eof") throw c.error("expected '}'");
    if (!c.eat(";")) members.push(classMember(c));
  }
  return { name, abstract, decorators, typeParams, extends: heritage, implements: implemented, members, start, end: c.end() };
}

// Any left-hand-side expression, as in `extends mixin(Base)`; type arguments after it, as
// in `extends Base<T> {`, can't be confirmed the way a generic call's are, so they're read here.
function baseClass(c: Cursor): Expr {
  const base = leftHandSide(c);
  if (!c.eat("<")) return base;
  const typeArgs = c.list(() => type(c), ">");
  return { kind: "instantiation", expr: base, typeArgs, start: base.start, end: c.end() };
}

const MODIFIERS = new Set(["public", "private", "protected", "static", "readonly", "abstract", "override", "declare", "accessor", "async"]);

function classMember(c: Cursor): ClassMember {
  const start = c.peek().start;
  const decorators = decoratorList(c);
  const startsName = (t: Token) => ["ident", "string", "int", "float", "bigint", "private"].includes(t.kind) || isToken(t, "[") || isToken(t, "*");
  // A modifier is one only when a member follows it on the same line: `static() {}` is a
  // method named `static`, and `readonly: boolean` a field named `readonly`.
  const modifiers: Modifier[] = [];
  while (MODIFIERS.has(c.peek().text) && c.peek().kind === "ident" && !c.peek(1).newlineBefore &&
    (startsName(c.peek(1)) || (c.at("static") && isToken(c.peek(1), "{")))) {
    modifiers.push(c.next().text as Modifier);
  }
  const member = { modifiers, decorators, start };
  if (modifiers.length === 1 && modifiers[0] === "static" && c.at("{")) {
    return { ...member, modifiers: [], kind: "staticBlock", body: block(c), end: c.end() };
  }
  if (c.at("[") && c.peek(1).kind === "ident" && isToken(c.peek(2), ":")) {
    c.next();
    const params = parameters(c, "]");
    const valueType = annotation(c);
    endMember(c);
    return { ...member, kind: "index", params, type: valueType, end: c.end() };
  }
  if ((c.at("get") || c.at("set")) && startsName(c.peek(1)) && !isToken(c.peek(1), "*")) {
    const kind = c.next().text as "get" | "set";
    const name = memberName(c);
    const params = parameters(c);
    const returnType = returnAnnotation(c);
    return { ...member, kind, name, params, returnType, body: memberBody(c), end: c.end() };
  }
  if (c.at("constructor") && isToken(c.peek(1), "(")) {
    c.next();
    const params = parameters(c);
    return { ...member, kind: "constructor", params, body: memberBody(c), end: c.end() };
  }
  const generator = c.eat("*");
  const name = memberName(c);
  const optional = c.eat("?");
  if (generator || c.at("(") || c.at("<")) {
    const typeParams = typeParameters(c);
    const params = parameters(c);
    const returnType = returnAnnotation(c);
    return { ...member, kind: "method", name, optional, generator, typeParams, params, returnType, body: memberBody(c), end: c.end() };
  }
  const definite = !optional && c.eat("!");
  const fieldType = c.at(":") ? annotation(c) : undefined;
  const init = c.eat("=") ? expression(c) : undefined;
  endMember(c);
  return { ...member, kind: "field", name, optional, definite, type: fieldType, init, end: c.end() };
}

// An overload signature or an abstract member has no body.
function memberBody(c: Cursor): Stmt[] | undefined {
  if (c.at("{")) return block(c);
  endMember(c);
  return undefined;
}

// `@a`, `@a.b`, `@a.b(args)` or `@(expression)`. A decorator never takes `[`, so in
// `@dec [key]() {}` the brackets are the member's computed name.
export function decoratorList(c: Cursor): Expr[] {
  const decorators: Expr[] = [];
  while (c.at("@")) {
    c.next();
    let e: Expr;
    if (c.eat("(")) {
      e = sequence(c);
      c.expect(")");
    } else {
      const first = c.ident();
      e = { kind: "ident", name: first.text, start: first.start, end: first.end };
      while (c.eat(".")) {
        const name = c.next();
        if (name.kind !== "ident" && name.kind !== "private") throw c.error("expected a property name", name);
        e = { kind: "member", object: e, name: name.text, optional: false, start: e.start, end: name.end };
      }
    }
    if (c.eat("(")) {
      const args = c.list(() => expression(c), ")");
      e = { kind: "call", callee: e, typeArgs: [], args, optional: false, start: e.start, end: c.end() };
    }
    decorators.push(e);
  }
  return decorators;
}

// Member names may be reserved words or private names such as `#count`.
function memberName(c: Cursor): PropertyName {
  return c.peek().kind === "private" ? c.next().text : propertyName(c);
}

// A field ends with `;`, a line break, or the class's closing brace.
function endMember(c: Cursor) {
  if (c.eat(";") || c.at("}") || c.peek().newlineBefore) return;
  throw c.error("expected ';'");
}

function importDeclaration(c: Cursor): Stmt {
  const start = c.expect("import").start;
  const typeOnly = atTypeModifier(c) && c.eat("type");
  if (c.peek().kind === "ident" && isToken(c.peek(1), "=")) {
    const name = c.ident().text;
    c.expect("=");
    const required = c.at("require") && isToken(c.peek(1), "(");
    let module: string | undefined;
    let entity: string | undefined;
    if (required) {
      c.next();
      c.expect("(");
      module = moduleName(c);
      c.expect(")");
    } else {
      entity = c.ident().text;
      while (c.eat(".")) entity += "." + c.next().text;
    }
    endStatement(c);
    return { kind: "importEquals", typeOnly, name, require: module, entity, start, end: c.end() };
  }
  let fallback: string | undefined;
  let namespace: string | undefined;
  let named: Specifier[] | undefined;
  if (c.peek().kind !== "string") {
    if ((c.peek().kind === "ident" && !c.at("from")) || (c.at("from") && isToken(c.peek(1), "from"))) {
      fallback = c.ident().text;
      c.eat(",");
    }
    if (c.eat("*")) {
      c.expect("as");
      namespace = c.ident().text;
    } else if (c.at("{")) {
      named = specifiers(c);
    }
    c.expect("from");
  }
  const module = moduleName(c);
  const attributes = c.eat("with") || (c.at("assert") && !c.peek().newlineBefore && c.eat("assert")) ? expression(c) : undefined;
  endStatement(c);
  return { kind: "import", typeOnly, default: fallback, namespace, named, module, attributes, start, end: c.end() };
}

// `import type from "m"` imports a default named `type`; `type` modifies only when an import
// clause follows it.
function atTypeModifier(c: Cursor): boolean {
  if (!c.at("type")) return false;
  const next = c.peek(1);
  if (isToken(next, "{") || isToken(next, "*")) return true;
  return next.kind === "ident" && !(isToken(next, "from") && c.peek(2).kind === "string") && !isToken(next, "=");
}

export function specifiers(c: Cursor): Specifier[] {
  c.expect("{");
  return c.list((): Specifier => {
    const start = c.peek().start;
    // `{ type as x }` renames `type`; `{ type x }` and `{ type as as x }` are type-only.
    const [next, after] = [c.peek(1), c.peek(2)];
    const named = next.kind === "ident" || next.kind === "string";
    const typeOnly = c.at("type") && named && !(isToken(next, "as") && after.kind === "ident" && !isToken(after, "as")) && c.eat("type");
    const name = specifierName(c);
    const alias = c.eat("as") ? specifierName(c) : undefined;
    return { name, alias, typeOnly, start, end: c.end() };
  }, "}");
}

// Specifier names may be reserved words, as in `default as d`, or strings.
export function specifierName(c: Cursor): string {
  const t = c.next();
  if (t.kind !== "ident" && t.kind !== "string") throw c.error("expected a name", t);
  return t.text;
}

export function moduleName(c: Cursor): string {
  if (c.peek().kind !== "string") throw c.error("expected a module name");
  return c.next().text;
}

// Every form of `export`. Decorators written before `export` belong to the class after it.
export function exportDeclaration(c: Cursor, start: number, decorators: Expr[]): Stmt {
  c.expect("export");
  const end = () => c.end();
  if (c.eat("default")) {
    const classStart = decorators.length > 0 ? start : c.peek().start;
    const all = [...decorators, ...decoratorList(c)];
    if (atClass(c)) return { kind: "exportDefault", declaration: classDeclaration(c, classStart, all), value: undefined, start, end: end() };
    if (all.length > 0) throw c.error("expected a class after decorators");
    if (c.at("function") || (c.at("async") && isToken(c.peek(1), "function") && !c.peek(1).newlineBefore)) {
      return { kind: "exportDefault", declaration: func(c, true), value: undefined, start, end: end() };
    }
    if (c.at("interface")) return { kind: "exportDefault", declaration: statement(c), value: undefined, start, end: end() };
    const value = expression(c);
    endStatement(c);
    return { kind: "exportDefault", declaration: undefined, value, start, end: end() };
  }
  if (decorators.length > 0 || c.at("@")) {
    const classStart = decorators.length > 0 ? start : c.peek().start;
    const all = [...decorators, ...decoratorList(c)];
    if (!atClass(c)) throw c.error("expected a class after decorators");
    return { kind: "export", body: classDeclaration(c, classStart, all), start, end: end() };
  }
  if (c.eat("=")) {
    const value = expression(c);
    endStatement(c);
    return { kind: "exportAssign", value, start, end: end() };
  }
  if (c.at("as") && isToken(c.peek(1), "namespace")) {
    c.next();
    c.next();
    const name = c.ident().text;
    endStatement(c);
    return { kind: "exportAsNamespace", name, start, end: end() };
  }
  // `export type { A }` and `export type * from`, but `export type A = B` is an alias.
  const typeOnly = c.at("type") && (isToken(c.peek(1), "{") || isToken(c.peek(1), "*")) && c.eat("type");
  if (c.eat("*")) {
    const alias = c.eat("as") ? specifierName(c) : undefined;
    c.expect("from");
    const module = moduleName(c);
    endStatement(c);
    return { kind: "exportAll", typeOnly, alias, module, start, end: end() };
  }
  if (c.at("{")) {
    const list = specifiers(c);
    const module = c.eat("from") ? moduleName(c) : undefined;
    endStatement(c);
    return { kind: "exportNamed", typeOnly, specifiers: list, module, start, end: end() };
  }
  const body = statement(c);
  return { kind: "export", body, start, end: body.end };
}
