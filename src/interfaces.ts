import type { Arenas } from "./arenas.ts";
import { inherited, isLifetime, type Body, type ClassInfo } from "./classes.ts";
import type { Span } from "./parser.ts";
import { TypeMap, TypeSet, type ClassType, type FunctionType, type InterfaceType, type Type, type Typing } from "./typing.ts";

// What satisfying an interface needs from the checker: a class's members and their types.
export type Members = {
  classOf(t: ClassType): ClassInfo;
  returnOf(f: Body, at: Span): Type;
  // A method's parameter types, resolved with its class's type arguments.
  paramTypesOf(f: Body): Type[];
  // A generic method's own type parameters' placeholders, in order.
  typeParamsOf(f: Body): Type[];
  // A function declared at the top level, or lifted there, by its name.
  bodyNamed(name: string): Body | undefined;
  typing: Typing;
  arenas: Arenas;
  // The pairs of a type and an interface being checked, each taken as satisfied while it is.
  assuming: Set<string>;
};

// Why the generic function `f` can't be given where the generic function type `family` is, or
// undefined when it can: as many type parameters, bounded alike, and the same signature with
// them standing for the type's.
export function familyMismatch(f: Body, family: FunctionType, members: Members, at: Span): string | undefined {
  const { typing } = members;
  const g = typing.rec(family).generic!;
  const own = (f.typeParams ?? []).filter((p) => !isLifetime(p));
  if (own.length !== g.names.length) return `it has ${own.length} type parameter${own.length === 1 ? "" : "s"}, where '${typing.show(family)}' has ${g.names.length}`;
  const written = members.paramTypesOf(f).map((p) => implicitBound(typing, p));
  if (written.length !== typing.rec(family).params.length) return `it takes ${written.length} parameter${written.length === 1 ? "" : "s"}, where '${typing.show(family)}' takes ${typing.rec(family).params.length}`;
  if (f.throws) return `it can throw, which '${typing.show(family)}' doesn't say`;
  const given = members.returnOf(f, at);
  const swap = byName(typing, [...written, given], own.map((p) => p.name), g.own);
  if (members.typeParamsOf(f).some((p, i) => !sameBounds(typing, p, g.own[i]!))) return "its type parameters' bounds differ";
  const params = written.map((p) => typing.replaced(p, swap));
  const wrong = params.findIndex((p, i) => !same(typing, p, typing.rec(family).params[i]!));
  if (wrong >= 0) return `its parameter ${wrong + 1} is '${typing.show(params[wrong]!)}', where '${typing.show(family)}' passes '${typing.show(typing.rec(family).params[wrong]!)}'`;
  if (!typing.fits(typing.replaced(given, swap), typing.rec(family).returns)) return `it returns '${typing.show(typing.replaced(given, swap))}', where '${typing.show(family)}' returns '${typing.show(typing.rec(family).returns)}'`;
  return undefined;
}

// The type parameters named `names` found in `types`, each mapped to the one at its place in `to`:
// a method's own placeholders may be met as more than one type, so they are found by name.
function byName(typing: Typing, types: Type[], names: string[], to: Type[]): TypeMap<Type, Type> {
  const swap = new TypeMap<Type, Type>();
  const seen = new TypeSet<Type>();
  const walk = (t: Type) => {
    if (typeof t === "string" || seen.has(t)) return;
    seen.add(t);
    const r = typing.rec(t);
    if (r.kind === "param" && names.includes(r.name)) swap.set(t, to[names.indexOf(r.name)]!);
    typing.links(t).forEach(walk);
  };
  types.forEach(walk);
  return swap;
}

// Whether two type parameters standing for each other have the same bound.
function sameBounds(typing: Typing, a: Type, b: Type): boolean {
  const bound = (t: Type) => {
    const r = typeof t === "string" ? undefined : typing.rec(t);
    return r?.kind === "param" ? r.bound : undefined;
  };
  const [x, y] = [bound(a), bound(b)];
  return x === y || (x !== undefined && y !== undefined && typing.keyOf(x) === typing.keyOf(y));
}

