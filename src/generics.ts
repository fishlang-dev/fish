import type { Instance } from "./check.ts";
import { declareClass, isLifetime, type Body, type ClassInfo } from "./classes.ts";
import { CompileError } from "./diag.ts";
import { unsupported } from "./unsupported.ts";
import { unsatisfied, type Members } from "./interfaces.ts";
import type { ClassNode, Expr, Param, Span, TypeNode, TypeParam } from "./parser.ts";
import { field, fits, holdsRef, keyOf, lower, refType, show, typeParameter, widenEnum, wrapped, type ClassType, type InterfaceType, type ObjectType, type RefType, type Type } from "./typing.ts";

// Generic functions: the placeholders a generic body is checked with at its definition, the
// type arguments a call infers, and the bounds those arguments must satisfy.

// A bound must be an interface or an object type. Classes are nominal and embed rather than
// subclass, so a class bound could only ever mean that one class. In an instance, each
// parameter also holds the concrete type `concrete` gives it.
export function placeholders(params: TypeParam[], resolve: (t: TypeNode, scope: Map<string, Type>) => Type, concrete?: (name: string) => Type): Map<string, Type> {
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
    scope.set(p.name, concrete ? wrapped(p.name, bound, concrete(p.name)) : typeParameter(p.name, bound));
  }
  return scope;
}

// A generic class's placeholders, one set shared by its definition check and its members,
// since each new set would name another instance of the class.
function classPlaceholders(params: TypeParam[], resolve: (t: TypeNode, scope: Map<string, Type>) => Type): Map<string, Type> {
  let found = classScopes.get(params);
  if (!found) classScopes.set(params, found = placeholders(params, resolve));
  return found;
}

const classScopes = new WeakMap<TypeParam[], Map<string, Type>>();

// A body's type parameters, leaving out its lifetimes.
export function typeParamsOf(f: Body): TypeParam[] {
  return (f.typeParams ?? []).filter((p) => !isLifetime(p));
}

