import type { CompileError } from "./diag.ts";
import { expression, leftHandSide, sequence } from "./expressions.ts";
import { isToken, type Token } from "./lexer.ts";
import {
  accessorOf, block, decorated, documentedArrow, documentedThrows, isModifier, modifierOf, endStatement, func, statement, type ClassMember, type ClassNode, type Cursor, type EnumMember, type Expr, type Modifier,
  type PropertyName, type Specifier, type Stmt, type TypeNode, type TypeParam,
} from "./parser.ts";
import { annotation, parameters, propertyName, returnAnnotation, throwsClause, type, typeParameters, typeReference } from "./types.ts";
import { nextId } from "./ids.ts";

// Declarations beyond functions, aliases and interfaces: classes with their members,
// modifiers and decorators; enums; namespaces; and ambient `declare` forms.

// The declaration starting at the cursor, if its keyword is one of these, or undefined.
// Each keyword but `enum` is contextual, so it only counts with what follows on its line.
/** @throws {CompileError} */
export function atDeclarationKeyword(c: Mut<Cursor>): Stmt | undefined {
  const start = c.peek().start;
  const next = c.token(1);
  const sameLine = !next.newlineBefore;
  if (c.at("enum") || (c.at("const") && isToken(next, "enum"))) return enumDeclaration(c);
  // `import(` and `import.meta` start expressions.
  if (c.at("import") && !isToken(next, "(") && !isToken(next, ".")) return importDeclaration(c);
  if ((c.at("namespace") || c.at("module")) && sameLine && (next.kind === "ident" || (c.at("module") && next.kind === "string"))) {
    return namespaceDeclaration(c);
  }
  // Inside `declare module "m" { }`, `global { }` augments the global scope without `declare`.
  if (c.at("global") && isToken(next, "{") && sameLine) return namespaceDeclaration(c);
  if (c.at("declare") && sameLine && (DECLARABLE.includes(next.text) && next.kind === "ident")) {
    c.next();
    const body = c.at("global") ? namespaceDeclaration(c) : statement(c);
    const bodyEnd: usize = body.end;
    return { id: nextId(c.ids), kind: "declare", body, start, end: bodyEnd };
  }
  return undefined;
}

const DECLARABLE = [
  "var", "let", "const", "function", "async", "class", "abstract", "enum", "namespace", "module", "global",
  "interface", "type",
];

/** @throws {CompileError} */
function enumDeclaration(c: Mut<Cursor>): Stmt {
  const start = c.peek().start;
  const isConst = c.eat("const");
  c.expect("enum");
  const name = c.ident().text;
  const typeParams: TypeParam[] = c.at("<") ? typeParameters(c) : [];
  c.expect("{");
  // A member may hold values, `Circle(f64)`, rather than be one.
  const members = c.list((c): EnumMember => {
    const t = c.next();
    if (t.kind !== "ident" && t.kind !== "string") throw c.error("expected a member name", t);
    const payload = c.eat("(") ? c.list((c) => type(c), ")") : undefined;
    const init = c.eat("=") ? expression(c) : undefined;
    return { id: nextId(c.ids), name: t.text, init, payload, start: t.start, end: c.end() };
  }, "}");
  return { id: nextId(c.ids), kind: "enum", name, const: isConst, typeParams, members, start, end: c.end() };
}

// `namespace A.B { }`, `module A { }`, `module "m" { }`, `declare module "m";`, `global { }`.
/** @throws {CompileError} */
function namespaceDeclaration(c: Mut<Cursor>): Stmt {
  const start = c.peek().start;
  const global = c.eat("global");
  if (!global) c.next();
  const quoted = !global && c.peek().kind === "string";
  let name = global ? "global" : quoted ? c.next().text : c.ident().text;
  while (!quoted && !global && c.eat(".")) name += "." + c.ident().text;
  if (c.at("{")) return { id: nextId(c.ids), kind: "namespace", name, quoted, global, body: block(c), start, end: c.end() };
  endStatement(c);
  return { id: nextId(c.ids), kind: "namespace", name, quoted, global, body: undefined, start, end: c.end() };
}

/** @throws {CompileError} */
export function atClass(c: Mut<Cursor>): boolean {
  return c.at("class") || (c.at("abstract") && isToken(c.peek(1), "class") && !c.peek(1).newlineBefore);
}

/** @throws {CompileError} */
export function classDeclaration(c: Mut<Cursor>, start: usize, decorators: Expr[]): Stmt {
  const abstract = c.eat("abstract");
  let node = classNode(c, start, abstract, decorators);
  node.id = nextId(c.ids);
  return node;
}

