import { CompileError } from "./diag.ts";
import type { Interface, Param, Span, TypeAlias, TypeMember, TypeNode } from "./parser.ts";
import { interfaceType, objectType, type ClassType, type Field, type InterfaceType, type Method, type Type } from "./typing.ts";
import { TYPE_FORMS, unsupported } from "./unsupported.ts";

// Type annotations and the top-level type aliases they name, resolved to the checker's types.

// Aliases, classes and interfaces share one namespace of type names.
export function addAlias(aliases: Map<string, TypeAlias>, s: TypeAlias, ...others: Map<string, unknown>[]) {
  typeName(s.name, s, aliases, ...others);
  if (s.typeParams.length > 0) {
    throw unsupported("generic type aliases", { start: s.typeParams[0]!.start, end: s.typeParams.at(-1)!.end });
  }
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

// Resolves every alias and interface up front, so an unused one is still checked.
export function resolver(aliases: Map<string, TypeAlias>, classes: Map<string, ClassType>, interfaces: Map<string, Interface>) {
  const resolved = new Map<TypeAlias, Type>();
  const resolving = new Set<TypeAlias>();
  const traits = new Map<Interface, InterfaceType>();
  aliases.forEach(aliasType);
  interfaces.forEach(interfaceOf);
  return { resolveType, paramType };

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
    if (t.kind !== "ref") throw unsupported(TYPE_FORMS[t.kind], t);
    if (t.args.length > 0) throw unsupported("generic types", t);
    if (t.name === "i64" || t.name === "boolean" || t.name === "void") return t.name;
    if (t.name === "number") throw new CompileError("'number' (a 64-bit float) is not supported yet; use i64", t.start, t.end);
    const alias = aliases.get(t.name);
    if (alias) return aliasType(alias);
    const named = classes.get(t.name);
    if (named) return named;
    const trait = interfaces.get(t.name);
    if (trait) return interfaceOf(trait);
    throw new CompileError(`cannot find type '${t.name}'`, t.start, t.end);
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
  function aliasType(a: TypeAlias): Type {
    const done = resolved.get(a);
    if (done) return done;
    if (resolving.has(a)) throw new CompileError(`type '${a.name}' refers to itself, so it would have infinite size`, a.start, a.end);
    resolving.add(a);
    const type = resolveType(a.type);
    resolving.delete(a);
    resolved.set(a, type);
    return type;
  }

  function member(m: TypeMember): Field {
    if (m.kind !== "property") throw unsupported(MEMBER_FORMS[m.kind], m);
    if (typeof m.name !== "string") throw unsupported("computed property names", m.name);
    if (m.optional) throw unsupported("optional properties", m);
    if (m.readonly) throw unsupported("'readonly' properties", m);
    if (!m.type) throw new CompileError(`property '${m.name}' implicitly has an 'any' type; add a type annotation`, m.start, m.end);
    return { name: m.name, type: storable(resolveType(m.type), m) };
  }
}

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

