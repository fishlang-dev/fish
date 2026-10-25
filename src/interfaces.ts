import { inherited, isLifetime, type Body, type ClassInfo } from "./classes.ts";
import type { Span } from "./parser.ts";
import { field, fits, generatorElement, keyOf, promiseElement, refType, replaced, shapeKey, show, type ClassType, type FunctionType, type InterfaceType, type Type } from "./typing.ts";

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
};

// Why the generic function `f` can't be given where the generic function type `family` is, or
// undefined when it can: as many type parameters, bounded alike, and the same signature with
// them standing for the type's.
export function familyMismatch(f: Body, family: FunctionType, members: Members, at: Span): string | undefined {
  const g = family.generic!;
  const own = (f.typeParams ?? []).filter((p) => !isLifetime(p));
  if (own.length !== g.names.length) return `it has ${own.length} type parameter${own.length === 1 ? "" : "s"}, where '${show(family)}' has ${g.names.length}`;
  const written = members.paramTypesOf(f).map(implicitBound);
  if (written.length !== family.params.length) return `it takes ${written.length} parameter${written.length === 1 ? "" : "s"}, where '${show(family)}' takes ${family.params.length}`;
  if (f.throws) return `it can throw, which '${show(family)}' doesn't say`;
  const given = members.returnOf(f, at);
  const swap = byName([...written, given], own.map((p) => p.name), g.own);
  if (members.typeParamsOf(f).some((p, i) => !sameBounds(p, g.own[i]!))) return "its type parameters' bounds differ";
  const params = written.map((p) => replaced(p, swap));
  const wrong = params.findIndex((p, i) => !same(p, family.params[i]!));
  if (wrong >= 0) return `its parameter ${wrong + 1} is '${show(params[wrong]!)}', where '${show(family)}' passes '${show(family.params[wrong]!)}'`;
  if (!fits(replaced(given, swap), family.returns)) return `it returns '${show(replaced(given, swap))}', where '${show(family)}' returns '${show(family.returns)}'`;
  return undefined;
}

// The type parameters named `names` found in `types`, each mapped to the one at its place in `to`:
// a method's own placeholders may be met as more than one object, so they are found by name.
function byName(types: Type[], names: string[], to: Type[]): Map<Type, Type> {
  const swap = new Map<Type, Type>();
  const seen = new Set<unknown>();
  const walk = (v: unknown) => {
    if (typeof v !== "object" || v === null || seen.has(v)) return;
    seen.add(v);
    const t = v as { kind?: string; name?: string };
    if (t.kind === "param" && t.name !== undefined && names.includes(t.name)) swap.set(v as Type, to[names.indexOf(t.name)]!);
    for (const child of Object.values(v)) walk(child);
  };
  types.forEach(walk);
  return swap;
}

// Whether two type parameters standing for each other have the same bound.
function sameBounds(a: Type, b: Type): boolean {
  const bound = (t: Type) => (typeof t !== "string" && t.kind === "param" ? t.bound : undefined);
  const [x, y] = [bound(a), bound(b)];
  return x === y || (x !== undefined && y !== undefined && keyOf(x) === keyOf(y));
}

// Why a value of `type` doesn't satisfy `trait`, or undefined when it does. Satisfying is
// by shape: a public field or getter of a fitting type for each of the interface's fields,
// and a public method taking exactly its parameter types and returning a fitting type for
// each of its methods. `implements` is never needed.
export function unsatisfied(type: Type, trait: InterfaceType, members: Members, at: Span): string | undefined {
  // An interface can name itself, as a builder's methods return the builder, so a pair already
  // being checked is taken as satisfied rather than checked again forever.
  const key = `${keyOf(type)} ${keyOf(trait)}`;
  if (assuming.has(key)) return undefined;
  assuming.add(key);
  try {
    return check(type, trait, members, at);
  } finally {
    assuming.delete(key);
  }
}

const assuming = new Set<string>();

// Two parameter types are one when they differ only in a reference's lifetime, which each
// method names for itself, or in how an optional field is spelled.
// A function-typed parameter of a generic method is its implicit type parameter, bounded by the
// function type written, which is what it is compared as.
function implicitBound(t: Type): Type {
  return typeof t !== "string" && t.kind === "param" && t.bound?.kind === "function" ? t.bound : t;
}

function same(a: Type, b: Type): boolean {
  [a, b] = [implicitBound(a), implicitBound(b)];
  // Function types, which each signature makes anew, are the same when their parts are.
  if (typeof a !== "string" && typeof b !== "string" && a.kind === "function" && b.kind === "function") {
    return a.params.length === b.params.length && a.params.every((p, i) => same(p, b.params[i]!)) && same(a.returns, b.returns) && a.generic?.names.length === b.generic?.names.length;
  }
  const plain = (t: Type) => shapeKey(typeof t !== "string" && t.kind === "ref" ? refType(t.to, t.mutable) : t);
  return plain(a) === plain(b);
}