// `class Name<T> extends Base<T> implements I { ... }`, as a declaration or an expression.
// `start` is where the class's first decorator or modifier began.
/** @throws {CompileError} */
export function classNode(c: Mut<Cursor>, start: usize, abstract: boolean, decorators: Expr[]): ClassNode & { kind: "class" } {
  c.expect("class");
  // A class expression may be anonymous, and so may `export default class`.
  const name = c.peek().kind === "ident" && !c.at("extends") && !c.at("implements") ? c.ident().text : undefined;
  const typeParams = typeParameters(c);
  const heritage = c.eat("extends") ? baseClass(c) : undefined;
  let implemented: TypeNode[] = [];
  if (c.eat("implements")) {
    do implemented.push(typeReference(c));
    while (c.eat(","));
  }
  c.expect("{");
  let members: ClassMember[] = [];
  while (!c.eat("}")) {
    if (c.peek().kind === "eof") throw c.error("expected '}'");
    if (!c.eat(";")) members.push(classMember(c));
  }
  return { kind: "class", id: nextId(c.ids), name, abstract, decorators, typeParams, extends: heritage, implements: implemented, members, start, end: c.end() };
}

// Any left-hand-side expression, as in `extends mixin(Base)`; type arguments after it, as
// in `extends Base<T> {`, can't be confirmed the way a generic call's are, so they're read here.
/** @throws {CompileError} */
function baseClass(c: Mut<Cursor>): Expr {
  const base = leftHandSide(c);
  if (!c.eat("<")) return base;
  const typeArgs = c.list((c) => type(c), ">");
  const baseStart: usize = base.start;
  return { id: nextId(c.ids), kind: "instantiation", expr: base, typeArgs, start: baseStart, end: c.end() };
}


/** @throws {CompileError} */
function classMember(c: Mut<Cursor>): ClassMember {
  const start = c.peek().start;
  const decorators = decoratorList(c);
  const startsName = (t: Ref<Token>) => ["ident", "string", "int", "float", "bigint", "private"].includes(t.kind) || isToken(t, "[") || isToken(t, "*");
  // A modifier is one only when a member follows it on the same line: `static() {}` is a
  // method named `static`, and `readonly: boolean` a field named `readonly`.
  let modifiers: Modifier[] = [];
  while (isModifier(c.peek().text) && c.peek().kind === "ident" && !c.peek(1).newlineBefore &&
    (startsName(c.peek(1)) || (c.at("static") && isToken(c.peek(1), "{")))) {
    modifiers.push(modifierOf(c.next().text));
  }
  if (modifiers.length === 1 && modifiers[0] === "static" && c.at("{")) {
    return { id: nextId(c.ids), modifiers: [], decorators, start, kind: "staticBlock", body: block(c), end: c.end() };
  }
  const member = { modifiers, decorators, start };
  if (c.at("[") && c.peek(1).kind === "ident" && isToken(c.peek(2), ":")) {
    c.next();
    const params = parameters(c, "]");
    const valueType = annotation(c);
    endMember(c);
    return { id: nextId(c.ids), ...member, kind: "index", params, type: valueType, end: c.end() };
  }
  if ((c.at("get") || c.at("set")) && startsName(c.peek(1)) && !isToken(c.peek(1), "*")) {
    const kind = accessorOf(c.next().text);
    const name = memberName(c);
    const params = parameters(c);
    const returnType = returnAnnotation(c);
    const throws = documentedThrows(c, start, undefined);
    let accessor: Extract<ClassMember, { kind: "get" | "set" }> = { id: nextId(c.ids), ...member, kind, name, params, returnType, body: memberBody(c), end: c.end() };
    if (throws !== undefined) accessor.throws = throws;
    return accessor;
  }
  if (c.at("constructor") && isToken(c.peek(1), "(")) {
    c.next();
    const params = parameters(c);
    const written = throwsClause(c);
    const doc = documentedThrows(c, start, written);
    const throws = written ?? doc;
    let ctor: Extract<ClassMember, { kind: "constructor" }> = { id: nextId(c.ids), ...member, kind: "constructor", params, body: memberBody(c), end: c.end() };
    if (throws !== undefined) ctor.throws = throws;
    return ctor;
  }
  const generator = c.eat("*");
  const name = memberName(c);
  const optional = c.eat("?");
  if (generator || c.at("(") || c.at("<")) {
    const typeParams = typeParameters(c);
    const params = parameters(c);
    const returnType = returnAnnotation(c);
    const written = throwsClause(c);
    const doc = documentedThrows(c, start, written);
    const throws = written ?? doc;
    let method: Extract<ClassMember, { kind: "method" }> = { id: nextId(c.ids), ...member, kind: "method", name, optional, generator, typeParams, params, returnType, body: memberBody(c), end: c.end() };
    if (throws !== undefined) method.throws = throws;
    return method;
  }
  const definite = !optional && c.eat("!");
  const fieldType = c.at(":") ? annotation(c) : undefined;
  let init: Expr | undefined = undefined;
  if (c.eat("=")) {
    const value = expression(c);
    init = documentedArrow(c, start, value);
  }
  endMember(c);
  return { id: nextId(c.ids), ...member, kind: "field", name, optional, definite, type: fieldType, init, end: c.end() };
}