// Binds the type parameters `node` names by matching it against an argument's type.
export function infer(node: TypeNode, arg: Type, names: Set<string>, bindings: Map<string, Type>, at: Span) {
  if (node.kind === "ref" && node.args.length === 0 && names.has(node.name)) {
    arg = widenEnum(arg);
    const earlier = bindings.get(node.name);
    if (earlier && lower(earlier) !== lower(arg)) {
      throw new CompileError(`the type argument for '${node.name}' can't be both '${show(earlier)}' and '${show(arg)}'`, at.start, at.end);
    }
    bindings.set(node.name, arg);
    return;
  }
  // `Ref<T>` against a value or a reference borrows a T.
  if (node.kind === "ref" && (node.name === "Ref" || node.name === "Mut") && node.args.length >= 1 && !names.has(node.name)) {
    infer(node.args[0]!, typeof arg !== "string" && arg.kind === "ref" ? arg.to : arg, names, bindings, at);
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

// Whether a type has no type parameter in it, so its instance can be compiled. A class's
// fields come from its type arguments and base, so those decide it, and an object type's
// answer is kept, since its fields never change: walking nested types afresh at every level
// would take time exponential in their depth.
export function concrete(t: Type): boolean {
  if (typeof t === "string" || t.kind === "literal") return true;
  // An interface describes values without being one, so only a definition check holds one.
  if (t.kind === "param" || t.kind === "interface") return false;
  if (t.kind === "class") return (t.generic?.args.every(concrete) ?? true) && (!t.base || concrete(t.base));
  if (t.kind === "union") return t.members.every(concrete);
  if (t.kind === "ref") return concrete(t.to);
  let known = concreteObjects.get(t);
  if (known === undefined) concreteObjects.set(t, known = t.fields.every((f) => concrete(f.type)));
  return known;
}

const concreteObjects = new WeakMap<ObjectType, boolean>();

// What instantiating needs from the checker.
type Checker = {
  resolveType(t: TypeNode): Type;
  paramType(p: Param, property?: boolean): Type;
  withScope<T>(bindings: Map<string, Type>, f: () => T): T;
  members: Members;
  // The instance being checked, which new instantiations count their depth from.
  checking(): Instance | undefined;
  // The type parameters of the generic class a body belongs to, if any.
  classParams(f: Body): TypeParam[];
};

// The instances of every body: one for a plain function, and for a generic one, its
// definition check plus one per set of type arguments its calls need.
export function instancing({ resolveType, paramType, withScope, members, checking, classParams }: Checker) {
  const instances = new Map<Body, Map<string, Instance>>();
  const implicits = new Map<Body, Map<number, ObjectType | InterfaceType>>();
  // Which implicit parameters are references to their type, and how.
  const lent = new Map<Body, Map<number, RefType>>();
  const definitions = new Map<Body, Instance>();
  // Instances still to check.
  const pending: Instance[] = [];
  const all = () => [...instances.values()].flatMap((m) => [...m.values()]);
  // What a call made inside an instance passed for each type parameter, where that was one of
  // the instance's own.
  const sites = new WeakMap<Span, Map<string, Type>>();
  return { instanceOf, instantiate, paramTypes, scopeOf, declaredParams, implicitOf, definition, pending, all, siteOf: (at: Span) => sites.get(at), returnTypeOf };

  // A body's written return type. A reference to the type a reference parameter borrows is
  // to what that parameter points at, which may be wider, so a caller reads it as it is.
  function returnTypeOf(f: Body, scope: Map<string, Type>): Type | undefined {
    if (!f.returnType) return undefined;
    const t = withScope(scope, () => resolveType(f.returnType!));
    if (typeof t === "string" || t.kind !== "ref") return t;
    // Only the one parameter the result borrows from, by its lifetime or by elision.
    const implicit = implicitOf(f);
    const refs = f.params.flatMap((p, i) => {
      const type = lent.get(f)?.get(i) ?? (p.type && withScope(scope, () => resolveType(p.type!)));
      return type && typeof type !== "string" && type.kind === "ref" && (!t.life || type.life === t.life) ? [i] : [];
    });
    const [i] = refs;
    const bound = i !== undefined && refs.length === 1 && !(f.self && !f.self.constructor && !t.life) ? implicit.get(i) : undefined;
    return bound && lent.get(f)?.has(i!) && lower(t.to) === lower(bound) ? refType(scope.get(`#${i}`) ?? bound, t.mutable, t.life) : t;
  }

  // A body's parameter types as written: an implicit parameter's is its interface or object
  // type, which is what an interface's method signature is compared with.
  function declaredParams(f: Body): Type[] {
    const implicit = implicitOf(f);
    return withScope(f.scope ?? new Map(), () => f.params.map((p, i) => lentAs(f, i, implicit.get(i)) ?? paramType(p, f.self?.constructor)));
  }

  // An implicit parameter's type, borrowed when the parameter is a reference to it.
  function lentAs(f: Body, i: number, t: Type | undefined): Type | undefined {
    const ref = lent.get(f)?.get(i);
    return t && ref ? refType(t, ref.mutable, ref.life) : t;
  }

  // A generic body is checked once at its definition, with placeholders for its type
  // parameters, whether or not anything instantiates it.
  // It is made once per body: fresh placeholders would make a new instance each time.
  function definition(f: Body): Instance {
    if (!generic(f)) return instanceOf(f);
    let found = definitions.get(f);
    if (found) return found;
    const scope = explicitPlaceholders(f);
    for (const [i, bound] of implicitOf(f)) scope.set(`#${i}`, typeParameter(show(bound), bound));
    found = instanceOf(f, new Map([...(f.scope ?? []), ...scope]));
    definitions.set(f, found);
    return found;
  }

  // A member of a generic class's instance runs with the class's type arguments in scope.
  function instanceOf(f: Body, bindings = f.scope ?? new Map<string, Type>()): Instance {
    const key = [...bindings.values()].map(keyOf).join(",");
    let byKey = instances.get(f);
    if (!byKey) instances.set(f, byKey = new Map());
    let found = byKey.get(key);
    if (!found) {
      // Every type parameter, implicit ones included, needs a concrete binding to compile.
      const complete = typeParamsOf(f).every((p) => bindings.has(p.name)) && [...implicitOf(f).keys()].every((i) => bindings.has(`#${i}`));
      const isConcrete = complete && [...bindings.values()].every(concrete);
      const generic = bindings.size > 0;
      const count = [...byKey.values()].filter((i) => i.concrete).length;
      found = {
        body: f, symbol: generic && isConcrete ? `${f.name}#${count}` : f.name, bindings, concrete: isConcrete,
        depth: generic && checking() ? checking()!.depth + 1 : 0, returns: "void",
        types: new Map(), locals: new Map(), calls: new Map(), setters: new Map(), coercions: new Map(), jumps: new Map(), borrowsFrom: new Map(),
      };
      byKey.set(key, found);
      pending.push(found);
    }
    return found;
  }

  // The instance a call runs: a generic function's type arguments come from the call, or are
  // inferred from its arguments, and must satisfy their bounds.
  function instantiate(f: Body, typeArgs: TypeNode[], args: Expr[], argTypes: Type[], at: Span): Instance {
    const params = typeParamsOf(f);
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
      if (holdsRef(type)) throw unsupported("references as type arguments", at);
      if (typeof type !== "string" && type.kind === "interface") {
        throw new CompileError(`an interface can't be a type argument, since it describes values without being one`, at.start, at.end);
      }
    }
    withScope(bindings, () => params.forEach((p) => p.constraint && checkBound(bindings.get(p.name)!, resolveType(p.constraint), members, at)));
    // An argument from inside another instance may be one of its type parameters; the instance
    // is keyed by what that stands for, and the call site remembers the parameter itself.
    const own = new Map(params.map((p): [string, Type] => [p.name, bindings.get(p.name)!]));
    for (const [i, bound] of implicitOf(f)) own.set(`#${i}`, implicitArgument(args[i]!, argTypes[i]!, bound, lent.get(f)!.has(i)));
    const lowered = new Map([...own].map(([name, t]): [string, Type] => [name, lower(t)]));
    // Every instance of the calling body shares the call's node, so each call resets it.
    if ([...own].some(([name, t]) => lowered.get(name) !== t)) sites.set(at, own);
    else sites.delete(at);
    const instance = instanceOf(f, new Map([...(f.scope ?? []), ...lowered]));
    if (instance.depth > 64) throw new CompileError(`instantiating '${f.name}' never ends: each instance needs another with larger type arguments`, at.start, at.end);
    return instance;
  }

  // The parameter types an instance's callers pass, or with `scopeOf(instance)`, the ones its
  // body sees.
  function paramTypes(instance: Instance, scope = instance.bindings): Type[] {
    const f = instance.body;
    const implicit = implicitOf(f);
    return withScope(scope, () => f.params.map((p, i) =>
      lentAs(f, i, scope.get(`#${i}`) ?? implicit.get(i)) ?? paramType(p, f.self?.constructor)));
  }

  // What a concrete instance's body sees: each of its type parameters, and those of a generic
  // class it belongs to, offering only its bound, as at the definition, while holding the
  // concrete type for codegen.
  function scopeOf(instance: Instance): Map<string, Type> {
    const f = instance.body;
    const known = (names: string[]) => names.every((n) => instance.bindings.has(n) && concrete(instance.bindings.get(n)!));
    const stands = (name: string) => instance.bindings.get(name)!;
    const outer = classParams(f);
    const scope = outer.length > 0 && known(outer.map((p) => p.name)) ? placeholders(outer, (t, s) => withScope(s, () => resolveType(t)), stands) : new Map(f.scope);
    const names = [...typeParamsOf(f).map((p) => p.name), ...[...implicitOf(f).keys()].map((i) => `#${i}`)];
    if (!known(names)) return outer.length > 0 ? scope : instance.bindings;
    for (const [name, t] of placeholders(typeParamsOf(f), (t, s) => withScope(new Map([...scope, ...s]), () => resolveType(t)), stands)) scope.set(name, t);
    for (const [i, bound] of implicitOf(f)) scope.set(`#${i}`, wrapped(show(bound), bound, stands(`#${i}`)));
    return scope;
  }

  function generic(f: Body): boolean {
    return typeParamsOf(f).length > 0 || implicitOf(f).size > 0;
  }

  function explicitPlaceholders(f: Body): Map<string, Type> {
    return placeholders(typeParamsOf(f), (t, scope) => withScope(scope, () => resolveType(t)));
  }

  // A parameter typed with an interface or an object type is an implicit type parameter, so
  // each concrete argument type gets its own instance instead of being copied down. A
  // parameter property and a setter's parameter keep their type, since it is a field's.
  function implicitOf(f: Body): Map<number, ObjectType | InterfaceType> {
    let found = implicits.get(f);
    if (found) return found;
    found = new Map();
    implicits.set(f, found);
    // A generic class's member decides this as its definition does: a parameter of the class's
    // type parameter is one in every instance, whatever that parameter stands for.
    const outer = classPlaceholders(classParams(f), (t, s) => withScope(s, () => resolveType(t)));
    const scope = new Map([...(f.scope ?? []), ...outer, ...explicitPlaceholders(f)]);
    const borrows = new Map<number, RefType>();
    lent.set(f, borrows);
    withScope(scope, () => f.params.forEach((p, i) => {
      const written = p.type && resolveType(p.type);
      // A reference to an interface or object type is one over what it borrows.
      const type = written && typeof written !== "string" && written.kind === "ref" ? written.to : written;
      if (!type || typeof type === "string" || p.modifiers.length > 0) return;
      if (f.accessor && type.kind === "interface") {
        throw new CompileError(`a setter's parameter can't have the interface type '${type.name}'`, p.start, p.end);
      }
      if (!f.accessor && (type.kind === "interface" || (type.kind === "object" && concrete(type)))) {
        found!.set(i, type);
        if (written !== type) borrows.set(i, written as RefType);
      }
    }));
    return found;
  }

  // What an implicit type parameter stands for in a call: the argument's own type, which must
  // satisfy the parameter's. A fresh object literal takes the declared object type instead, so
  // it gets TypeScript's excess property check.
  function implicitArgument(arg: Expr, type: Type, bound: ObjectType | InterfaceType, borrowed: boolean): Type {
    // A borrowed argument stands for what it is, or what it refers to.
    if (borrowed && typeof type !== "string" && type.kind === "ref") type = type.to;
    else if (typeof type !== "string" && type.kind === "ref") {
      throw new CompileError("can't move a value out of a reference to it, which only borrows it; use '.clone()' to hand over a copy", arg.start, arg.end);
    }
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

// What generic classes need from the checker.
type ClassChecker = {
  classes: Map<string, ClassInfo>;
  templates: Map<string, ClassNode & { name: string }>;
  register(c: ClassInfo): void;
  layout(c: ClassInfo): void;
  members: Members;
  resolveType(t: TypeNode): Type;
  withScope<T>(bindings: Map<string, Type>, f: () => T): T;
};

// Generic classes: each set of type arguments declares the class again, on first use.
export function genericClasses({ classes, templates, register, layout, members, resolveType, withScope }: ClassChecker) {
  // Where each instance was first used, and each template's instances by their arguments.
  const uses = new Map<ClassInfo, Span>();
  const instancesOf = new Map<ClassNode, Map<string, ClassInfo>>();
  // An instance made while the resolver is still being built waits for `start` to check its
  // bounds and lay it out, since both need the resolver.
  let ready = false;
  return { classNamed, construct, start, define };

  function start() {
    ready = true;
    uses.forEach((_, c) => bounded(c));
  }

  // A generic class, like a generic body, is checked once at its definition with
  // placeholders for its type parameters, whether or not anything instantiates it.
  function define() {
    templates.forEach((t) => classInstance(t, [...classPlaceholders(t.typeParams, (n, s) => withScope(s, () => resolveType(n))).values()], t));
  }

  function classNamed(name: string, args: Type[], at: Span): ClassType | undefined {
    const c = classes.get(name);
    if (c && args.length > 0) throw new CompileError(`type '${name}' is not generic`, at.start, at.end);
    if (c) return c.type;
    const template = templates.get(name);
    return template && classInstance(template, args, at).type;
  }

  // The class a generic class's type arguments make, declared on first use, checked for its
  // bounds, and named like `Box<i64>`.
  function classInstance(template: ClassNode & { name: string }, args: Type[], at: Span): ClassInfo {
    const params = template.typeParams;
    if (args.length !== params.length) {
      throw new CompileError(`type '${template.name}' expects ${params.length} type argument${params.length === 1 ? "" : "s"}, but got ${args.length}`, at.start, at.end);
    }
    let byKey = instancesOf.get(template);
    if (!byKey) instancesOf.set(template, byKey = new Map());
    const key = args.map(keyOf).join(",");
    const found = byKey.get(key);
    if (found) return found;
    if (byKey.size > 64) throw new CompileError(`instantiating '${template.name}' never ends: each instance needs another with larger type arguments`, at.start, at.end);
    if (args.some((a) => typeof a !== "string" && a.kind === "interface")) throw new CompileError("an interface can't be a type argument, since it describes values without being one", at.start, at.end);
    if (args.some(holdsRef)) throw unsupported("references as type arguments", at);
    const scope = new Map(params.map((p, i) => [p.name, args[i]!]));
    const c = declareClass(template, `${template.name}<${args.map(show).join(", ")}>`, scope);
    byKey.set(key, c);
    register(c);
    uses.set(c, at);
    if (ready) bounded(c);
    return c;
  }

  // A generic class's type arguments must satisfy their bounds, checked where it is first used.
  function bounded(c: ClassInfo) {
    const at = uses.get(c)!;
    withScope(c.scope, () => c.node.typeParams.forEach((p) => p.constraint && checkBound(c.scope.get(p.name)!, resolveType(p.constraint), members, at)));
    layout(c);
  }

  // The class a `new` builds; a generic one's type arguments come from the expression or are
  // inferred from the constructor's arguments.
  function construct(name: string, typeArgs: TypeNode[], argTypes: Type[], at: Span): ClassInfo | undefined {
    const c = classes.get(name);
    if (c && typeArgs.length > 0) throw new CompileError(`type '${name}' is not generic`, at.start, at.end);
    const template = templates.get(name);
    if (!template) return c;
    if (typeArgs.length > 0) return classInstance(template, typeArgs.map(resolveType), at);
    const ctor = template.members.find((m) => m.kind === "constructor");
    const names = new Set(template.typeParams.map((p) => p.name));
    const bindings = new Map<string, Type>();
    ctor?.params.forEach((p, i) => p.type && argTypes[i] && infer(p.type, argTypes[i]!, names, bindings, at));
    const args = template.typeParams.map((p) => {
      const type = bindings.get(p.name);
      if (!type) throw new CompileError(`can't infer a type for '${p.name}'; pass the type arguments explicitly`, at.start, at.end);
      return type;
    });
    return classInstance(template, args, at);
  }
}
