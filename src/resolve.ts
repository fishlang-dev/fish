import { CompileError } from "./diag.ts";
import type { Expr, Interface, Param, Span, TypeAlias, TypeMember, TypeNode } from "./parser.ts";
import type { EnumInfo } from "./enums.ts";
import { placeholders } from "./generics.ts";
import { interfaceType, keyOf, literalType, objectType, show, unionType, type ClassType, type Field, type InterfaceType, type Method, type ObjectType, type Type } from "./typing.ts";
import { TYPE_FORMS, unsupported } from "./unsupported.ts";

// Type annotations and the top-level type aliases they name, resolved to the checker's types.

// Aliases, classes and interfaces share one namespace of type names.
export function addAlias(aliases: Map<string, TypeAlias>, s: TypeAlias, ...others: Map<string, unknown>[]) {
  typeName(s.name, s, aliases, ...others);
  aliases.set(s.name, s);
}
export function paramName(p: Param): string {
  if (p.pattern.kind !== "ident") throw unsupported("destructuring patterns", p.pattern);
  return p.pattern.name;
}

export function typeName(name: string, at: Span, ...namespaces: Map<string, unknown>[]) {
  if (BUILT_IN_TYPES.has(name)) throw new CompileError(`'${name}' is a built-in type`, at.start, at.end);
  if (namespaces.some((n) => n.has(name))) throw new CompileError(`duplicate type name '${name}'`, at.start, at.end);
}

// A field holds a value, and an interface type describes values without being one.
export function storable(type: Type, at: Span): Type {
  if (typeof type !== "string" && type.kind === "interface") {
    throw new CompileError(`a field can't have the interface type '${type.name}'; use a type parameter instead`, at.start, at.end);
  }
  return type;
}

// The class a name and type arguments refer to; a generic one is instantiated on first use.
type ClassNamed = (name: string, args: Type[], at: Span) => ClassType | undefined;