// An overload signature or an abstract member has no body.
/** @throws {CompileError} */
function memberBody(c: Mut<Cursor>): Stmt[] | undefined {
  if (c.at("{")) return block(c);
  endMember(c);
  return undefined;
}

// `@a`, `@a.b`, `@a.b(args)` or `@(expression)`. A decorator never takes `[`, so in
// `@dec [key]() {}` the brackets are the member's computed name.
/** @throws {CompileError} */
export function decoratorList(c: Mut<Cursor>): Expr[] {
  let decorators: Expr[] = [];
  while (c.at("@")) {
    c.next();
    let e: Expr;
    if (c.eat("(")) {
      e = sequence(c);
      c.expect(")");
    } else {
      const first = c.ident();
      e = { id: nextId(c.ids), kind: "ident", name: first.text, start: first.start, end: first.end };
      while (c.eat(".")) {
        const name = c.next();
        if (name.kind !== "ident" && name.kind !== "private") throw c.error("expected a property name", name);
        const eStart: usize = e.start;
        e = { id: nextId(c.ids), kind: "member", object: e, name: name.text, optional: false, start: eStart, end: name.end };
      }
    }
    if (c.eat("(")) {
      const args = c.list((c) => expression(c), ")");
      const eStart: usize = e.start;
      e = { id: nextId(c.ids), kind: "call", callee: e, typeArgs: [], args, optional: false, start: eStart, end: c.end() };
    }
    decorators.push(e);
  }
  return decorators;
}

// Member names may be reserved words or private names such as `#count`.
/** @throws {CompileError} */
function memberName(c: Mut<Cursor>): PropertyName {
  return c.peek().kind === "private" ? c.next().text : propertyName(c);
}

// A field ends with `;`, a line break, or the class's closing brace.
/** @throws {CompileError} */
function endMember(c: Mut<Cursor>) {
  if (c.eat(";") || c.at("}") || c.peek().newlineBefore) return;
  throw c.error("expected ';'");
}

