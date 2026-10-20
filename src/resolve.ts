import { CompileError } from "./diag.ts";
import type { Param, Span, TypeAlias, TypeMember, TypeNode } from "./parser.ts";
import { objectType, type Field, type Type } from "./typing.ts";
import { TYPE_FORMS, unsupported } from "./unsupported.ts";

// Type annotations and the top-level type aliases they name, resolved to the checker's types.

export function addAlias(aliases: Map<string, TypeAlias>, s: TypeAlias) {
  if (BUILT_IN_TYPES.has(s.name)) throw new CompileError(`'${s.name}' is a built-in type`, s.start, s.end);
  if (aliases.has(s.name)) throw new CompileError(`duplicate type name '${s.name}'`, s.start, s.end);
  if (s.typeParams.length > 0) {
    throw unsupported("generic type aliases", { start: s.typeParams[0]!.start, end: s.typeParams.at(-1)!.end });
  }
  aliases.set(s.name, s);
}

export function paramName(p: Param): string {
  if (p.pattern.kind !== "ident") throw unsupported("destructuring patterns", p.pattern);
  return p.pattern.name;
}

// Resolves every alias up front, so an unused one is still checked.
export function resolver(aliases: Map<string, TypeAlias>) {
  const resolved = new Map<TypeAlias, Type>();
  const resolving = new Set<TypeAlias>();
  aliases.forEach(aliasType);
  return { resolveType, paramType };

  // TypeScript's strict mode has no implicit `any`, and Fish has no `any` at all.
  function paramType(p: Param): Type {
    if (p.rest) throw unsupported("rest parameters", p);
    if (p.optional) throw unsupported("optional parameters", p);
    const name = paramName(p);
    if (p.decorators.length > 0) throw unsupported("decorators", p);
    if (p.comptime) throw unsupported("comptime parameters", p);
    if (p.modifiers.length > 0) throw unsupported("parameter properties", p);
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
    throw new CompileError(`cannot find type '${t.name}'`, t.start, t.end);
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
    return { name: m.name, type: resolveType(m.type) };
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

