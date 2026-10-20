import type { Instance } from "./check.ts";
import type { Body } from "./classes.ts";
import { CompileError } from "./diag.ts";
import { unsatisfied, type Members } from "./interfaces.ts";
import type { Expr, Param, Span, TypeNode, TypeParam } from "./parser.ts";
import { field, fits, keyOf, show, typeParameter, type InterfaceType, type ObjectType, type Type } from "./typing.ts";

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
  // `Box<T>` against `Box<i64>` matches the type arguments.
  if (node.kind === "ref" && typeof arg !== "string" && arg.kind === "class" && arg.generic?.name === node.name) {
    node.args.forEach((n, i) => arg.generic!.args[i] && infer(n, arg.generic!.args[i]!, names, bindings, at));
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

// What instantiating needs from the checker.
type Checker = {
  resolveType(t: TypeNode): Type;
  paramType(p: Param, property?: boolean): Type;
  withScope<T>(bindings: Map<string, Type>, f: () => T): T;
  members: Members;
  // The instance being checked, which new instantiations count their depth from.
  checking(): Instance | undefined;
};

// The instances of every body: one for a plain function, and for a generic one, its
// definition check plus one per set of type arguments its calls need.
export function instancing({ resolveType, paramType, withScope, members, checking }: Checker) {
  const instances = new Map<Body, Map<string, Instance>>();
  const implicits = new Map<Body, Map<number, ObjectType | InterfaceType>>();
  // Instances still to check.
  const pending: Instance[] = [];
  const all = () => [...instances.values()].flatMap((m) => [...m.values()]);
  return { instanceOf, instantiate, paramTypes, definition, pending, all };

  // A generic body is checked once at its definition, with placeholders for its type
  // parameters, whether or not anything instantiates it.
  function definition(f: Body): Instance {
    if (!generic(f)) return instanceOf(f);
    const scope = explicitPlaceholders(f);
    for (const [i, bound] of implicitOf(f)) scope.set(`#${i}`, typeParameter(show(bound), bound));
    return instanceOf(f, new Map([...(f.scope ?? []), ...scope]));
  }

  // A member of a generic class's instance runs with the class's type arguments in scope.
  function instanceOf(f: Body, bindings = f.scope ?? new Map<string, Type>()): Instance {
    const key = [...bindings.values()].map(keyOf).join(",");
    let byKey = instances.get(f);
    if (!byKey) instances.set(f, byKey = new Map());
    let found = byKey.get(key);
    if (!found) {
      const isConcrete = [...bindings.values()].every(concrete);
      const generic = bindings.size > 0;
      const count = [...byKey.values()].filter((i) => i.concrete).length;
      found = {
        body: f, symbol: generic && isConcrete ? `${f.name}#${count}` : f.name, bindings, concrete: isConcrete,
        depth: generic && checking() ? checking()!.depth + 1 : 0, returns: "void",
        types: new Map(), locals: new Map(), calls: new Map(), setters: new Map(), coercions: new Map(), jumps: new Map(),
      };
      byKey.set(key, found);
      pending.push(found);
    }
    return found;
  }

  // The instance a call runs: a generic function's type arguments come from the call, or are
  // inferred from its arguments, and must satisfy their bounds.
  function instantiate(f: Body, typeArgs: TypeNode[], args: Expr[], argTypes: Type[], at: Span): Instance {
    const params = f.typeParams ?? [];
    if (typeArgs.length > 0 && typeArgs.length !== params.length) {
      throw new CompileError(`expected ${params.length} type argument${params.length === 1 ? "" : "s"}, but got ${typeArgs.length}`, at.start, at.end);
    }
    if (!generic(f)) return instanceOf(f);
    if (args.length !== f.params.length) {
      throw new CompileError(`expected ${f.params.length} argument${f.params.length === 1 ? "" : "s"}, but got ${args.length}`, at.start, at.end);
    }
    const bindings = new Map<string, Type>();
    if (typeArgs.length > 0) {
      params.forEach((p, i) => bindings.set(p.name, resolveType(typeArgs[i]!)));
    } else {
      const names = new Set(params.map((p) => p.name));
      f.params.forEach((p, i) => p.type && argTypes[i] && infer(p.type, argTypes[i]!, names, bindings, at));
    }
    for (const p of params) {
      const type = bindings.get(p.name);
      if (!type) throw new CompileError(`can't infer a type for '${p.name}'; pass the type arguments explicitly`, at.start, at.end);
      if (typeof type !== "string" && type.kind === "interface") {
        throw new CompileError(`an interface can't be a type argument, since it describes values without being one`, at.start, at.end);
      }
    }
    withScope(bindings, () => params.forEach((p) => p.constraint && checkBound(bindings.get(p.name)!, resolveType(p.constraint), members, at)));
    const ordered = new Map([...(f.scope ?? []), ...params.map((p): [string, Type] => [p.name, bindings.get(p.name)!])]);
    for (const [i, bound] of implicitOf(f)) ordered.set(`#${i}`, implicitArgument(args[i]!, argTypes[i]!, bound));
    const instance = instanceOf(f, ordered);
    if (instance.depth > 64) throw new CompileError(`instantiating '${f.name}' never ends: each instance needs another with larger type arguments`, at.start, at.end);
    return instance;
  }

  function paramTypes(instance: Instance): Type[] {
    const f = instance.body;
    const implicit = implicitOf(f);
    return withScope(instance.bindings, () => f.params.map((p, i) =>
      instance.bindings.get(`#${i}`) ?? implicit.get(i) ?? paramType(p, f.self?.constructor)));
  }

  function generic(f: Body): boolean {
    return (f.typeParams?.length ?? 0) > 0 || implicitOf(f).size > 0;
  }

  function explicitPlaceholders(f: Body): Map<string, Type> {
    return placeholders(f.typeParams ?? [], (t, scope) => withScope(scope, () => resolveType(t)));
  }

  // A parameter typed with an interface or an object type is an implicit type parameter, so
  // each concrete argument type gets its own instance instead of being copied down.
  // Constructors and accessors keep such a parameter as it is, since its type is a field's.
  function implicitOf(f: Body): Map<number, ObjectType | InterfaceType> {
    let found = implicits.get(f);
    if (found) return found;
    found = new Map();
    implicits.set(f, found);
    if (f.self?.constructor || f.accessor) return found;
    const scope = new Map([...(f.scope ?? []), ...explicitPlaceholders(f)]);
    withScope(scope, () => f.params.forEach((p, i) => {
      const type = p.type && resolveType(p.type);
      if (type && typeof type !== "string" && (type.kind === "interface" || (type.kind === "object" && concrete(type)))) found!.set(i, type);
    }));
    return found;
  }

  // What an implicit type parameter stands for in a call: the argument's own type, which must
  // satisfy the parameter's. A fresh object literal takes the declared object type instead, so
  // it gets TypeScript's excess property check.
  function implicitArgument(arg: Expr, type: Type, bound: ObjectType | InterfaceType): Type {
    const message = `argument of type '${show(type)}' is not assignable to parameter of type '${show(bound)}'`;
    if (bound.kind === "interface") {
      const reason = unsatisfied(type, bound, members, arg);
      if (reason) throw new CompileError(`${message}: ${reason}`, arg.start, arg.end);
      return type;
    }
    if (!fits(type, bound)) throw new CompileError(message, arg.start, arg.end);
    return arg.kind === "object" ? bound : type;
  }
}
