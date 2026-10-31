import { holdsNode, type Instance } from "./check.ts";
import { declareClass, isLifetime, type Body, type ClassInfo } from "./classes.ts";
import { CompileError } from "./diag.ts";
import type { Tables } from "./compilation.ts";
import { unsupported } from "./unsupported.ts";
import { familyMismatch, unsatisfied, type Members } from "./interfaces.ts";
import type { ClassNode, Expr, Id, Param, Span, Stmt, TypeNode, TypeParam } from "./parser.ts";
import { paramName, unboxedClosure } from "./resolve.ts";
import { INTERIORS, digest, unfold, elementsOf, field, holdsPart, widenLet, type FunctionType, isTuple, widenEnum, type Bound, type ClassType, type InterfaceType, type ObjectType, type RefType, type Type, type VariantType, type Typing } from "./typing.ts";
import { NodeMap, NodeSet } from "./nodes.ts";

// Generic functions: the placeholders a generic body is checked with at its definition, the
// type arguments a call infers, and the bounds those arguments must satisfy.

// A bound must be an interface or an object type. Classes are nominal and embed rather than
// subclass, so a class bound could only ever mean that one class. In an instance, each
// parameter also holds the concrete type `concrete` gives it.
export function placeholders({ show, wrapped, typeParameter }: Typing, params: TypeParam[], resolve: (t: TypeNode, scope: Map<string, Type>) => Type, concrete?: (name: string) => Type): Map<string, Type> {
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
function classPlaceholders({ typing, classScopes }: Tables, params: TypeParam[], resolve: (t: TypeNode, scope: Map<string, Type>) => Type): Map<string, Type> {
  let found = classScopes.get(params);
  if (!found) classScopes.set(params, found = placeholders(typing, params, resolve));
  return found;
}

// A body's type parameters, leaving out its lifetimes.
export function typeParamsOf(f: Body): TypeParam[] {
  return (f.typeParams ?? []).filter((p) => !isLifetime(p));
}

// Binds the type parameters `node` names by matching it against an argument's type, looking
// through the check's type aliases.
export function infer(tables: Tables, node: TypeNode, arg: Type, names: Set<string>, bindings: Map<string, Type>, at: Span) {
  const { aliases, expanding, typing: { sameCallable, heldArgument, sameLowered, show, yieldsOf, withoutNull, arrayType } } = tables;
  arg = unfold(arg);
  // `Pair<T>` naming a generic alias matches what the alias stands for, its parameters given
  // as written.
  const alias = node.kind === "ref" && node.args.length > 0 && !names.has(node.name) ? aliases.get(node.name) : undefined;
  if (node.kind === "ref" && alias && alias.typeParams.length === node.args.length && !expanding.has(alias.name)) {
    const given = new Map(alias.typeParams.map((p, i) => [p.name, node.args[i]!]));
    expanding.add(alias.name);
    try {
      return infer(tables, substituted(alias.type, given), arg, names, bindings, at);
    } finally {
      expanding.delete(alias.name);
    }
  }
  if (node.kind === "ref" && node.args.length === 0 && names.has(node.name)) {
    arg = widenEnum(arg);
    const earlier = bindings.get(node.name);
    // A closure meeting T already decided as the stored callable it fits is boxed into it, as one
    // given first is boxed where the body holds T in a type argument.
    if (earlier && sameCallable(earlier, heldArgument(arg))) return;
    if (earlier && sameCallable(heldArgument(earlier), arg)) {
      bindings.set(node.name, arg);
      return;
    }
    // A literal and its base type, as a string literal and a callback taking a string give,
    // agree on the base type, as TypeScript widens them.
    if (earlier && earlier !== arg && widenLet(earlier) === widenLet(arg)) {
      bindings.set(node.name, widenLet(arg));
      return;
    }
    if (earlier && !(sameLowered(earlier, arg) && sameLowered(arg, earlier))) {
      throw new CompileError(`the type argument for '${node.name}' can't be both '${show(earlier)}' and '${show(arg)}'`, at.start, at.end);
    }
    bindings.set(node.name, arg);
    return;
  }
  // `Ref<T>` against a value or a reference borrows a T.
  if (node.kind === "ref" && (node.name === "Ref" || node.name === "Mut") && node.args.length >= 1 && !names.has(node.name)) {
    infer(tables, node.args[0]!, typeof arg !== "string" && arg.kind === "ref" ? arg.to : arg, names, bindings, at);
    return;
  }
  // A function type against a closure binds through its parameters and what it gives.
  if (node.kind === "function" && typeof arg !== "string" && arg.kind === "closure") {
    node.params.forEach((p, i) => p.type && arg.params[i] !== undefined && infer(tables, p.type, arg.params[i]!, names, bindings, at));
    if (arg.returns !== "void" || node.returns.kind !== "ref" || !names.has(node.returns.name)) infer(tables, node.returns, arg.returns, names, bindings, at);
    if (node.throws && arg.throws) infer(tables, node.throws, arg.throws, names, bindings, at);
    return;
  }
  // `Ptr<T>` against a raw pointer points at a T.
  if (node.kind === "ref" && (node.name === "Ptr" || node.name === "MutPtr") && node.args.length === 1 && !names.has(node.name)) {
    if (typeof arg !== "string" && arg.kind === "pointer") infer(tables, node.args[0]!, arg.to, names, bindings, at);
    return;
  }
  // `Lock<T>` against a Lock holds a T.
  if (node.kind === "ref" && INTERIORS.has(node.name) && node.args.length === 1 && !names.has(node.name)) {
    if (typeof arg !== "string" && arg.kind === "interior" && arg.which === node.name) infer(tables, node.args[0]!, arg.of, names, bindings, at);
    return;
  }
  if (node.kind === "ref" && node.name === "Channel" && node.args.length === 1 && !names.has(node.name)) {
    if (typeof arg !== "string" && arg.kind === "block" && arg.which === "Channel") infer(tables, node.args[0]!, arg.of, names, bindings, at);
    return;
  }
  // `Map<K, V>` and `Set<T>` against one match their key and value types.
  if (node.kind === "ref" && (node.name === "Map" || node.name === "Set") && !names.has(node.name)) {
    if (typeof arg !== "string" && arg.kind === "map" && arg.set === (node.name === "Set")) {
      if (node.args[0]) infer(tables, node.args[0], arg.key, names, bindings, at);
      if (node.args[1]) infer(tables, node.args[1], arg.value, names, bindings, at);
    }
    return;
  }
  if (node.kind === "ref" && node.name === "shared" && node.args.length === 1 && !names.has(node.name)) {
    if (typeof arg !== "string" && arg.kind === "shared") infer(tables, node.args[0]!, arg.of, names, bindings, at);
    return;
  }
  // `Box<T>` against `Box<i64>` matches the type arguments.
  if (node.kind === "ref" && typeof arg !== "string" && arg.kind === "class" && arg.generic?.name === node.name) {
    node.args.forEach((n, i) => arg.generic!.args[i] && infer(tables, n, arg.generic!.args[i]!, names, bindings, at));
    return;
  }
  // `Dyn<I>` against a Dyn matches the interface it holds.
  if (node.kind === "ref" && node.name === "Dyn" && node.args.length === 1 && !names.has("Dyn") && typeof arg !== "string" && arg.kind === "dyn") {
    infer(tables, node.args[0]!, arg.of, names, bindings, at);
    return;
  }
  // So does a generic interface, given as one or held by a Dyn of one.
  const trait = typeof arg !== "string" && arg.kind === "dyn" ? arg.of : arg;
  if (node.kind === "ref" && typeof trait !== "string" && trait.kind === "interface" && trait.generic?.name === node.name) {
    node.args.forEach((n, i) => trait.generic!.args[i] && infer(tables, n, trait.generic!.args[i]!, names, bindings, at));
    return;
  }
  // `Generator<T>` against a generator matches what it yields.
  // A parameter of a generator interface, or one standing for a generator, yields too.
  if (node.kind === "ref" && node.name === "Generator" && node.args.length >= 1 && yieldsOf(arg) !== undefined) return infer(tables, node.args[0]!, yieldsOf(arg)!, names, bindings, at);
  if (node.kind === "ref" && node.name === "AsyncGenerator" && node.args.length >= 1 && yieldsOf(arg, true) !== undefined) return infer(tables, node.args[0]!, yieldsOf(arg, true)!, names, bindings, at);
  // `FixedArray<T, N>` against a fixed array matches its element type.
  if (node.kind === "ref" && node.name === "FixedArray" && node.args.length === 2 && typeof arg !== "string" && arg.kind === "fixed") return infer(tables, node.args[0]!, arg.element, names, bindings, at);
  // `[A, B]` against a tuple of its length matches element by element.
  // An optional element matches what it holds when there, and a rest element the tuple's array.
  const fixed = node.kind === "tuple" ? node.elements.filter((n) => !n.rest) : [];
  if (node.kind === "tuple" && isTuple(arg) && elementsOf(arg as ObjectType).length === fixed.length && (fixed.length < node.elements.length) === ((arg as ObjectType).rest !== undefined)) {
    const elements = elementsOf(arg as ObjectType);
    // An optional element left out says nothing about its type.
    fixed.forEach((n, i) => (n.optional && elements[i] === "null") || infer(tables, n.type, n.optional ? withoutNull(elements[i]!) : elements[i]!, names, bindings, at));
    const rest = node.elements.find((n) => n.rest);
    if (rest) infer(tables, rest.type, arrayType((arg as ObjectType).rest!), names, bindings, at);
    return;
  }
  // `T[]` and `Array<T>` against an array match its element type.
  const element = node.kind === "array" ? node.element : node.kind === "ref" && node.name === "Array" && node.args.length === 1 ? node.args[0] : undefined;
  // An empty literal's `never` elements say nothing about the element type.
  if (element && typeof arg !== "string" && arg.kind === "array") {
    if (arg.element !== "never") infer(tables, element, arg.element, names, bindings, at);
    return;
  }
  if (node.kind !== "object" || typeof arg === "string") return;
  for (const m of node.members) {
    if (m.kind !== "property" || typeof m.name !== "string" || !m.type) continue;
    const found = field(arg, m.name);
    if (found) infer(tables, m.type, found.type, names, bindings, at);
  }
}

// A type written with some names standing for other types, as an alias's body with its
// parameters given.
function substituted(node: TypeNode, given: Map<string, TypeNode>): TypeNode {
  const walk = (n: unknown): unknown => {
    if (Array.isArray(n)) return n.map(walk);
    if (!n || typeof n !== "object") return n;
    const t = n as { kind?: string; name?: unknown; args?: unknown[] };
    if (t.kind === "ref" && typeof t.name === "string" && t.args?.length === 0 && given.has(t.name)) return given.get(t.name);
    return Object.fromEntries(Object.entries(t).map(([k, v]) => [k, walk(v)]));
  };
  return walk(node) as TypeNode;
}

// A type argument must satisfy its parameter's bound: an interface by shape, an object type
// by fitting it.
export function checkBound(type: Type, bound: Type, members: Members, at: Span) {
  const { fits, show } = members.typing;
  const reason = typeof bound !== "string" && bound.kind === "interface" ? unsatisfied(type, bound, members, at)
    : fits(type, bound) ? undefined : "";
  if (reason === undefined) return;
  throw new CompileError(`type '${show(type)}' does not satisfy the constraint '${show(bound)}'${reason ? `: ${reason}` : ""}`, at.start, at.end);
}

// Whether a type has no type parameter in it, so its instance can be compiled. A class's
// fields come from its type arguments and base, so those decide it, and an object type's
// answer is kept, since its fields never change: walking nested types afresh at every level
// would take time exponential in their depth. Each variant's answer is kept too.
function concreteness({ tiedBy }: Typing): (t: Type) => boolean {
  const concreteVariants = new WeakMap<VariantType, boolean>();
  const concreteObjects = new WeakMap<ObjectType, boolean>();
  const visiting = new Set<ClassType>();
  return concrete;

  function concrete(t: Type): boolean {
    if (typeof t === "string" || t.kind === "literal" || t.kind === "pattern") return true;
    // An interface describes values without being one, so only a definition check holds one.
    if (t.kind === "param" || t.kind === "interface" || t.kind === "function") return false;
    if (t.kind === "class") {
      // A class may name itself in its base's type arguments, as `N extends Base<N>` does.
      if (visiting.has(t)) return true;
      visiting.add(t);
      try {
        return (t.generic?.args.every(concrete) ?? true) && (!t.base || concrete(t.base));
      } finally {
        visiting.delete(t);
      }
    }
    // A type holding itself through an array is as concrete as the type arguments it was made with.
    const tied = tiedBy(t);
    if (tied) return tied.args.every(concrete);
    if (t.kind === "union") return t.members.every(concrete);
    if (t.kind === "ref" || t.kind === "pointer") return concrete(t.to);
    if (t.kind === "handle") return concrete(t.gives) && (!t.throws || concrete(t.throws));
    if (t.kind === "interior" || t.kind === "shared" || t.kind === "block") return concrete(t.of);
    if (t.kind === "dyn" || t.kind === "regex") return true;
    if (t.kind === "closure" || t.kind === "generator" || t.kind === "future") return t.concrete;
    if (t.kind === "array" || t.kind === "fixed") return concrete(t.element);
    if (t.kind === "map") return concrete(t.key) && concrete(t.value);
    if (t.kind === "recursive") return t.args.every(concrete);
    if (t.kind === "variant") {
      let known = concreteVariants.get(t);
      if (known === undefined) concreteVariants.set(t, known = t.args.every(concrete) && t.fields.every((f) => concrete(f.type)));
      return known;
    }
    let known = concreteObjects.get(t);
    if (known === undefined) concreteObjects.set(t, known = t.fields.every((f) => concrete(f.type)));
    return known;
  }
}

// What instantiating needs from the checker.
type Checker = {
  tables: Tables;
  resolveType(t: TypeNode): Type;
  paramType(p: Param, property?: boolean): Type;
  withScope<T>(bindings: Map<string, Type>, f: () => T): T;
  // Resolves a body's own signature, where its parameter names shadow top-level ones.
  signing<T>(f: Body, run: () => T): T;
  members: Members;
  // The instance being checked, which new instantiations count their depth from.
  checking(): Instance | undefined;
  // The type parameters of the generic class a body belongs to, if any.
  classParams(f: Body): TypeParam[];
  // A comptime parameter's argument, computed while compiling, as the literal type of its value.
  comptimeArgument(arg: Expr): Type;
};

// The instances of every body: one for a plain function, and for a generic one, its
// definition check plus one per set of type arguments its calls need.
// The binding a comptime parameter's value is kept under, beside the type parameters'.
export function comptimeName(p: Param): string {
  return `comptime ${paramName(p)}`;
}

export function instancing({ tables, resolveType, paramType, withScope, signing, members, checking, classParams, comptimeArgument }: Checker) {
  const { typing } = tables;
  const { callableOf, lower, functionType, openThrows, fits, show, stored, refType, typeParameter, described, keyOf, heldArgument, generatorElement, generatorInterface, asyncGeneratorInterface, replaced, unlocks, holdsPattern, wrapped, promiseElement, holdsRef } = typing;
  const concrete = concreteness(typing);
  const explicit = new WeakMap<Body, Map<string, Type>>();
  const instances = new Map<Body, Map<string, Instance>>();
  const sharedPlaceholders = new Map<TypeParam[], Map<string, Type>>();
  const implicits = new Map<Body, Map<number, Bound>>();
  // Which implicit parameters are references to their type, and how.
  const lent = new Map<Body, Map<number, RefType>>();
  const definitions = new Map<Body, Instance>();
  // Instances still to check.
  const pending: Instance[] = [];
  const all = () => [...instances.values()].flatMap((m) => [...m.values()]);
  // What a call made inside an instance passed for each type parameter, where that was one of
  // the instance's own.
  const sites = new NodeMap<Span & Id, Map<string, Type>>();
  return { instanceOf, instantiate, callbackType, paramTypes, scopeOf, declaredParams, implicitOf, definition, pending, all, siteOf: (at: Span & Id) => sites.get(at), returnTypeOf, constructs };

  // The type an arrow given as a generic body's argument is checked against: its parameter's
  // function type, with the type parameters the other arguments, or the written type
  // arguments, have decided. What it gives decides the rest, through \`infer\`.
  function callbackType(f: Body, typeArgs: TypeNode[], argTypes: (Type | undefined)[], i: number, at: Span): FunctionType | undefined {
    const written = f.params[i]?.type;
    const params = typeParamsOf(f);
    // A parameter written as a type parameter given a function type, by the call as in
    // `id<(x: i64) => i64>((x) => x * 2)` or by its class's instance, types the arrow as that function.
    if (written?.kind === "ref" && written.args.length === 0) {
      const k = params.findIndex((p) => p.name === written.name);
      const given = k < 0 ? f.scope?.get(written.name) : typeArgs.length === params.length ? resolveType(typeArgs[k]!) : undefined;
      if (typeof given !== "string" && given?.kind === "dyn") return callableOf.get(given.of);
      if (typeof given === "string" || given?.kind !== "function") return undefined;
      if (given.generic) throw unsupported("generic function types as type arguments", at);
      return given;
    }
    if (written?.kind !== "function" || !generic(f)) return undefined;
    const bindings = new Map<string, Type>();
    if (typeArgs.length === params.length) params.forEach((p, k) => bindings.set(p.name, resolveType(typeArgs[k]!)));
    else {
      const names = new Set(params.map((p) => p.name));
      f.params.forEach((p, k) => p.type && argTypes[k] !== undefined && k !== i && infer(tables, p.type, argTypes[k]!, names, bindings, at));
    }
    // Inferred from a literal, a type parameter types the arrow as its base type; written, as the
    // instance has it, so a callable the arrow is given fits the instance's own.
    const explicit = typeArgs.length === params.length;
    const scope = new Map([...(f.scope ?? []), ...explicitPlaceholders(f), ...[...bindings].map(([n, t]): [string, Type] => [n, explicit ? lower(t) : widenLet(lower(t))])]);
    const t = withScope(scope, () => resolveType(written));
    if (typeof t === "string" || t.kind !== "function") return undefined;
    // A parameter only the callback itself could decide is left for the call to report.
    const undecided = [...explicitPlaceholders(f)].filter(([n]) => !bindings.has(n)).map(([, p]) => p);
    if (t.params.some((p) => holdsPart(p, (u) => undecided.includes(u), true))) return undefined;
    // What it gives is left open while it names a type parameter the call hasn't decided.
    const undecidedIn = (u: Type) => holdsPart(u, (v) => typeof v !== "string" && v.kind === "param" && v.concrete === undefined, true);
    const open = undecidedIn(t.returns);
    // So is what it throws, which the arrow then infers.
    const openError = t.throws !== undefined && undecidedIn(t.throws);
    const made = functionType(written.params.map((p, k) => (p.pattern.kind === "ident" ? p.pattern.name : `p${k}`)), t.params, open ? "void" : t.returns, openError ? undefined : t.throws);
    if (openError) openThrows.add(made);
    return made;
  }

  // A generic class's constructor lent a value as `Mut<T>` keeps its read-only fields too.
  function constructs(f: Body, args: Expr[], argTypes: Type[]) {
    readOnlyKept(f.params, classParams(f), new Map(f.scope ?? []), argTypes, args, f.owner?.name ?? f.name);
  }

  // A body's written return type. A reference to the type a reference parameter borrows is
  // to what that parameter points at, which may be wider, so a caller reads it as it is.
  function returnTypeOf(f: Body, scope: Map<string, Type>): Type | undefined {
    return signing(f, () => writtenReturn(f, scope));
  }
  function writtenReturn(f: Body, scope: Map<string, Type>): Type | undefined {
    if (!f.returnType) return undefined;
    // `x is T` is a boolean that tells a caller's condition what x is.
    if (f.returnType.kind === "predicate") {
      const p = f.returnType;
      if (p.asserts) throw unsupported("assertion signatures", p);
      if (p.name === "this") throw unsupported("'this' type predicates", p);
      const param = f.params.find((x) => x.pattern.kind === "ident" && x.pattern.name === p.name);
      if (!param) throw new CompileError(`a type predicate names one of the function's parameters, and '${p.name}' isn't one`, p.start, p.end);
      const [narrowed, declared] = withScope(scope, () => [p.type && resolveType(p.type), param.type && resolveType(param.type)]);
      // A predicate on a borrowed parameter says what the value it points to is.
      const held = declared && typeof declared !== "string" && declared.kind === "ref" ? declared.to : declared;
      if (narrowed && held && !fits(narrowed, held)) throw new CompileError(`a type predicate's type must be assignable to its parameter's type, and '${show(narrowed)}' isn't a '${show(held)}'`, p.type!.start, p.type!.end);
      return "boolean";
    }
    // A function type returned is a stored callable, and a `Promise<T>` a boxed future, except
    // as an async function's own result, which its `Promise<T>` describes.
    const written = withScope(scope, () => resolveType(f.returnType!));
    const t = f.async ? written : stored(written);
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
    return signing(f, () => withScope(f.scope ?? new Map(), () => f.params.map((p, i) => lentAs(f, i, implicit.get(i)) ?? paramType(p, f.self?.constructor))));
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
    for (const [i, bound] of implicitOf(f)) scope.set(`#${i}`, typeParameter(show(bound), sameParams(f, i, bound, new Map([...(f.scope ?? []), ...scope]))));
    // A comptime parameter's value is known only at each call; the definition has a placeholder.
    for (const p of f.params) if (p.comptime) scope.set(comptimeName(p), typeParameter(comptimeName(p), undefined));
    found = instanceOf(f, new Map([...(f.scope ?? []), ...scope]));
    definitions.set(f, found);
    return found;
  }

  // A concrete instance's symbol: its name and a hash of its type arguments, rather than a count,
  // so it is the same in every program using it. Arguments shown alike get numbered suffixes.
  function instanceSymbol(name: string, bindings: Map<string, Type>, others: Map<string, Instance>): string {
    const stem = `${name}#${digest([...bindings].map(([k, t]) => `${k}=${described(t)}`).join(","))}`;
    const symbols = new Set([...others.values()].map((i) => i.symbol));
    let symbol = stem;
    for (let n = 1; symbols.has(symbol); n++) symbol = `${stem}.${n}`;
    return symbol;
  }

  // A member of a generic class's instance runs with the class's type arguments in scope.
  function instanceOf(f: Body, bindings: Map<string, Type> = f.scope ?? new Map<string, Type>()): Instance {
    const key = [...bindings.values()].map(keyOf).join(",");
    let byKey = instances.get(f);
    if (!byKey) instances.set(f, byKey = new Map());
    let found = byKey.get(key);
    if (!found) {
      // Every type parameter, implicit ones included, needs a concrete binding to compile.
      const complete = typeParamsOf(f).every((p) => bindings.has(p.name)) && [...implicitOf(f).keys()].every((i) => bindings.has(`#${i}`)) && f.params.every((p) => !p.comptime || bindings.has(comptimeName(p)));
      const isConcrete = complete && [...bindings.values()].every(concrete);
      const generic = bindings.size > 0;
      found = {
        tables, body: f, symbol: generic && isConcrete ? instanceSymbol(f.name, bindings, byKey) : f.name, bindings, concrete: isConcrete,
        depth: generic && checking() ? checking()!.depth + 1 : 0, returns: "void",
        types: new NodeMap(), locals: new NodeMap(), calls: new NodeMap(), setters: new NodeMap(), coercions: new NodeMap(), jumps: new NodeMap(), borrowsFrom: new NodeMap(), raises: new NodeMap(), caught: new NodeMap(), consumes: new NodeSet(), patterns: new NodeMap(), copiesOut: new NodeSet(),
      };
      byKey.set(key, found);
      pending.push(found);
    }
    return found;
  }

  // The instance a call runs: a generic function's type arguments come from the call, or are
  // inferred from its arguments, and must satisfy their bounds.
  function instantiate(f: Body, typeArgs: TypeNode[], args: Expr[], argTypes: Type[], at: Span & Id): Instance {
    const params = typeParamsOf(f);
    if (typeArgs.length > 0 && typeArgs.length !== params.length) {
      throw new CompileError(`expected ${params.length} type argument${params.length === 1 ? "" : "s"}, but got ${typeArgs.length}`, at.start, at.end);
    }
    if (!generic(f)) return instanceOf(f);
    // Optional parameters may be left out at the end.
    const required = f.params.filter((p) => !p.optional).length;
    if (args.length < required || args.length > f.params.length) {
      const expected = required === f.params.length ? `${required}` : `${required}-${f.params.length}`;
      throw new CompileError(`expected ${expected} argument${expected === "1" ? "" : "s"}, but got ${args.length}`, at.start, at.end);
    }
    const bindings = new Map<string, Type>();
    if (typeArgs.length > 0) {
      params.forEach((p, i) => bindings.set(p.name, heldArgument(resolveType(typeArgs[i]!))));
    } else {
      const names = new Set(params.map((p) => p.name));
      f.params.forEach((p, i) => p.type && argTypes[i] && infer(tables, p.type, argTypes[i]!, names, bindings, at));
      // `G extends Generator<U>` decides `U` from what `G`'s generator yields.
      for (const p of params) {
        const c = p.constraint;
        const yields = bindings.has(p.name) ? typing.yieldsOf(bindings.get(p.name)!) : undefined;
        if (c?.kind === "ref" && c.name === "Generator" && c.args.length === 1 && yields !== undefined) infer(tables, c.args[0]!, yields, names, bindings, at);
      }
    }
    for (const p of params) {
      const type = bindings.get(p.name);
      if (!type) throw new CompileError(`can't infer a type for '${p.name}'; pass the type arguments explicitly`, at.start, at.end);
      if (typeof type !== "string" && type.kind === "interface") {
        throw new CompileError(`an interface can't be a type argument, since it describes values without being one`, at.start, at.end);
      }
      if (typeof type !== "string" && type.kind === "function" && type.generic) throw unsupported("generic function types as type arguments", at);
      // A closure inferred for T is the closure's own type, compiled for it, unless the body holds
      // T in a type argument, which holds the boxed callable, as a written function type is.
      if (typeof type !== "string" && (type.kind === "closure" || type.kind === "function") && heldInArgument(f, p.name)) bindings.set(p.name, heldArgument(type));
    }
    // A bound may name the class's parameters too, as this instance of it holds them.
    withScope(new Map([...(f.scope ?? []), ...bindings]), () => params.forEach((p) => p.constraint && checkBound(bindings.get(p.name)!, resolveType(p.constraint), members, at)));
    // A type parameter only an arrow's own parameters decided is still the definition's
    // placeholder, which the arrow was typed with; a body calling itself passes its placeholder
    // on in an argument of its own.
    const open = new Set(explicitPlaceholders(f).values());
    // A placeholder an argument holds, directly or in a function-typed parameter's bound.
    const holds = (given: Type, t: Type): boolean => holdsPart(given, (u) => u === t || (typeof u !== "string" && u.kind === "param" && u.bound?.kind === "function" && [...u.bound.params, u.bound.returns].some((b) => holds(b, t))), true);
    for (const p of typeArgs.length > 0 ? [] : params) {
      const t = bindings.get(p.name)!;
      if (!open.has(t)) continue;
      if (!args.some((a, i) => a.kind !== "arrow" && argTypes[i] !== undefined && holds(argTypes[i]!, t))) throw new CompileError(`can't infer a type for '${p.name}'; pass the type arguments explicitly`, at.start, at.end);
    }
    readOnlyKept(f.params, params, bindings, argTypes, args, f.name);
    // An argument from inside another instance may be one of its type parameters; the instance
    // is keyed by what that stands for, and the call site remembers the parameter itself.
    const own = new Map(params.map((p): [string, Type] => [p.name, bindings.get(p.name)!]));
    // A `Generator<T>` bound names the function's own type parameters, which the call has just
    // decided, so the argument is checked against what they stand for.
    // So does a function type's, and the class's own parameters stand for what this class
    // instance gives them.
    const outer = classPlaceholders(tables, classParams(f), (t, s) => withScope(s, () => resolveType(t)));
    const decided = new Map([
      ...[...explicitPlaceholders(f)].flatMap(([name, held]): [Type, Type][] => (bindings.has(name) ? [[held, bindings.get(name)!]] : [])),
      ...[...outer].flatMap(([name, held]): [Type, Type][] => (f.scope?.has(name) ? [[held, f.scope.get(name)!]] : [])),
    ]);
    for (const [i, bound] of implicitOf(f)) {
      const element = generatorElement(bound);
      const asyncElement = generatorElement(bound, true);
      const meant = element !== undefined && decided.size > 0 ? generatorInterface(replaced(element, decided)) : asyncElement !== undefined && decided.size > 0 ? asyncGeneratorInterface(replaced(asyncElement, decided)) : (bound.kind === "function" || (bound.kind === "interface" && bound.generic)) && decided.size > 0 ? replaced(bound, decided) as Bound : bound;
      own.set(`#${i}`, implicitArgument(args[i]!, argTypes[i]!, meant, lent.get(f)!.has(i)));
      const given = argTypes[i]!;
      const held = typeof given !== "string" && given.kind === "ref" ? given.to : given;
      const unlocked = lent.get(f)!.get(i)?.mutable ? unlocks(held, bound) : undefined;
      if (unlocked) throw new CompileError(`'${unlocked}' is read-only here, but '${f.name}' takes it mutably as '${show(bound)}', which could change it`, args[i]!.start, args[i]!.end);
      if (typeof given !== "string" && given.kind === "closure" && given.once && repeats(f, paramName(f.params[i]!))) {
        throw new CompileError(`'${f.name}' may call '${paramName(f.params[i]!)}' more than once, but this closure moves '${given.once}' out, so it can run only once`, args[i]!.start, args[i]!.end);
      }
    }
    // Each value a comptime parameter is given makes an instance of its own.
    f.params.forEach((p, i) => p.comptime && own.set(comptimeName(p), comptimeArgument(args[i]!)));
    // A type argument holding a pattern keeps it, so the instance's parameters still ask for it;
    // one holding no type parameter keeps how its fields were spelled, which printing and JSON
    // read.
    const lowered = new Map([...own].map(([name, t]): [string, Type] => [name, holdsPattern(t) || concrete(t) ? t : lower(t)]));
    // Every instance of the calling body shares the call's node, so each call resets it.
    if ([...own].some(([name, t]) => lowered.get(name) !== t)) sites.set(at, own);
    else sites.delete(at);
    const instance = instanceOf(f, new Map([...(f.scope ?? []), ...lowered]));
    if (instance.depth > 64) {
      const comptime = f.params.some((p) => p.comptime);
      const why = comptime && typeParamsOf(f).length === 0 && implicitOf(f).size === 0 ? "a different comptime value" : comptime ? "a different comptime value or larger type arguments" : "larger type arguments";
      throw new CompileError(`instantiating '${f.name}' never ends: each instance needs another with ${why}`, at.start, at.end);
    }
    return instance;
  }

  // A value lent as `Mut<T>`, for a type parameter `T` bounded by a type that declares one of its
  // read-only fields writable, could be changed there.
  function readOnlyKept(written: Param[], params: TypeParam[], bindings: Map<string, Type>, argTypes: Type[], args: Expr[], name: string) {
    written.forEach((p, i) => {
      const node = p.type;
      const inner = node?.kind === "ref" && node.name === "Mut" ? node.args[0] : undefined;
      const param = inner?.kind === "ref" ? params.find((q) => q.name === inner.name) : undefined;
      const given = argTypes[i];
      if (!param?.constraint || given === undefined) return;
      const held = typeof given !== "string" && given.kind === "ref" ? given.to : given;
      const bound = withScope(bindings, () => resolveType(param.constraint!));
      const unlocked = unlocks(held, bound);
      if (unlocked) throw new CompileError(`'${unlocked}' is read-only here, but '${name}' takes it mutably as '${show(bound)}', which could change it`, args[i]!.start, args[i]!.end);
    });
  }

  // The parameter types an instance's callers pass, or with `scopeOf(instance)`, the ones its
  // body sees.
  function paramTypes(instance: Instance, scope: Map<string, Type> = instance.bindings): Type[] {
    const f = instance.body;
    const implicit = implicitOf(f);
    return signing(f, () => withScope(scope, () => f.params.map((p, i) =>
      lentAs(f, i, scope.get(`#${i}`) ?? implicit.get(i)) ?? paramType(p, f.self?.constructor))));
  }

  // What a concrete instance's body sees: each of its type parameters, and those of a generic
  // class it belongs to, offering only its bound, as at the definition, while holding the
  // concrete type for codegen.
  function scopeOf(instance: Instance): Map<string, Type> {
    const f = instance.body;
    const known = (names: string[]) => names.every((n) => instance.bindings.has(n) && concrete(instance.bindings.get(n)!));
    const stands = (name: string) => instance.bindings.get(name)!;
    const outer = classParams(f);
    const scope = outer.length > 0 && known(outer.map((p) => p.name)) ? placeholders(typing, outer, (t, s) => withScope(s, () => resolveType(t)), stands) : new Map(f.scope);
    // A constructor taking its base's parameters also holds the base's type arguments.
    for (const [name, t] of f.scope ?? []) if (!scope.has(name)) scope.set(name, t);
    const names = [...typeParamsOf(f).map((p) => p.name), ...[...implicitOf(f).keys()].map((i) => `#${i}`)];
    // A function-typed parameter of a class's member is seen in terms of the class's parameters
    // as this body holds them, even while the parameter itself is still open.
    if (!known(names)) {
      if (outer.length === 0) return instance.bindings;
      // A generic method's own parameters are open here too, offering their bounds.
      for (const [name, t] of explicitPlaceholders(f)) if (!scope.has(name)) scope.set(name, instance.bindings.get(name) ?? t);
      for (const [i, bound] of implicitOf(f)) if (bound.kind === "function" && instance.bindings.has(`#${i}`)) scope.set(`#${i}`, wrapped(show(bound), sameParams(f, i, bound, scope), stands(`#${i}`)));
      return scope;
    }
    for (const [name, t] of placeholders(typing, typeParamsOf(f), (t, s) => withScope(new Map([...scope, ...s]), () => resolveType(t)), stands)) scope.set(name, t);
    for (const [i, bound] of implicitOf(f)) scope.set(`#${i}`, wrapped(show(bound), sameParams(f, i, bound, scope), stands(`#${i}`)));
    return scope;
  }

  // A function-typed parameter's bound as the body sees it: written in terms of the type
  // parameters the body itself holds, so calling it with one of them fits.
  function sameParams(f: Body, i: number, bound: Bound, scope: Map<string, Type>): Bound {
    const written = f.params[i]!.type!;
    const t = withScope(scope, () => resolveType(written));
    const own = typeof t !== "string" && t.kind === "ref" ? t.to : t;
    return typeof own !== "string" && own.kind === bound.kind ? (own as Bound) : bound;
  }

  function generic(f: Body): boolean {
    return typeParamsOf(f).length > 0 || implicitOf(f).size > 0 || f.params.some((p) => p.comptime);
  }

  // One set of placeholders per body, so a parameter's type and the body name the same `T`;
  // callers get a copy they may add to.
  function explicitPlaceholders(f: Body): Map<string, Type> {
    let made = explicit.get(f);
    if (!made) {
      // A generic method's own parameters are one placeholder for every instance of its class
      // when no bound names the class's parameters, so 'map<U>(): Box<U>' makes one 'Box<U>'.
      const own = typeParamsOf(f);
      const outer = classParams(f).map((p) => p.name);
      const shared = f.owner !== undefined && own.length > 0 && !own.some((p) => p.constraint && holdsNode(p.constraint, (n) => n.kind === "ref" && outer.includes(n.name as string)));
      made = shared ? sharedPlaceholders.get(f.typeParams!) : undefined;
      // A bound may name the class's own parameters, as this instance holds them.
      if (!made) made = placeholders(typing, own, (t, scope) => withScope(new Map([...(f.scope ?? []), ...scope]), () => resolveType(t)));
      if (shared) sharedPlaceholders.set(f.typeParams!, made);
      explicit.set(f, made);
    }
    return new Map(made);
  }

  // A parameter typed with an interface or an object type is an implicit type parameter, so
  // each concrete argument type gets its own instance instead of being copied down. A
  // parameter property and a setter's parameter keep their type, since it is a field's.
  function implicitOf(f: Body): Map<number, Bound> {
    let found = implicits.get(f);
    if (found) return found;
    found = new Map();
    implicits.set(f, found);
    // A generic class's member decides this as its definition does: a parameter of the class's
    // type parameter is one in every instance, whatever that parameter stands for.
    const outer = classPlaceholders(tables, classParams(f), (t, s) => withScope(s, () => resolveType(t)));
    const scope = new Map([...(f.scope ?? []), ...outer, ...explicitPlaceholders(f)]);
    const borrows = new Map<number, RefType>();
    lent.set(f, borrows);
    withScope(scope, () => f.params.forEach((p, i) => {
      const written = p.type && resolveType(p.type);
      // A reference to an interface or object type is one over what it borrows.
      const type = written && typeof written !== "string" && written.kind === "ref" ? written.to : written;
      // An optional parameter is an Option of its type, not a type parameter.
      if (!type || typeof type === "string" || p.modifiers.length > 0 || p.optional) return;
      if (f.accessor && type.kind === "interface") {
        throw new CompileError(`a setter's parameter can't have the interface type '${type.name}'`, p.start, p.end);
      }
      // A tuple's elements are inferred like any other type's parts, so it is no bound of its own.
      // A package's function or object parameter is a callback JS keeps or a JS object, its type
      // the same for every call, not a bound.
      if (!f.accessor && ((type.kind === "interface" && !(f.js && promiseElement(type) !== undefined)) || (type.kind === "function" && !f.js) || (type.kind === "regex" && type.any) || (type.kind === "object" && !type.tuple && concrete(type) && !f.js))) {
        found!.set(i, type);
        if (written !== type) borrows.set(i, written as RefType);
      }
    }));
    return found;
  }

  // What an implicit type parameter stands for in a call: the argument's own type, which must
  // satisfy the parameter's. A fresh object literal takes the declared object type instead, so
  // it gets TypeScript's excess property check.
  function implicitArgument(arg: Expr, type: Type, bound: Bound, borrowed: boolean): Type {
    // A borrowed argument stands for what it is, or what it refers to.
    if (borrowed && typeof type !== "string" && type.kind === "ref") type = type.to;
    else if (typeof type !== "string" && type.kind === "ref") {
      throw new CompileError("can't move a value out of a reference to it, which only borrows it; use '.clone()' to hand over a copy", arg.start, arg.end);
    }
    // A recursive type's value stands for the type it stands for.
    type = unfold(type);
    const message = `argument of type '${show(type)}' is not assignable to parameter of type '${show(bound)}'`;
    // A generic function type takes a generic function value, whose calls each instantiate it.
    if (bound.kind === "function" && bound.generic) {
      const held = typeof type !== "string" && type.kind === "param" && type.concrete ? lower(type) : type;
      // A parameter of the same generic function type is passed on as it is, the type known by
      // its signature as written.
      // ponytail: compared as shown, which misses differing bounds; compare structurally if that matters
      const family = typeof held !== "string" && held.kind === "param" ? held.bound : held;
      if (typeof family !== "string" && family?.kind === "function" && family.generic && family.name === bound.name) return type;
      if (typeof held !== "string" && held.kind === "closure" && held.generic) {
        const f = members.bodyNamed(held.generic);
        const reason = f && familyMismatch(f, bound, members, arg);
        if (reason) throw new CompileError(`${message}: ${reason}`, arg.start, arg.end);
        return type;
      }
      throw new CompileError(`${message}: it takes a generic function, one that works for every type, as '<T>(x: T) => T'`, arg.start, arg.end);
    }
    if (bound.kind === "function") {
      if (!fits(type, bound)) throw new CompileError(message, arg.start, arg.end);
      return type;
    }
    if (bound.kind === "interface") {
      const reason = unsatisfied(typeof type !== "string" && type.kind === "param" && type.concrete ? lower(type) : type, bound, members, arg);
      if (reason) throw new CompileError(`${message}: ${reason}`, arg.start, arg.end);
      return type;
    }
    // A fresh object literal is checked against the parameter's type when it meets it, as its
    // nested literals then take their shapes from it.
    if (arg.kind === "object" && (holdsRef(bound) || !fits(type, bound))) return bound;
    if (!fits(type, bound)) throw new CompileError(message, arg.start, arg.end);
    // A value leaving out an optional field is copied into the parameter's type, which fills
    // it in empty; a reference can't be.
    const missing = lacks(type, bound);
    if (missing && borrowed) throw new CompileError(`${message}: it has no '${missing}', which a reference can't fill in; pass one that has it`, arg.start, arg.end);
    return arg.kind === "object" || missing ? bound : type;
  }

}

// The path to a field of `to`, at any depth, that a value of `from` leaves out: an optional one,
// since `from` fits.
function lacks(from: Type, to: Type, path = ""): string | undefined {
  if (typeof from === "string" || typeof to === "string" || to.kind !== "object") return undefined;
  for (const f of to.fields) {
    const found = field(from, f.name);
    const at = `${path}${f.name}`;
    const deeper = found ? lacks(found.type, f.type, `${at}.`) : at;
    if (deeper) return deeper;
  }
  return undefined;
}

// Whether a body may call its function-typed parameter `name` more than once: it calls it
// twice, or in a loop or a closure, which may run again, or uses it any other way, as passing
// it on. A name shadowing the parameter counts too, which only errs towards caution.
function repeats(f: Body, name: string): boolean {
  let calls = 0;
  let again = false;
  const walk = (node: unknown, repeated: boolean): void => {
    if (typeof node !== "object" || node === null) return;
    if (Array.isArray(node)) return node.forEach((n) => walk(n, repeated));
    const n = node as Expr | Stmt;
    if (n.kind === "call" && n.callee.kind === "ident" && n.callee.name === name) {
      calls++;
      if (repeated) again = true;
      return walk(n.args, repeated);
    }
    if (n.kind === "ident" && n.name === name) again = true;
    const loops = n.kind === "while" || n.kind === "doWhile" || n.kind === "for" || n.kind === "forOf" || n.kind === "forIn" || n.kind === "arrow";
    for (const v of Object.values(node)) if (typeof v === "object") walk(v, repeated || loops);
  };
  walk(f.body, false);
  return again || calls > 1;
}

// What generic classes need from the checker.
type ClassChecker = {
  tables: Tables;
  classes: Map<string, ClassInfo>;
  templates: Map<string, ClassNode & { name: string }>;
  register(c: ClassInfo): void;
  layout(c: ClassInfo): void;
  members: Members;
  resolveType(t: TypeNode): Type;
  withScope<T>(bindings: Map<string, Type>, f: () => T): T;
};

// Whether a body's signature or code writes its type parameter `name` inside a type argument, as
// in `Box<T>`, `Lock<T>` or `T[]`; a reference, a pointer or an Option to T doesn't hold one.
function heldInArgument(f: Body, name: string): boolean {
  const isT = (n: { kind?: unknown; name?: unknown }) => n.kind === "ref" && n.name === name && (n as { args: unknown[] }).args.length === 0;
  return holdsNode([f.params.map((p) => p.type), f.returnType, f.body], (n) => {
    const t = n as TypeNode;
    if (t.kind === "array") return holdsNode(t.element, isT);
    return t.kind === "ref" && t.args.length > 0 && !["Ref", "Mut", "Ptr", "MutPtr", "Option"].includes(t.name) && holdsNode(t.args, isT);
  });
}

// Generic classes: each set of type arguments declares the class again, on first use.
export function genericClasses({ tables, classes, templates, register, layout, members, resolveType, withScope }: ClassChecker) {
  const { typing } = tables;
  const { heldArgument, keyOf, shapeKey, show } = typing;
  // Where each instance was first used, and each template's instances by their arguments.
  const uses = new Map<ClassInfo, Span>();
  const instancesOf = new NodeMap<ClassNode, Map<string, ClassInfo>>();
  const shapesOf = new NodeMap<ClassNode, Set<string>>();
  // An instance made while the resolver is still being built waits for `start` to check its
  // bounds and lay it out, since both need the resolver.
  let ready = false;
  // Each generic class as its definition is checked, which holds the statics every instance shares.
  const defined = new Map<string, ClassInfo>();
  return { classNamed, construct, start, define, definedClass: (name: string) => defined.get(name) };

  function start() {
    ready = true;
    uses.forEach((_, c) => bounded(c));
  }

  // A generic class, like a generic body, is checked once at its definition with
  // placeholders for its type parameters, whether or not anything instantiates it.
  function define() {
    templates.forEach((t) => defined.set(t.name, classInstance(t, [...classPlaceholders(tables, t.typeParams, (n, s) => withScope(s, () => resolveType(n))).values()], t)));
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
  function classInstance(template: ClassNode & { name: string }, given: Type[], at: Span): ClassInfo {
    if (given.some((a) => typeof a !== "string" && (a.kind === "function" || a.kind === "closure") && a.generic)) throw unsupported("generic function types as type arguments", at);
    given.forEach((a) => unboxedClosure(typing, a, at));
    const args = given.map(heldArgument);
    const params = template.typeParams;
    if (args.length !== params.length) {
      throw new CompileError(`type '${template.name}' expects ${params.length} type argument${params.length === 1 ? "" : "s"}, but got ${args.length}`, at.start, at.end);
    }
    let byKey = instancesOf.get(template);
    if (!byKey) instancesOf.set(template, byKey = new Map());
    const key = args.map(keyOf).join(",");
    const found = byKey.get(key);
    if (found) return found;
    // Spellings of one value shape, like `{ a?: T }` and `{ a: T | null }`, count once.
    let shapes = shapesOf.get(template);
    if (!shapes) shapesOf.set(template, shapes = new Set());
    const shape = args.map(shapeKey).join(",");
    if (!shapes.has(shape) && shapes.size > 64) throw new CompileError(`instantiating '${template.name}' never ends: each instance needs another with larger type arguments`, at.start, at.end);
    if (args.some((a) => typeof a !== "string" && a.kind === "interface")) throw new CompileError("an interface can't be a type argument, since it describes values without being one", at.start, at.end);
    const scope = new Map(params.map((p, i) => [p.name, args[i]!]));
    const c = declareClass(tables, template, `${template.name}<${args.map(show).join(", ")}>`, scope);
    byKey.set(key, c);
    shapes.add(shape);
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
    const bindings = inferred(template, argTypes, at);
    const args = template.typeParams.map((p) => {
      const type = bindings.get(p.name);
      if (!type) throw new CompileError(`can't infer a type for '${p.name}'; pass the type arguments explicitly`, at.start, at.end);
      return type;
    });
    return classInstance(template, args, at);
  }

  // A class with no constructor of its own takes its base's parameters, so its type arguments
  // are inferred through the base's, as its `extends` clause passes them on.
  function inferred(template: ClassNode, argTypes: Type[], at: Span, seen: NodeSet<ClassNode> = new NodeSet<ClassNode>()): Map<string, Type> {
    const names = new Set(template.typeParams.map((p) => p.name));
    const bindings = new Map<string, Type>();
    const ctor = template.members.find((m) => m.kind === "constructor");
    if (ctor) ctor.params.forEach((p, i) => p.type && argTypes[i] && infer(tables, p.type, argTypes[i]!, names, bindings, at));
    const base = template.extends?.kind === "instantiation" && template.extends.expr.kind === "ident" ? templates.get(template.extends.expr.name) : undefined;
    if (!ctor && base && !seen.has(base) && template.extends?.kind === "instantiation") {
      const given = inferred(base, argTypes, at, seen.add(template));
      const passed = template.extends.typeArgs;
      base.typeParams.forEach((p, i) => given.has(p.name) && passed[i] && infer(tables, passed[i]!, given.get(p.name)!, names, bindings, at));
    }
    return bindings;
  }
}