// Resolves every alias and interface up front, so an unused one is still checked. A generic
// alias is checked with placeholders for its type parameters, and resolved again per set of
// type arguments.
export function resolver(aliases: Map<string, TypeAlias>, classNamed: ClassNamed, interfaces: Map<string, Interface>, enums: Map<string, EnumInfo>) {
  const resolved = new Map<string, Type>();
  const resolving = new Set<string>();
  const traits = new Map<Interface, InterfaceType>();
  // The type parameters in scope, bound to what they stand for in the body being checked.
  let scope = new Map<string, Type>();
  aliases.forEach((a) => {
    const scope = placeholders(a.typeParams, (t, s) => withScope(s, () => resolveType(t)));
    aliasType(a, [...scope.values()], a);
  });
  interfaces.forEach(interfaceOf);
  return { resolveType, paramType, withScope };

  function withScope<T>(bindings: Map<string, Type>, f: () => T): T {
    const outer = scope;
    scope = bindings;
    try {
      return f();
    } finally {
      scope = outer;
    }
  }

  // TypeScript's strict mode has no implicit `any`, and Fish has no `any` at all. Only a
  // constructor's parameters may carry modifiers, which make them parameter properties.
  function paramType(p: Param, property = false): Type {
    if (p.rest) throw unsupported("rest parameters", p);
    if (p.optional) throw unsupported("optional parameters", p);
    const name = paramName(p);
    if (p.decorators.length > 0) throw unsupported("decorators", p);
    if (p.comptime) throw unsupported("comptime parameters", p);
    if (p.modifiers.length > 0 && !property) throw unsupported("parameter properties", p);
    if (name === "this") throw unsupported("'this' parameters", p);
    if (p.default) throw unsupported("default parameter values", p);
    if (!p.type) throw new CompileError(`parameter '${name}' implicitly has an 'any' type; add a type annotation`, p.start, p.end);
    return resolveType(p.type);
  }

  function resolveType(t: TypeNode): Type {
    if (t.kind === "operator") throw unsupported(`'${t.op}' types`, t);
    if (t.kind === "function") throw unsupported(t.construct ? "constructor types" : "function types", t);
    if (t.kind === "object") return objectType(fields(t.members.map(member), t.members));
    if (t.kind === "literal") return literal(t.value);
    if (t.kind === "union") return unionType(t.types.map(unionMember));
    if (t.kind === "intersection") return intersection(t.types);
    if (t.kind !== "ref") throw unsupported(TYPE_FORMS[t.kind], t);
    const bound = scope.get(t.name);
    if (bound && t.args.length === 0) return bound;
    if (t.name === "i64" || t.name === "boolean" || t.name === "void" || t.name === "number") {
      if (t.args.length > 0) throw new CompileError(`type '${t.name}' is not generic`, t.start, t.end);
      if (t.name === "number") throw new CompileError("'number' (a 64-bit float) is not supported yet; use i64", t.start, t.end);
      return t.name;
    }
    if (t.name === "Array" || t.name === "ReadonlyArray") throw unsupported("array types", t);
    if (t.name === "null" || t.name === "undefined") throw new CompileError(`'${t.name}' is Option in Fish, which is not supported yet`, t.start, t.end);
    const args = t.args.map(resolveType);
    const alias = aliases.get(t.name);
    if (alias) return aliasType(alias, args, t);
    const named = classNamed(t.name, args, t);
    if (named) return named;
    const [owner, name] = t.name.split(".");
    const e = enums.get(owner!);
    if (e && name === undefined) return e.type;
    if (e && e.members.has(name!)) return e.members.get(name!)!;
    const trait = interfaces.get(t.name);
    if (trait && args.length > 0) throw unsupported("generic interfaces", t);
    if (trait) return interfaceOf(trait);
    throw new CompileError(`cannot find type '${t.name}'`, t.start, t.end);
  }

  // A union holds values, so an interface, which describes values without being one, can't be
  // a member, and neither can `void`.
  function unionMember(node: TypeNode): Type {
    const t = resolveType(node);
    if (t === "void") throw new CompileError("'void' can't be a union member", node.start, node.end);
    if (typeof t !== "string" && t.kind === "interface") throw new CompileError(`an interface can't be a union member; '${t.name}' describes values without being one`, node.start, node.end);
    if (typeof t !== "string" && t.kind === "param") throw unsupported("unions holding a type parameter", node);
    return t;
  }

  function literal(e: Expr): Type {
    if (e.kind === "string" || e.kind === "bool") return literalType(e.value);
    const negative = e.kind === "unary" && e.op === "-";
    const digits = negative ? e.operand : e;
    if (digits.kind !== "int") throw unsupported("literal types of this kind", e);
    const value = negative ? -digits.value : digits.value;
    if (value > I64_MAX || value < -I64_MAX - 1n) throw new CompileError("integer literal does not fit in i64", e.start, e.end);
    return literalType(value);
  }

  // `A & B` of object types is one object type with the fields of both.
  function intersection(nodes: TypeNode[]): Type {
    const sides = nodes.map((node) => {
      const t = resolveType(node);
      if (typeof t !== "string" && t.kind === "object") return t;
      if (typeof t !== "string" && t.kind === "interface") throw unsupported("intersections with interfaces", node);
      throw unsupported(`intersections with ${typeof t === "string" || t.kind === "literal" ? "primitive types" : SIDE_FORMS[t.kind]}`, node);
    });
    return sides.reduce((a, b) => merged(a, b, nodes[0]!, nodes.at(-1)!));
  }

  // The interface is registered before its members resolve, so a member may name it.
  function interfaceOf(i: Interface): InterfaceType {
    const found = traits.get(i);
    if (found) return found;
    const t = interfaceType(i.name);
    traits.set(i, t);
    if (i.typeParams.length > 0) throw unsupported("generic interfaces", { start: i.typeParams[0]!.start, end: i.typeParams.at(-1)!.end });
    const add = (name: string, at: Span) => {
      if (t.fields.some((f) => f.name === name) || t.methods.some((m) => m.name === name)) {
        throw new CompileError(`duplicate member '${name}' in interface '${i.name}'`, at.start, at.end);
      }
    };
    for (const node of i.extends) {
      const base = resolveType(node);
      if (typeof base === "string" || base.kind !== "interface") throw new CompileError("an interface can only extend interfaces", node.start, node.end);
      for (const f of base.fields) add(f.name, node), t.fields.push(f);
      for (const m of base.methods) add(m.name, node), t.methods.push(m);
    }
    for (const m of i.members) {
      if (m.kind === "method") {
        if (typeof m.name !== "string") throw unsupported("computed property names", m.name);
        if (m.optional) throw unsupported("optional methods", m);
        if (m.typeParams.length > 0) throw unsupported("generic methods", m);
        if (!m.returns) throw new CompileError(`method '${m.name}' implicitly returns 'any'; add a return type`, m.start, m.end);
        add(m.name, m);
        const method: Method = { name: m.name, params: m.params.map((p) => paramType(p)), returns: resolveType(m.returns) };
        t.methods.push(method);
      } else {
        const f = member(m);
        add(f.name, m);
        t.fields.push(f);
      }
    }
    return t;
  }

  // An object type holds its fields inline, so one that contains itself has no finite size.
  function aliasType(a: TypeAlias, args: Type[], at: Span): Type {
    if (args.length !== a.typeParams.length) {
      throw new CompileError(`type '${a.name}' expects ${a.typeParams.length} type argument${a.typeParams.length === 1 ? "" : "s"}, but got ${args.length}`, at.start, at.end);
    }
    const key = `${a.name}<${args.map(keyOf).join(",")}>`;
    const done = resolved.get(key);
    if (done) return done;
    if (resolving.has(key) || resolving.size > 64) throw new CompileError(`type '${a.name}' refers to itself, so it would have infinite size`, a.start, a.end);
    resolving.add(key);
    const type = withScope(new Map(a.typeParams.map((p, i) => [p.name, args[i]!])), () => resolveType(a.type));
    resolving.delete(key);
    resolved.set(key, type);
    return type;
  }

  function member(m: TypeMember): Field {
    if (m.kind !== "property") throw unsupported(MEMBER_FORMS[m.kind], m);
    if (typeof m.name !== "string") throw unsupported("computed property names", m.name);
    if (m.optional) throw unsupported("optional properties", m);
    if (!m.type) throw new CompileError(`property '${m.name}' implicitly has an 'any' type; add a type annotation`, m.start, m.end);
    return { name: m.name, type: storable(resolveType(m.type), m), ...(m.readonly && { readonly: true }) };
  }
}