// Why a value of `type` doesn't satisfy `trait`, or undefined when it does. Satisfying is
// by shape: a public field or getter of a fitting type for each of the interface's fields,
// and a public method taking exactly its parameter types and returning a fitting type for
// each of its methods. `implements` is never needed.
export function unsatisfied(type: Type, trait: InterfaceType, members: Members, at: Span): string | undefined {
  const { assuming, typing } = members;
  // An interface can name itself, as a builder's methods return the builder, so a pair already
  // being checked is taken as satisfied rather than checked again forever.
  const key = `${typing.keyOf(type)} ${typing.keyOf(trait)}`;
  if (assuming.has(key)) return undefined;
  assuming.add(key);
  try {
    return check(type, trait, members, at);
  } finally {
    assuming.delete(key);
  }
}

// Two parameter types are one when they differ only in a reference's lifetime, which each
// method names for itself, or in how an optional field is spelled.
// A function-typed parameter of a generic method is its implicit type parameter, bounded by the
// function type written, which is what it is compared as.
function implicitBound(typing: Typing, t: Type): Type {
  const r = typeof t === "string" ? undefined : typing.rec(t);
  return r?.kind === "param" && typing.recOf(r.bound)?.kind === "function" ? r.bound! : t;
}

function same(typing: Typing, a: Type, b: Type): boolean {
  [a, b] = [implicitBound(typing, a), implicitBound(typing, b)];
  const [x, y] = [a, b].map((t) => (typeof t === "string" ? undefined : typing.rec(t)));
  // Function types, which each signature makes anew, are the same when their parts are.
  if (x?.kind === "function" && y?.kind === "function") {
    return x.params.length === y.params.length && x.params.every((p, i) => same(typing, p, y.params[i]!)) && same(typing, x.returns, y.returns) && x.generic?.names.length === y.generic?.names.length;
  }
  const plain = (t: Type) => {
    const r = typeof t === "string" ? undefined : typing.rec(t);
    return typing.shapeKey(r?.kind === "ref" ? typing.refType(r.to, r.mutable) : t);
  };
  return plain(a) === plain(b);
}

