import { inherited, type Body, type ClassInfo } from "./classes.ts";
import type { Span } from "./parser.ts";
import { field, fits, generatorElement, keyOf, promiseElement, refType, shapeOf, show, type ClassType, type InterfaceType, type Type } from "./typing.ts";

// What satisfying an interface needs from the checker: a class's members and their types.
export type Members = {
  classOf(t: ClassType): ClassInfo;
  returnOf(f: Body, at: Span): Type;
  // A method's parameter types, resolved with its class's type arguments.
  paramTypesOf(f: Body): Type[];
};

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
function same(a: Type, b: Type): boolean {
  const plain = (t: Type) => shapeOf(typeof t !== "string" && t.kind === "ref" ? refType(t.to, t.mutable) : t);
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
      if (found.params.some((p, i) => !same(p, m.params[i]!)) || found.params.length !== m.params.length || !returns(found.returns, m.returns)) {
        return `types of method '${m.name}' are incompatible`;
      }
      continue;
    }
    const method = c ? inherited(c, "methods", m.name) : undefined;
    if (!method || method.access !== "public") return missing("method", m.name);
    // An interface's methods can't declare what they throw yet, so a throwing one can't
    // stand in for one.
    if (method.throws) return `method '${m.name}' can throw, and an interface's methods can't declare errors yet`;
    const params = members.paramTypesOf(method);
    const result = members.returnOf(method, at);
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