function check(type: Type, trait: InterfaceType, members: Members, at: Span): string | undefined {
  // A return type fits an interface method's when it fits, or, for an interface, satisfies it.
  const returns = (actual: Type, expected: Type) =>
    typeof expected !== "string" && expected.kind === "interface" ? unsatisfied(actual, expected, members, at) === undefined : fits(actual, expected);
  const missing = (what: string, name: string) => `${what} '${name}' is missing in type '${show(type)}' but required in type '${trait.name}'`;
  if (type === trait) return undefined;
  // A type parameter has what its bound has.
  if (typeof type !== "string" && type.kind === "param") {
    return type.bound ? unsatisfied(type.bound, trait, members, at) : `type '${type.name}' has no members`;
  }
  // A future is a `Promise<T>` for exactly what it gives.
  if (typeof type !== "string" && type.kind === "future") {
    const element = promiseElement(trait);
    if (element === undefined) return `a promise has no members, which type '${trait.name}' expects`;
    return type.gives === element ? undefined : `it gives '${show(type.gives)}', not '${show(element)}'`;
  }
  // A generator is a `Generator<T>` for exactly what it yields, its `next` being its only member.
  if (typeof type !== "string" && type.kind === "generator") {
    const element = generatorElement(trait);
    if (element === undefined) return `a generator has only 'next', which type '${trait.name}' doesn't describe`;
    return type.yields === element ? undefined : `it yields '${show(type.yields)}', not '${show(element)}'`;
  }
  const c = typeof type !== "string" && type.kind === "class" ? members.classOf(type) : undefined;
  for (const f of trait.fields) {
    const own = typeof type === "string" ? undefined : field(type, f.name);
    const getter = !own && c ? inherited(c, "getters", f.name) : undefined;
    if (getter && getter.access === "public") {
      if (!fits(members.returnOf(getter, at), f.type)) return `types of property '${f.name}' are incompatible`;
      continue;
    }
    if (!own || (own.access ?? "public") !== "public") return missing("property", f.name);
    if (!fits(own.type, f.type)) return `types of property '${f.name}' are incompatible`;
  }
  for (const m of trait.methods) {
    const found = typeof type !== "string" && type.kind === "interface" ? type.methods.find((x) => x.name === m.name) : undefined;
    if (found) {
      // Generic methods are compared with their type parameters standing for each other.
      let swap = new Map<Type, Type>();
      if (m.generic || found.generic) {
        if (found.generic?.names.length !== m.generic?.names.length) return `types of method '${m.name}' are incompatible`;
        swap = byName([...found.params, found.returns], found.generic!.names, m.generic!.own);
        if (found.generic!.own.some((p, i) => !sameBounds(p, m.generic!.own[i]!))) return `types of method '${m.name}' are incompatible: their type parameters' bounds differ`;
      }
      const params = found.params.map((p) => replaced(p, swap));
      if (params.some((p, i) => !same(p, m.params[i]!)) || params.length !== m.params.length || !returns(replaced(found.returns, swap), m.returns)) {
        return `types of method '${m.name}' are incompatible`;
      }
      continue;
    }
    const method = c ? inherited(c, "methods", m.name) : undefined;
    if (!method || method.access !== "public") return missing("method", m.name);
    // An interface's methods can't declare what they throw yet, so a throwing one can't
    // stand in for one.
    if (method.throws) return `method '${m.name}' can throw, and an interface's methods can't declare errors yet`;
    // A generic method stands in for one with as many type parameters, compared with them
    // standing for the interface's.
    let swap = new Map<Type, Type>();
    const written = members.paramTypesOf(method).map(implicitBound);
    const given = members.returnOf(method, at);
    if (m.generic) {
      const own = (method.typeParams ?? []).filter((p) => !isLifetime(p));
      if (own.length !== m.generic.names.length) return `method '${m.name}' must be generic with ${m.generic.names.length} type parameter${m.generic.names.length === 1 ? "" : "s"}, as '${trait.name}' declares it`;
      swap = byName([...written, given], own.map((p) => p.name), m.generic.own);
      if (members.typeParamsOf(method).some((p, i) => !sameBounds(p, m.generic!.own[i]!))) return `types of method '${m.name}' are incompatible: its type parameters' bounds differ from '${trait.name}''s`;
    }
    const params = written.map((p) => replaced(p, swap));
    const result = replaced(given, swap);
    if (params.length !== m.params.length || params.some((p, i) => !same(p, m.params[i]!)) || !returns(result, m.returns)) {
      return `types of method '${m.name}' are incompatible`;
    }
    // An interface method's reference borrows from its receiver, so one borrowing from a
    // parameter instead can't stand in for it.
    if (typeof result !== "string" && result.kind === "ref" && result.life) {
      return `method '${m.name}' returns a reference tied to lifetime '${result.life}' of a parameter, where '${trait.name}' borrows from 'this'`;
    }
  }
  return undefined;
}