/** @throws {CompileError} */
function importDeclaration(c: Mut<Cursor>): Stmt {
  const start = c.expect("import").start;
  const typeOnly = atTypeModifier(c) && c.eat("type");
  // `import defer * as ns` loads the module on first use; `import defer from` is a default.
  const defer = c.at("defer") && isToken(c.peek(1), "*") && c.eat("defer");
  if (c.peek().kind === "ident" && isToken(c.peek(1), "=")) {
    const name = c.ident().text;
    c.expect("=");
    const required = c.at("require") && isToken(c.peek(1), "(");
    let module: string | undefined = undefined;
    let entity: string | undefined = undefined;
    if (required) {
      c.next();
      c.expect("(");
      module = moduleName(c);
      c.expect(")");
    } else {
      let dotted = c.ident().text;
      while (c.eat(".")) dotted += "." + c.next().text;
      entity = dotted;
    }
    endStatement(c);
    return { id: nextId(c.ids), kind: "importEquals", typeOnly, name, require: module, entity, start, end: c.end() };
  }
  let fallback: string | undefined = undefined;
  let namespace: string | undefined = undefined;
  let named: Specifier[] | undefined = undefined;
  if (c.peek().kind !== "string") {
    if ((c.peek().kind === "ident" && !c.at("from")) || (c.at("from") && isToken(c.peek(1), "from"))) {
      fallback = c.ident().text;
      if (!c.at("from")) c.expect(",");
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
  return { id: nextId(c.ids), kind: "import", typeOnly, defer, default: fallback, namespace, named, module, attributes, start, end: c.end() };
}

// `import type from "m"` imports a default named `type`; `type` modifies only when an import
// clause follows it.
/** @throws {CompileError} */
function atTypeModifier(c: Mut<Cursor>): boolean {
  if (!c.at("type")) return false;
  const next = c.token(1);
  if (isToken(next, "{") || isToken(next, "*")) return true;
  return next.kind === "ident" && !(isToken(next, "from") && c.peek(2).kind === "string") && !isToken(next, "=");
}

/** @throws {CompileError} */
export function specifiers(c: Mut<Cursor>): Specifier[] {
  c.expect("{");
  return c.list((c): Specifier => {
    const start = c.peek().start;
    // `{ type as x }` renames `type`; `{ type x }` and `{ type as as x }` are type-only.
    const next = c.token(1);
    const after = c.token(2);
    const named = next.kind === "ident" || next.kind === "string";
    const typeOnly = c.at("type") && named && !(isToken(next, "as") && after.kind === "ident" && !isToken(after, "as")) && c.eat("type");
    const name = specifierName(c);
    const alias = c.eat("as") ? specifierName(c) : undefined;
    return { id: nextId(c.ids), name, alias, typeOnly, start, end: c.end() };
  }, "}");
}

// Specifier names may be reserved words, as in `default as d`, or strings.
/** @throws {CompileError} */
export function specifierName(c: Mut<Cursor>): string {
  const t = c.next();
  if (t.kind !== "ident" && t.kind !== "string") throw c.error("expected a name", t);
  return t.text;
}

/** @throws {CompileError} */
export function moduleName(c: Mut<Cursor>): string {
  if (c.peek().kind !== "string") throw c.error("expected a module name");
  return c.next().text;
}

// Every form of `export`. Decorators written before `export` belong to the class after it.
/** @throws {CompileError} */
export function exportDeclaration(c: Mut<Cursor>, start: usize, decorators: Expr[]): Stmt {
  c.expect("export");
  if (c.eat("default")) {
    const classStart = decorators.length > 0 ? start : c.peek().start;
    const all = [...decorators, ...decoratorList(c)];
    if (atClass(c)) return { id: nextId(c.ids), kind: "exportDefault", declaration: classDeclaration(c, classStart, all), value: undefined, start, end: c.end() };
    if (all.length > 0) throw c.error("expected a class after decorators");
    if (c.at("function") || (c.at("async") && isToken(c.peek(1), "function") && !c.peek(1).newlineBefore)) {
      return { id: nextId(c.ids), kind: "exportDefault", declaration: func(c, true), value: undefined, start, end: c.end() };
    }
    if (c.at("interface")) return { id: nextId(c.ids), kind: "exportDefault", declaration: statement(c), value: undefined, start, end: c.end() };
    const value = expression(c);
    endStatement(c);
    return { id: nextId(c.ids), kind: "exportDefault", declaration: undefined, value, start, end: c.end() };
  }
  if (decorators.length > 0 || c.at("@")) {
    const classStart = decorators.length > 0 ? start : c.peek().start;
    const all = [...decorators, ...decoratorList(c)];
    const body = atClass(c) ? classDeclaration(c, classStart, all) : decorated(c, classStart, all);
    return { id: nextId(c.ids), kind: "export", body, start, end: c.end() };
  }
  if (c.eat("=")) {
    const value = expression(c);
    endStatement(c);
    return { id: nextId(c.ids), kind: "exportAssign", value, start, end: c.end() };
  }
  if (c.at("as") && isToken(c.peek(1), "namespace")) {
    c.next();
    c.next();
    const name = c.ident().text;
    endStatement(c);
    return { id: nextId(c.ids), kind: "exportAsNamespace", name, start, end: c.end() };
  }
  // `export type { A }` and `export type * from`, but `export type A = B` is an alias.
  const typeOnly = c.at("type") && (isToken(c.peek(1), "{") || isToken(c.peek(1), "*")) && c.eat("type");
  if (c.eat("*")) {
    const alias = c.eat("as") ? specifierName(c) : undefined;
    c.expect("from");
    const module = moduleName(c);
    endStatement(c);
    return { id: nextId(c.ids), kind: "exportAll", typeOnly, alias, module, start, end: c.end() };
  }
  if (c.at("{")) {
    const list = specifiers(c);
    const module = c.eat("from") ? moduleName(c) : undefined;
    endStatement(c);
    return { id: nextId(c.ids), kind: "exportNamed", typeOnly, specifiers: list, module, start, end: c.end() };
  }
  const body = statement(c);
  const bodyEnd: usize = body.end;
  return { id: nextId(c.ids), kind: "export", body, start, end: bodyEnd };
}
