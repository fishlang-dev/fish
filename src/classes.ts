import { CompileError } from "./diag.ts";
import type { ClassMember, ClassNode, Expr, Param, Span, Stmt, TypeNode, TypeParam } from "./parser.ts";
import { classType, type Access, type ClassType, type FunctionType, type Type } from "./typing.ts";
import { unsupported } from "./unsupported.ts";
import type { Instance } from "./check.ts";

// A function to compile: a top-level function, a static method, or a class's constructor or
// instance method, which gets its instance as `this` through a pointer. Only a constructor
// and a method declared with `this: Mut<this>` may change it.
export type Body = Span & {
  name: string;
  params: Param[];
  body: Stmt[];
  returnType: TypeNode | undefined;
  // A generic function's type parameters; each set of type arguments gets its own instance.
  typeParams?: TypeParam[];
  // An accessor's parameter is the property's type, so it is never generic.
  accessor?: boolean;
  // For a member of a generic class's instance: what the class's type parameters stand for.
  scope?: Map<string, Type>;
  // `owned`: a method declared `this: Own<this>` takes its object over.
  self?: { type: ClassType; constructor: boolean; mutable: boolean; owned?: boolean };
  // For a class's constructor and methods: the class, and who may call the method.
  owner?: ClassType;
  access?: Access;
  // An arrow function's body, checked inside the instance it is written in. An expression body
  // is a `return` of it, `value`.
  // `expected`, the function type it is given to, types parameters it leaves unwritten.
  // `move`: it captures everything by value.
  closure?: { value?: Expr; parent: Instance; expected?: FunctionType; move: boolean };
};

// A type parameter bounded by `Lifetime` names a lifetime, which is checked and erased rather
// than instantiated.
export const isLifetime = (p: TypeParam) => p.constraint?.kind === "ref" && p.constraint.name === "Lifetime" && p.constraint.args.length === 0;

// A field as declared: its annotation, its initializer, or both give its type.
export type FieldDecl = Span & { name: string; type: TypeNode | undefined; init: Expr | undefined; access: Access; readonly: boolean };

export type ClassInfo = {
  type: ClassType;
  fields: FieldDecl[];
  // Its body starts by assigning the field initializers, then the parameter properties.
  constructor: Body;
  // Every field, each unset until a constructor statement assigns it; until then `this` may
  // only appear as the target of such an assignment.
  required: Set<string>;
  // The prelude's field initializers, which can't see the constructor's parameters.
  initializers: Set<Stmt>;
  methods: Map<string, Body>;
  statics: Map<string, Body>;
  // A getter borrows `this` and returns a value; a setter takes `Mut<this>` and the value.
  getters: Map<string, Body>;
  setters: Map<string, Body>;
  // The class this one embeds and delegates to, named by `extends`.
  baseName: string | undefined;
  base?: ClassInfo;
  // The initializers and parameter properties a derived constructor runs after `super(...)`.
  prelude: Stmt[];
  node: ClassNode;
  // For an instance of a generic class: what its type parameters stand for.
  scope: Map<string, Type>;
};

