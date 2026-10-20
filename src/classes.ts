import { CompileError } from "./diag.ts";
import type { ClassMember, ClassNode, Expr, Param, Span, Stmt, TypeNode } from "./parser.ts";
import { classType, type ClassType } from "./typing.ts";
import { unsupported } from "./unsupported.ts";

// A function to compile: a top-level function, or a class's constructor, which gets the
// instance it builds as `this`.
export type Body = Span & {
  name: string;
  params: Param[];
  body: Stmt[];
  returnType: TypeNode | undefined;
  self?: { type: ClassType; constructor: boolean };
};

// A field as declared: its annotation, its initializer, or both give its type.
export type FieldDecl = Span & { name: string; type: TypeNode | undefined; init: Expr | undefined };

export type ClassInfo = {
  type: ClassType;
  fields: FieldDecl[];
  // Its body starts by assigning the field initializers, then the parameter properties.
  constructor: Body;
  // The fields the constructor's own statements must assign before `this` can be used.
  required: Set<string>;
};

// Collects a class declaration's fields and builds the constructor it compiles to.
export function declareClass(node: ClassNode & { name: string }): ClassInfo {
  if (node.abstract) throw unsupported("abstract classes", node);
  if (node.decorators.length > 0) throw unsupported("decorators", node.decorators[0]!);
  if (node.typeParams.length > 0) throw unsupported("generic classes", span(node.typeParams));
  if (node.extends) throw unsupported("'extends' clauses", node.extends);
  if (node.implements.length > 0) throw unsupported("'implements' clauses", span(node.implements));
  const fields: FieldDecl[] = [];
  const constructors = node.members.filter((m) => m.kind === "constructor");
  if (constructors.length > 1) throw new CompileError("a class can have only one constructor", constructors[1]!.start, constructors[1]!.end);
  const ctor = constructors[0];
  if (ctor && !ctor.body) throw unsupported("constructor overloads", ctor);

  for (const m of node.members) {
    if (m.kind === "constructor") continue;
    if (m.kind !== "field") throw unsupported(MEMBER_FORMS[m.kind], m);
    if (m.modifiers.includes("static")) throw unsupported("static fields", m);
    modifiers(m.modifiers, m);
    if (typeof m.name !== "string") throw unsupported("computed property names", m.name);
    if (m.name.startsWith("#")) throw unsupported("private names", m);
    if (m.optional) throw unsupported("optional fields", m);
    if (m.definite) throw unsupported("definite assignment assertions", m);
    if (!m.type && !m.init) throw new CompileError(`property '${m.name}' implicitly has an 'any' type; add a type annotation`, m.start, m.end);
    add({ name: m.name, type: m.type, init: m.init, start: m.start, end: m.end });
  }
  const properties = (ctor?.params ?? []).filter((p) => p.modifiers.length > 0).map((p) => {
    modifiers(p.modifiers, p);
    if (p.pattern.kind !== "ident") throw unsupported("destructuring patterns", p.pattern);
    return add({ name: p.pattern.name, type: p.type, init: undefined, start: p.start, end: p.end });
  });

  const type = classType(node.name);
  const prelude = [
    ...fields.filter((f) => f.init).map((f) => assignField(f.name, f.init!, f)),
    ...properties.map((f) => assignField(f.name, { kind: "ident", name: f.name, start: f.start, end: f.end }, f)),
  ];
  const constructor: Body = {
    name: `${node.name}.constructor`,
    params: ctor?.params ?? [],
    body: [...prelude, ...(ctor?.body ?? [])],
    returnType: undefined,
    self: { type, constructor: true },
    start: (ctor ?? node).start,
    end: (ctor ?? node).end,
  };
  const required = new Set(fields.filter((f) => !f.init && !properties.includes(f)).map((f) => f.name));
  return { type, fields, constructor, required };

  function add(f: FieldDecl): FieldDecl {
    if (fields.some((other) => other.name === f.name)) throw new CompileError(`duplicate property '${f.name}'`, f.start, f.end);
    fields.push(f);
    return f;
  }
}

// `this.name = value`, as a constructor statement at the span of what it came from.
function assignField(name: string, value: Expr, at: Span): Stmt {
  const s = { start: at.start, end: at.end };
  const target: Expr = { kind: "member", object: { kind: "this", ...s }, name, optional: false, ...s };
  return { kind: "expr", expr: { kind: "assign", op: "=", target, value, ...s }, ...s };
}

// Only `public` means nothing yet; access checks and `readonly` come later.
function modifiers(list: string[], at: Span) {
  const other = list.find((m) => m !== "public");
  if (other) throw unsupported(`'${other}' modifiers`, at);
}

function span(nodes: Span[]): Span {
  return { start: nodes[0]!.start, end: nodes.at(-1)!.end };
}

// What each kind of class member besides a field and the constructor is called when rejected.
const MEMBER_FORMS: Record<Exclude<ClassMember["kind"], "field" | "constructor">, string> = {
  method: "methods",
  get: "accessors",
  set: "accessors",
  index: "index signatures",
  staticBlock: "static blocks",
};
