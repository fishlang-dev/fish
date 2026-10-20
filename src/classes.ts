import { CompileError } from "./diag.ts";
import type { ClassMember, ClassNode, Expr, Param, Span, Stmt, TypeNode } from "./parser.ts";
import { classType, type Access, type ClassType } from "./typing.ts";
import { unsupported } from "./unsupported.ts";

// A function to compile: a top-level function, a static method, or a class's constructor or
// instance method, which gets its instance as `this` through a pointer. Only a constructor
// and a method declared with `this: Mut<this>` may change it.
export type Body = Span & {
  name: string;
  params: Param[];
  body: Stmt[];
  returnType: TypeNode | undefined;
  self?: { type: ClassType; constructor: boolean; mutable: boolean };
  // For a class's constructor and methods: the class, and who may call the method.
  owner?: ClassType;
  access?: Access;
};

// A field as declared: its annotation, its initializer, or both give its type.
export type FieldDecl = Span & { name: string; type: TypeNode | undefined; init: Expr | undefined; access: Access };

export type ClassInfo = {
  type: ClassType;
  fields: FieldDecl[];
  // Its body starts by assigning the field initializers, then the parameter properties.
  constructor: Body;
  // The fields the constructor's own statements must assign before `this` can be used.
  required: Set<string>;
  methods: Map<string, Body>;
  statics: Map<string, Body>;
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

  const type = classType(node.name);
  const methods = new Map<string, Body>();
  const statics = new Map<string, Body>();
  for (const m of node.members) {
    if (m.kind === "constructor") continue;
    if (m.kind === "method") {
      method(m);
      continue;
    }
    if (m.kind !== "field") throw unsupported(MEMBER_FORMS[m.kind], m);
    if (m.modifiers.includes("static")) throw unsupported("static fields", m);
    if (typeof m.name !== "string") throw unsupported("computed property names", m.name);
    const access = modifiers(m.modifiers, m, m.name);
    if (m.optional) throw unsupported("optional fields", m);
    if (m.definite) throw unsupported("definite assignment assertions", m);
    if (!m.type && !m.init) throw new CompileError(`property '${m.name}' implicitly has an 'any' type; add a type annotation`, m.start, m.end);
    add({ name: m.name, type: m.type, init: m.init, access, start: m.start, end: m.end });
  }
  const properties = (ctor?.params ?? []).filter((p) => p.modifiers.length > 0).map((p) => {
    if (p.pattern.kind !== "ident") throw unsupported("destructuring patterns", p.pattern);
    const access = modifiers(p.modifiers, p, p.pattern.name);
    return add({ name: p.pattern.name, type: p.type, init: undefined, access, start: p.start, end: p.end });
  });

  for (const name of methods.keys()) {
    const clash = fields.find((f) => f.name === name);
    if (clash) throw new CompileError(`duplicate property '${name}'`, clash.start, clash.end);
  }
  const prelude = [
    ...fields.filter((f) => f.init).map((f) => assignField(f.name, f.init!, f)),
    ...properties.map((f) => assignField(f.name, { kind: "ident", name: f.name, start: f.start, end: f.end }, f)),
  ];
  const constructor: Body = {
    name: `${node.name}.constructor`,
    params: ctor?.params ?? [],
    body: [...prelude, ...(ctor?.body ?? [])],
    returnType: undefined,
    self: { type, constructor: true, mutable: true },
    owner: type,
    start: (ctor ?? node).start,
    end: (ctor ?? node).end,
  };
  const required = new Set(fields.filter((f) => !f.init && !properties.includes(f)).map((f) => f.name));
  return { type, fields, constructor, required, methods, statics };

  function method(m: Extract<ClassMember, { kind: "method" }>) {
    const isStatic = m.modifiers.includes("static");
    if (typeof m.name !== "string") throw unsupported("computed property names", m.name);
    const access = modifiers(m.modifiers.filter((x) => x !== "static"), m, m.name);
    if (m.optional) throw unsupported("optional methods", m);
    if (m.generator) throw unsupported("generator methods", m);
    if (m.typeParams.length > 0) throw unsupported("generic methods", span(m.typeParams));
    if (!m.body) throw unsupported("method overloads", m);
    const table = isStatic ? statics : methods;
    if (table.has(m.name)) throw new CompileError(`duplicate method '${m.name}'`, m.start, m.end);
    const [first, ...rest] = m.params;
    const receiver = first?.pattern.kind === "ident" && first.pattern.name === "this" ? first : undefined;
    if (receiver && isStatic) throw new CompileError("a static method has no 'this'", receiver.start, receiver.end);
    table.set(m.name, {
      name: `${node.name}.${m.name}`,
      params: receiver ? rest : m.params,
      body: m.body,
      returnType: m.returnType,
      self: isStatic ? undefined : { type, constructor: false, mutable: receiver ? mutates(receiver) : false },
      owner: type,
      access,
      start: m.start,
      end: m.end,
    });
  }

  function add(f: FieldDecl): FieldDecl {
    if (fields.some((other) => other.name === f.name)) throw new CompileError(`duplicate property '${f.name}'`, f.start, f.end);
    fields.push(f);
    return f;
  }
}

// `this: Mut<this>` mutates the instance; `this: Ref<this>` only reads it, as the default does.
function mutates(p: Param): boolean {
  const t = p.type;
  const wraps = (name: string) => t?.kind === "ref" && t.name === name && t.args.length === 1 &&
    t.args[0]!.kind === "ref" && t.args[0]!.name === "this";
  if (wraps("Mut")) return true;
  if (wraps("Ref")) return false;
  throw unsupported("receivers other than 'this: Mut<this>' and 'this: Ref<this>'", p);
}

// `this.name = value`, as a constructor statement at the span of what it came from.
function assignField(name: string, value: Expr, at: Span): Stmt {
  const s = { start: at.start, end: at.end };
  const target: Expr = { kind: "member", object: { kind: "this", ...s }, name, optional: false, ...s };
  return { kind: "expr", expr: { kind: "assign", op: "=", target, value, ...s }, ...s };
}

// A member's access, from its modifiers or a `#` name. `readonly` and the rest come later.
function modifiers(list: string[], at: Span, name: string): Access {
  const other = list.find((m) => m !== "public" && m !== "private" && m !== "protected");
  if (other) throw unsupported(`'${other}' modifiers`, at);
  if (list.length > 1) throw new CompileError("a member can have only one accessibility modifier", at.start, at.end);
  if (name.startsWith("#") && list.length > 0) {
    throw new CompileError("an accessibility modifier can't be used with a private identifier", at.start, at.end);
  }
  return name.startsWith("#") ? "private" : (list[0] as Access | undefined) ?? "public";
}

function span(nodes: Span[]): Span {
  return { start: nodes[0]!.start, end: nodes.at(-1)!.end };
}

// What each kind of class member besides a field and the constructor is called when rejected.
const MEMBER_FORMS: Record<Exclude<ClassMember["kind"], "field" | "constructor" | "method">, string> = {
  get: "accessors",
  set: "accessors",
  index: "index signatures",
  staticBlock: "static blocks",
};