// Collects a class declaration's fields and builds the constructor it compiles to. A generic
// class is declared once per set of type arguments, under a name like `Box<i64>`, with
// `scope` saying what its type parameters stand for.
export function declareClass(node: ClassNode & { name: string }, name = node.name, scope = new Map<string, Type>()): ClassInfo {
  if (node.abstract) throw unsupported("abstract classes", node);
  if (node.decorators.length > 0) throw unsupported("decorators", node.decorators[0]!);
  if (node.typeParams.length > 0 && node.extends) throw unsupported("generic classes that use 'extends'", node.extends);
  if (node.extends && node.extends.kind !== "ident") {
    throw unsupported(node.extends.kind === "instantiation" ? "generic base classes" : "base class expressions", node.extends);
  }
  const fields: FieldDecl[] = [];
  const constructors = node.members.filter((m) => m.kind === "constructor");
  if (constructors.length > 1) throw new CompileError("a class can have only one constructor", constructors[1]!.start, constructors[1]!.end);
  const ctor = constructors[0];
  if (ctor && !ctor.body) throw unsupported("constructor overloads", ctor);

  const type = classType(name, scope.size > 0 ? { name: node.name, args: [...scope.values()] } : undefined);
  const methods = new Map<string, Body>();
  const statics = new Map<string, Body>();
  const getters = new Map<string, Body>();
  const setters = new Map<string, Body>();
  for (const m of node.members) {
    if (m.kind === "constructor") continue;
    if (m.kind === "method") {
      method(m);
      continue;
    }
    if (m.kind === "get" || m.kind === "set") {
      accessor(m);
      continue;
    }
    if (m.kind !== "field") throw unsupported(MEMBER_FORMS[m.kind], m);
    if (m.modifiers.includes("static")) throw unsupported("static fields", m);
    if (typeof m.name !== "string") throw unsupported("computed property names", m.name);
    const access = modifiers(m.modifiers, m, m.name);
    if (m.definite) throw unsupported("definite assignment assertions", m);
    if (!m.type && !m.init) throw new CompileError(`property '${m.name}' implicitly has an 'any' type; add a type annotation`, m.start, m.end);
    // An optional field is an Option, empty until assigned.
    const at = { start: m.start, end: m.end };
    const type: TypeNode | undefined = m.optional && m.type ? { kind: "union", types: [m.type, { kind: "ref", name: "null", args: [], ...at }], ...at } : m.type;
    const init: Expr | undefined = m.optional ? (m.init ?? { kind: "null", ...at }) : m.init;
    add({ name: m.name, type, init, access, readonly: m.modifiers.includes("readonly"), start: m.start, end: m.end });
  }
  const properties = (ctor?.params ?? []).filter((p) => p.modifiers.length > 0).map((p) => {
    if (p.pattern.kind !== "ident") throw unsupported("destructuring patterns", p.pattern);
    const access = modifiers(p.modifiers, p, p.pattern.name);
    // An optional parameter property is an Option, as the parameter is.
    const at = { start: p.start, end: p.end };
    const type: TypeNode | undefined = p.optional && p.type ? { kind: "union", types: [p.type, { kind: "ref", name: "null", args: [], ...at }], ...at } : p.type;
    return add({ name: p.pattern.name, type, init: undefined, access, readonly: p.modifiers.includes("readonly"), start: p.start, end: p.end });
  });

  for (const name of [...methods.keys(), ...getters.keys(), ...setters.keys()]) {
    const clash = fields.find((f) => f.name === name);
    if (clash) throw new CompileError(`duplicate property '${name}'`, clash.start, clash.end);
    if (methods.has(name) && (getters.has(name) || setters.has(name))) {
      const m = methods.get(name)!;
      throw new CompileError(`duplicate property '${name}'`, m.start, m.end);
    }
  }
  // As in TypeScript, parameter properties are assigned before field initializers run.
  const initializers = fields.filter((f) => f.init).map((f) => assignField(f.name, f.init!, f));
  const prelude = [
    ...properties.map((f) => assignField(f.name, { kind: "ident", name: f.name, start: f.start, end: f.end }, f)),
    ...initializers,
  ];
  const constructor: Body = {
    name: `${name}.constructor`,
    scope,
    params: ctor?.params ?? [],
    body: [...prelude, ...(ctor?.body ?? [])],
    returnType: undefined,
    self: { type, constructor: true, mutable: true },
    owner: type,
    start: (ctor ?? node).start,
    end: (ctor ?? node).end,
  };
  const required = new Set(fields.map((f) => f.name));
  const baseName = node.extends?.kind === "ident" ? node.extends.name : undefined;
  return { type, fields, constructor, required, initializers: new Set(initializers), scope, methods, statics, getters, setters, baseName, prelude, node };

  function accessor(m: Extract<ClassMember, { kind: "get" | "set" }>) {
    if (m.modifiers.includes("static")) throw unsupported("static accessors", m);
    if (typeof m.name !== "string") throw unsupported("computed property names", m.name);
    const access = modifiers(m.modifiers, m, m.name);
    if (m.name === "constructor") throw new CompileError("'constructor' can't be the name of an accessor", m.start, m.end);
    if (!m.body) throw unsupported("accessors without a body", m);
    const table = m.kind === "get" ? getters : setters;
    if (table.has(m.name)) throw new CompileError(`duplicate ${m.kind === "get" ? "getter" : "setter"} '${m.name}'`, m.start, m.end);
    if (m.kind === "set" && m.params.length !== 1) throw new CompileError("a setter takes exactly one parameter", m.start, m.end);
    if (m.kind === "set" && m.returnType) throw new CompileError("a setter can't have a return type annotation", m.returnType.start, m.returnType.end);
    table.set(m.name, {
      name: `${name}.${m.kind} ${m.name}`,
      scope,
      params: m.params,
      body: m.body,
      returnType: m.returnType,
      self: { type, constructor: false, mutable: m.kind === "set" },
      accessor: true,
      owner: type,
      access,
      start: m.start,
      end: m.end,
    });
  }

  function method(m: Extract<ClassMember, { kind: "method" }>) {
    const isStatic = m.modifiers.includes("static");
    if (isStatic && node.typeParams.length > 0) throw unsupported("static methods in generic classes", m);
    if (typeof m.name !== "string") throw unsupported("computed property names", m.name);
    const access = modifiers(m.modifiers.filter((x) => x !== "static"), m, m.name);
    if (m.optional) throw unsupported("optional methods", m);
    if (m.generator) throw unsupported("generator methods", m);
    if (m.typeParams.some((p) => !isLifetime(p))) throw unsupported("generic methods", span(m.typeParams));
    if (!m.body) throw unsupported("method overloads", m);
    if (m.name === "constructor") throw new CompileError("'constructor' can't be the name of a method", m.start, m.end);
    const table = isStatic ? statics : methods;
    if (table.has(m.name)) throw new CompileError(`duplicate method '${m.name}'`, m.start, m.end);
    const [first, ...rest] = m.params;
    const receiver = first?.pattern.kind === "ident" && first.pattern.name === "this" ? first : undefined;
    if (receiver && isStatic) throw new CompileError("a static method has no 'this'", receiver.start, receiver.end);
    table.set(m.name, {
      // A static method has its own symbol, since an instance method may share its name.
      name: `${name}.${isStatic ? "static " : ""}${m.name}`,
      scope,
      params: receiver ? rest : m.params,
      body: m.body,
      returnType: m.returnType,
      typeParams: m.typeParams,
      self: isStatic ? undefined : { type, constructor: false, mutable: receiver ? mutates(receiver) : false, owned: receiver ? owns(receiver) : false },
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

// Links a derived class to the base it embeds. Its constructor must start with
// `super(...)`, which fills the embedded base, and then assigns its own initializers. Without
// a constructor of its own it passes its arguments on to the base's.
export function extend(c: ClassInfo, base: ClassInfo) {
  c.base = base;
  c.type.base = base.type;
  for (let b: ClassInfo | undefined = base; b; b = b.base) {
    const redeclared = c.fields.find((f) => b.fields.some((g) => g.name === f.name));
    if (redeclared) {
      throw new CompileError(`'${redeclared.name}' is already a field of '${b.type.name}'; with 'extends' as embedding it would be a second, separate field`, redeclared.start, redeclared.end);
    }
  }
  const explicit = c.node.members.find((m) => m.kind === "constructor");
  const at = { start: c.constructor.start, end: c.constructor.end };
  if (explicit) {
    const [first, ...rest] = c.constructor.body.slice(c.prelude.length);
    if (first?.kind !== "expr" || first.expr.kind !== "call" || first.expr.callee.kind !== "super") {
      throw new CompileError("a derived class's constructor must start with 'super(...)'", at.start, at.end);
    }
    c.constructor.body = [first, ...c.prelude, ...rest];
    return;
  }
  // Copies, so each constructor has its own parameters, and none of them is a property here.
  const params = base.constructor.params.map((p) => ({ ...p, modifiers: [] }));
  const args: Expr[] = params.map((p) => ({ kind: "ident", name: (p.pattern as { name: string }).name, start: p.start, end: p.end }));
  const call: Expr = { kind: "call", callee: { kind: "super", ...at }, typeArgs: [], args, optional: false, ...at };
  c.constructor.params = params;
  c.constructor.body = [{ kind: "expr", expr: call, ...at }, ...c.prelude];
}

// A member of a class or of the bases it embeds, nearest first.
export function inherited(c: ClassInfo, table: "methods" | "statics" | "getters" | "setters", name: string): Body | undefined {
  for (let b: ClassInfo | undefined = c; b; b = b.base) {
    const found = b[table].get(name);
    if (found) return found;
  }
  return undefined;
}

// With embedding, a base's own use of `this.m` keeps reaching the base's `m`, where
// TypeScript would reach an override. Overriding such a member is an error rather than a
// silent change in meaning; overriding one the base never reaches through `this` is fine.
export function checkOverrides(c: ClassInfo) {
  const own = [...c.methods, ...c.getters, ...c.setters];
  for (let b = c.base; b; b = b.base) {
    for (const [name, m] of own) {
      if (b.fields.some((f) => f.name === name)) throw new CompileError(`'${name}' is already a field of '${b.type.name}'`, m.start, m.end);
      const inherited = b.methods.has(name) || b.getters.has(name) || b.setters.has(name);
      if (inherited && usesOnThis(b.node.members, name)) {
        throw new CompileError(
          `overriding '${name}' is an error here: '${b.type.name}' reaches it through 'this', and with 'extends' as embedding that would still run '${b.type.name}.${name}'; extract an interface instead`,
          m.start, m.end);
      }
    }
  }
}

// Whether any node under `node` is `this.name`.
function usesOnThis(node: unknown, name: string): boolean {
  if (typeof node !== "object" || node === null) return false;
  if (Array.isArray(node)) return node.some((n) => usesOnThis(n, name));
  const n = node as { kind?: string; object?: { kind?: string }; name?: unknown };
  if (n.kind === "member" && n.object?.kind === "this" && n.name === name) return true;
  return Object.values(node).some((v) => usesOnThis(v, name));
}

// `this: Mut<this>` mutates the instance; `this: Ref<this>` only reads it, as the default does.
function mutates(p: Param): boolean {
  if (wraps(p, "Mut") || wraps(p, "Own")) return true;
  if (wraps(p, "Ref")) return false;
  throw unsupported("receivers other than 'this: Ref<this>', 'this: Mut<this>' and 'this: Own<this>'", p);
}

// `this: Own<this>` takes the object over: an owner may change it too.
const owns = (p: Param) => wraps(p, "Own");

function wraps(p: Param, name: string): boolean {
  const t = p.type;
  return t?.kind === "ref" && t.name === name && t.args.length === 1 && t.args[0]!.kind === "ref" && t.args[0]!.name === "this";
}

// `this.name = value`, as a constructor statement at the span of what it came from.
function assignField(name: string, value: Expr, at: Span): Stmt {
  const s = { start: at.start, end: at.end };
  const target: Expr = { kind: "member", object: { kind: "this", ...s }, name, optional: false, ...s };
  return { kind: "expr", expr: { kind: "assign", op: "=", target, value, ...s }, ...s };
}

// A member's access, from its modifiers or a `#` name. `readonly` is read by the caller.
function modifiers(list: string[], at: Span, name: string): Access {
  const other = list.find((m) => m !== "public" && m !== "private" && m !== "protected" && m !== "readonly");
  if (other) throw unsupported(`'${other}' modifiers`, at);
  list = list.filter((m) => m !== "readonly");
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
const MEMBER_FORMS: Record<Exclude<ClassMember["kind"], "field" | "constructor" | "method" | "get" | "set">, string> = {
  index: "index signatures",
  staticBlock: "static blocks",
};
