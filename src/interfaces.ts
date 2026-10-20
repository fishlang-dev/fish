import { inherited, type Body, type ClassInfo } from "./classes.ts";
import type { Span } from "./parser.ts";
import { field, fits, show, type ClassType, type InterfaceType, type Type } from "./typing.ts";

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
  // A return type fits an interface method's when it fits, or, for an interface, satisfies it.
  const returns = (actual: Type, expected: Type) =>
    typeof expected !== "string" && expected.kind === "interface" ? unsatisfied(actual, expected, members, at) === undefined : fits(actual, expected);
  const missing = (what: string, name: string) => `${what} '${name}' is missing in type '${show(type)}' but required in type '${trait.name}'`;
  if (type === trait) return undefined;
  // A type parameter has what its bound has.
  if (typeof type !== "string" && type.kind === "param") {
    return type.bound ? unsatisfied(type.bound, trait, members, at) : `type '${type.name}' has no members`;
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
      if (found.params.some((p, i) => p !== m.params[i]) || found.params.length !== m.params.length || !returns(found.returns, m.returns)) {
        return `types of method '${m.name}' are incompatible`;
      }
      continue;
    }
    const method = c ? inherited(c, "methods", m.name) : undefined;
    if (!method || method.access !== "public") return missing("method", m.name);
    const params = members.paramTypesOf(method);
    if (params.length !== m.params.length || params.some((p, i) => p !== m.params[i]) || !returns(members.returnOf(method, at), m.returns)) {
      return `types of method '${m.name}' are incompatible`;
    }
  }
  return undefined;
}