function check(type: Type, trait: InterfaceType, members: Members, at: Span): string | undefined {
  const { typing } = members;
  // A return type fits an interface method's when it fits, or, for an interface, satisfies it.
  const returns = (actual: Type, expected: Type) => {
    const r = typeof expected === "string" ? undefined : typing.rec(expected);
    return r?.kind === "interface" ? unsatisfied(actual, expected as InterfaceType, members, at) === undefined : typing.fits(actual, expected);
  };
  const missing = (what: string, name: string) => `${what} '${name}' is missing in type '${typing.show(type)}' but required in type '${typing.rec(trait).name}'`;
  if (type === trait) return undefined;
  const t = typeof type === "string" ? undefined : typing.rec(type);
  // A type parameter has what its bound has.
  if (t?.kind === "param") {
    return t.bound ? unsatisfied(t.bound, trait, members, at) : `type '${t.name}' has no members`;
  }
  // A future is a `Promise<T>` for exactly what it gives, a type parameter's union in an
  // instance being the one it flattens into.
  if (t?.kind === "future") {
    const element = typing.promiseElement(trait);
    if (element === undefined) return `a promise has no members, which type '${typing.rec(trait).name}' expects`;
    return typing.lower(t.gives) === typing.lower(element) ? undefined : `it gives '${typing.show(t.gives)}', not '${typing.show(element)}'`;
  }
  // A generator is a `Generator<T>` for exactly what it yields, its `next` being its only member.
  if (t?.kind === "generator") {
    const element = typing.generatorElement(trait, t.async);
    if (element === undefined) return `${t.async ? "an async" : "a"} generator has only 'next', which type '${typing.rec(trait).name}' doesn't describe`;
    return typing.lower(t.yields) === typing.lower(element) ? undefined : `it yields '${typing.show(t.yields)}', not '${typing.show(element)}'`;
  }
  const c = t?.kind === "class" ? members.classOf(type as ClassType) : undefined;
  for (const f of typing.rec(trait).fields) {
    const own = typeof type === "string" ? undefined : typing.field(type, f.name);
    const getter = !own && c ? inherited(members.arenas, c, "getters", f.name) : undefined;
    if (getter && getter.access === "public") {
      if (!typing.fits(members.returnOf(getter, at), f.type)) return `types of property '${f.name}' are incompatible`;
      continue;
    }
    if (!own || (own.access ?? "public") !== "public") return missing("property", f.name);
    if (!typing.fits(own.type, f.type)) return `types of property '${f.name}' are incompatible`;
  }
  for (const m of typing.rec(trait).methods) {
    const found = t?.kind === "interface" ? t.methods.find((x) => x.name === m.name) : undefined;
    if (found) {
      // Generic methods are compared with their type parameters standing for each other.
      let swap = new TypeMap<Type, Type>();
      if (m.generic || found.generic) {
        if (found.generic?.names.length !== m.generic?.names.length) return `types of method '${m.name}' are incompatible`;
        swap = byName(typing, [...found.params, found.returns], found.generic!.names, m.generic!.own);
        if (found.generic!.own.some((p, i) => !sameBounds(typing, p, m.generic!.own[i]!))) return `types of method '${m.name}' are incompatible: their type parameters' bounds differ`;
      }
      const params = found.params.map((p) => typing.replaced(p, swap));
      if (params.some((p, i) => !same(typing, p, m.params[i]!)) || params.length !== m.params.length || !returns(typing.replaced(found.returns, swap), m.returns)) {
        return `types of method '${m.name}' are incompatible`;
      }
      continue;
    }
    const method = c ? inherited(members.arenas, c, "methods", m.name) : undefined;
    if (!method || method.access !== "public") return missing("method", m.name);
    // An interface's methods can't declare what they throw yet, so a throwing one can't
    // stand in for one.
    if (method.throws) return `method '${m.name}' can throw, and an interface's methods can't declare errors yet`;
    // A generic method stands in for one with as many type parameters, compared with them
    // standing for the interface's.
    let swap = new TypeMap<Type, Type>();
    const written = members.paramTypesOf(method).map((p) => implicitBound(typing, p));
    const given = members.returnOf(method, at);
    if (m.generic) {
      const own = (method.typeParams ?? []).filter((p) => !isLifetime(p));
      if (own.length !== m.generic.names.length) return `method '${m.name}' must be generic with ${m.generic.names.length} type parameter${m.generic.names.length === 1 ? "" : "s"}, as '${typing.rec(trait).name}' declares it`;
      swap = byName(typing, [...written, given], own.map((p) => p.name), m.generic.own);
      if (members.typeParamsOf(method).some((p, i) => !sameBounds(typing, p, m.generic!.own[i]!))) return `types of method '${m.name}' are incompatible: its type parameters' bounds differ from '${typing.rec(trait).name}''s`;
    }
    const params = written.map((p) => typing.replaced(p, swap));
    const result = typing.replaced(given, swap);
    if (params.length !== m.params.length || params.some((p, i) => !same(typing, p, m.params[i]!)) || !returns(result, m.returns)) {
      return `types of method '${m.name}' are incompatible`;
    }
    // An interface method's reference borrows from its receiver, so one borrowing from a
    // parameter instead can't stand in for it.
    const r = typeof result === "string" ? undefined : typing.rec(result);
    if (r?.kind === "ref" && r.life) {
      return `method '${m.name}' returns a reference tied to lifetime '${r.life}' of a parameter, where '${typing.rec(trait).name}' borrows from 'this'`;
    }
  }
  return undefined;
}
