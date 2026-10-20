import { CompileError } from "./diag.ts";
import { unsatisfied, type Members } from "./interfaces.ts";
import type { Span, TypeNode, TypeParam } from "./parser.ts";
import { field, fits, show, typeParameter, type InterfaceType, type ObjectType, type Type } from "./typing.ts";

// Generic functions: the placeholders a generic body is checked with at its definition, the
// type arguments a call infers, and the bounds those arguments must satisfy.

// A bound must be an interface or an object type. Classes are nominal and embed rather than
// subclass, so a class bound could only ever mean that one class.
export function placeholders(params: TypeParam[], resolve: (t: TypeNode, scope: Map<string, Type>) => Type): Map<string, Type> {
  const scope = new Map<string, Type>();
  for (const p of params) {
    if (p.modifiers.length > 0) throw new CompileError(`'${p.modifiers[0]}' type parameters are not supported yet`, p.start, p.end);
    if (p.default) throw new CompileError("default type arguments are not supported yet", p.default.start, p.default.end);
    let bound: ObjectType | InterfaceType | undefined;
    if (p.constraint) {
      const t = resolve(p.constraint, scope);
      if (typeof t === "string" || (t.kind !== "interface" && t.kind !== "object")) {
        throw new CompileError(`a type parameter's bound must be an interface or an object type, not '${show(t)}'`, p.constraint.start, p.constraint.end);
      }
      bound = t;
    }
    scope.set(p.name, typeParameter(p.name, bound));
  }
  return scope;
}

// Binds the type parameters `node` names by matching it against an argument's type.
export function infer(node: TypeNode, arg: Type, names: Set<string>, bindings: Map<string, Type>, at: Span) {
  if (node.kind === "ref" && node.args.length === 0 && names.has(node.name)) {
    const earlier = bindings.get(node.name);
    if (earlier && earlier !== arg) {
      throw new CompileError(`the type argument for '${node.name}' can't be both '${show(earlier)}' and '${show(arg)}'`, at.start, at.end);
    }
    bindings.set(node.name, arg);
    return;
  }
  if (node.kind !== "object" || typeof arg === "string") return;
  for (const m of node.members) {
    if (m.kind !== "property" || typeof m.name !== "string" || !m.type) continue;
    const found = field(arg, m.name);
    if (found) infer(m.type, found.type, names, bindings, at);
  }
}

// A type argument must satisfy its parameter's bound: an interface by shape, an object type
// by fitting it.
export function checkBound(type: Type, bound: Type, members: Members, at: Span) {
  const reason = typeof bound !== "string" && bound.kind === "interface" ? unsatisfied(type, bound, members, at)
    : fits(type, bound) ? undefined : "";
  if (reason === undefined) return;
  throw new CompileError(`type '${show(type)}' does not satisfy the constraint '${show(bound)}'${reason ? `: ${reason}` : ""}`, at.start, at.end);
}

// Whether a type has no type parameter in it, so its instance can be compiled.
export function concrete(t: Type): boolean {
  if (typeof t === "string") return true;
  if (t.kind === "param") return false;
  return t.kind === "interface" || t.fields.every((f) => concrete(f.type));
}