// A field both sides of `&` declare keeps its type, merging nested object types; other types
// conflict, since no value could have both. It is readonly only when both sides say so, as in
// TypeScript.
function merged(a: ObjectType, b: ObjectType, from: Span, to: Span): ObjectType {
  const fields = [...a.fields];
  for (const f of b.fields) {
    const i = fields.findIndex((g) => g.name === f.name);
    const g = fields[i];
    if (!g) {
      fields.push(f);
      continue;
    }
    const both = typeof g.type !== "string" && g.type.kind === "object" && typeof f.type !== "string" && f.type.kind === "object";
    if (g.type !== f.type && !both) {
      throw new CompileError(`property '${f.name}' has type '${show(g.type)}' on one side of '&' and '${show(f.type)}' on the other`, from.start, to.end);
    }
    const type = both ? merged(g.type as ObjectType, f.type as ObjectType, from, to) : f.type;
    fields[i] = { name: f.name, type, ...(g.readonly && f.readonly && { readonly: true }) };
  }
  return objectType(fields);
}

// What each other kind of type is called when it can't be a side of `&`.
const SIDE_FORMS = { class: "classes", param: "type parameters", union: "unions", interface: "interfaces", object: "object types" };

const I64_MAX = (1n << 63n) - 1n;

const BUILT_IN_TYPES = new Set(["i64", "boolean", "void", "number"]);

// What each kind of object type member besides a property is called when rejected.
const MEMBER_FORMS = {
  method: "methods in object types",
  call: "call signatures",
  construct: "construct signatures",
  index: "index signatures",
  get: "accessors in object types",
  set: "accessors in object types",
};

// Fields with their source spans, checked for a name given twice.
export function fields(list: Field[], at: Span[]): Field[] {
  list.forEach((f, i) => {
    if (list.findIndex((other) => other.name === f.name) !== i) throw new CompileError(`duplicate property '${f.name}'`, at[i]!.start, at[i]!.end);
  });
  return list;
}

