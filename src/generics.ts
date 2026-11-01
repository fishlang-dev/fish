import { bodyOf, type Arenas, type BodyId, type ClassId, type InstanceId } from "./arenas.ts";
import { holdsNode, type Instance } from "./check.ts";
import { declareClass, isLifetime, type Body, type ClassInfo } from "./classes.ts";
import { CompileError } from "./diag.ts";
import type { Tables } from "./compilation.ts";
import { unsupported } from "./unsupported.ts";
import { familyMismatch, unsatisfied, type Members } from "./interfaces.ts";
import type { ClassNode, Expr, Id, Param, Span, TypeNode, TypeParam } from "./parser.ts";
import { paramName, unboxedClosure } from "./resolve.ts";
import { TypeSet, TypeMap, digest, type RegexType, type FunctionType, type Bound, type ClassType, type InterfaceType, type ObjectType, type RefType, type Type, type VariantType, type Typing } from "./typing.ts";
import { WeakNodeMap, NodeMap, NodeSet, forEachChild, type AnyNode } from "./nodes.ts";

// Generic functions: the placeholders a generic body is checked with at its definition, the
// type arguments a call infers, and the bounds those arguments must satisfy.

// A bound must be an interface or an object type. Classes are nominal and embed rather than
// subclass, so a class bound could only ever mean that one class. In an instance, each
// parameter also holds the concrete type `concrete` gives it.
export function placeholders(typing: Typing, params: TypeParam[], resolve: (t: TypeNode, scope: Map<string, Type>) => Type, concrete?: (name: string) => Type): Map<string, Type> {
  const scope = new Map<string, Type>();
  for (const p of params) {
    if (p.modifiers.length > 0) throw new CompileError(`'${p.modifiers[0]}' type parameters are not supported yet`, p.start, p.end);
    if (p.default) throw new CompileError("default type arguments are not supported yet", p.default.start, p.default.end);
    let bound: ObjectType | InterfaceType | undefined;
    if (p.constraint) {
      const t = resolve(p.constraint, scope);
      const r = typeof t === "string" ? undefined : typing.rec(t);
      if (r?.kind !== "interface" && r?.kind !== "object") {
        throw new CompileError(`a type parameter's bound must be an interface or an object type, not '${typing.show(t)}'`, p.constraint.start, p.constraint.end);
      }
      bound = t as ObjectType | InterfaceType;
    }
    scope.set(p.name, concrete ? typing.wrapped(p.name, bound, concrete(p.name)) : typing.typeParameter(p.name, bound));
  }
  return scope;
}

// A generic class's placeholders, one set shared by its definition check and its members,
// since each new set would name another instance of the class. They are kept by the class's
// first type parameter, which only its own list holds; a list of none has nothing to share.
function classPlaceholders({ typing, classScopes }: Tables, params: TypeParam[], resolve: (t: TypeNode, scope: Map<string, Type>) => Type): Map<string, Type> {
  const first = params[0];
  if (first === undefined) return placeholders(typing, params, resolve);
  let found = classScopes.get(first);
  if (!found) classScopes.set(first, found = placeholders(typing, params, resolve));
  return found;
}

// A body's type parameters, leaving out its lifetimes.
export function typeParamsOf(f: Body): TypeParam[] {
  return (f.typeParams ?? []).filter((p) => !isLifetime(p));
}

// Binds the type parameters `node` names by matching it against an argument's type, looking
// through the check's type aliases.
export function infer(tables: Tables, node: TypeNode, arg: Type, names: Set<string>, bindings: Map<string, Type>, at: Span) {
  const { aliases, expanding, typing } = tables;
  arg = typing.unfold(arg);
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
    arg = typing.widenEnum(arg);
    const earlier = bindings.get(node.name);
    // A closure meeting T already decided as the stored callable it fits is boxed into it, as one
    // given first is boxed where the body holds T in a type argument.
    if (earlier && typing.sameCallable(earlier, typing.heldArgument(arg))) return;
    if (earlier && typing.sameCallable(typing.heldArgument(earlier), arg)) {
      bindings.set(node.name, arg);
      return;
    }
    // A literal and its base type, as a string literal and a callback taking a string give,
    // agree on the base type, as TypeScript widens them.
    if (earlier && earlier !== arg && typing.widenLet(earlier) === typing.widenLet(arg)) {
      bindings.set(node.name, typing.widenLet(arg));
      return;
    }
    if (earlier && !(typing.sameLowered(earlier, arg) && typing.sameLowered(arg, earlier))) {
      throw new CompileError(`the type argument for '${node.name}' can't be both '${typing.show(earlier)}' and '${typing.show(arg)}'`, at.start, at.end);
    }
    bindings.set(node.name, arg);
    return;
  }
  const a = typeof arg === "string" ? undefined : typing.rec(arg);
  // `T | null`, `Option<T>` and `T | string` against a value: the members the written ones
  // already cover say nothing, and the rest are T, as TypeScript infers. Absence alone gives no T.
  const option = node.kind === "ref" && node.name === "Option" && node.args.length === 1 && !names.has(node.name);
  const members = node.kind === "union" ? node.types : option ? node.args : undefined;
  if (members) {
    const open = members.filter((n) => holdsNode("typeNode", n, (x) => x.kind === "ref" && names.has(x.name as string)));
    if (open.length !== 1) return;
    const covers = (n: TypeNode, m: Type) => {
      const r = typeof m === "string" ? undefined : typing.rec(m);
      return (n.kind === "ref" && n.args.length === 0 && (m === "null" ? n.name === "null" || n.name === "undefined" : n.name === typing.show(m) || n.name === typing.show(typing.widenLet(m)))) ||
        (n.kind === "literal" && r?.kind === "literal" && "value" in n.value && n.value.value === r.value);
    };
    const rest = (a?.kind === "union" ? a.members : [arg]).filter((m) => !(option && m === "null") && !members.some((n) => n !== open[0] && covers(n, m)));
    if (rest.length > 0) infer(tables, open[0]!, rest.length === 1 ? rest[0]! : typing.unionType(rest), names, bindings, at);
    return;
  }
  // `Ref<T>` against a value or a reference borrows a T.
  if (node.kind === "ref" && (node.name === "Ref" || node.name === "Mut") && node.args.length >= 1 && !names.has(node.name)) {
    infer(tables, node.args[0]!, a?.kind === "ref" ? a.to : arg, names, bindings, at);
    return;
  }
  // A function type against a closure binds through its parameters and what it gives.
  if (node.kind === "function" && a?.kind === "closure") {
    node.params.forEach((p, i) => p.type && a.params[i] !== undefined && infer(tables, p.type, a.params[i]!, names, bindings, at));
    if (a.returns !== "void" || node.returns.kind !== "ref" || !names.has(node.returns.name)) infer(tables, node.returns, a.returns, names, bindings, at);
    if (node.throws && a.throws) infer(tables, node.throws, a.throws, names, bindings, at);
    return;
  }
  // `Ptr<T>` against a raw pointer points at a T.
  if (node.kind === "ref" && (node.name === "Ptr" || node.name === "MutPtr") && node.args.length === 1 && !names.has(node.name)) {
    if (a?.kind === "pointer") infer(tables, node.args[0]!, a.to, names, bindings, at);
    return;
  }
  // `Lock<T>` against a Lock holds a T.
  if (node.kind === "ref" && (node.name === "Atomic" || node.name === "Lock" || node.name === "Cell") && node.args.length === 1 && !names.has(node.name)) {
    if (a?.kind === "interior" && a.which === node.name) infer(tables, node.args[0]!, a.of, names, bindings, at);
    return;
  }
  if (node.kind === "ref" && node.name === "Channel" && node.args.length === 1 && !names.has(node.name)) {
    if (a?.kind === "block" && a.which === "Channel") infer(tables, node.args[0]!, a.of, names, bindings, at);
    return;
  }
  // `Map<K, V>` and `Set<T>` against one match their key and value types.
  if (node.kind === "ref" && (node.name === "Map" || node.name === "Set") && !names.has(node.name)) {
    if (a?.kind === "map" && a.set === (node.name === "Set")) {
      if (node.args[0]) infer(tables, node.args[0], a.key, names, bindings, at);
      if (node.args[1]) infer(tables, node.args[1], a.value, names, bindings, at);
    }
    return;
  }
  if (node.kind === "ref" && node.name === "shared" && node.args.length === 1 && !names.has(node.name)) {
    if (a?.kind === "shared") infer(tables, node.args[0]!, a.of, names, bindings, at);
    return;
  }
  // `Box<T>` against `Box<i64>` matches the type arguments.
  if (node.kind === "ref" && a?.kind === "class" && a.generic?.name === node.name) {
    node.args.forEach((n, i) => a.generic!.args[i] && infer(tables, n, a.generic!.args[i]!, names, bindings, at));
    return;
  }
  // `Dyn<I>` against a Dyn matches the interface it holds.
  if (node.kind === "ref" && node.name === "Dyn" && node.args.length === 1 && !names.has("Dyn") && a?.kind === "dyn") {
    infer(tables, node.args[0]!, a.of, names, bindings, at);
    return;
  }
  // So does a generic interface, given as one or held by a Dyn of one.
  const held = a?.kind === "dyn" ? a.of : arg;
  const trait = typeof held === "string" ? undefined : typing.rec(held);
  if (node.kind === "ref" && trait?.kind === "interface" && trait.generic?.name === node.name) {
    node.args.forEach((n, i) => trait.generic!.args[i] && infer(tables, n, trait.generic!.args[i]!, names, bindings, at));
    return;
  }
  // `Promise<T>` against a promise matches what it gives.
  if (node.kind === "ref" && node.name === "Promise" && node.args.length === 1 && !names.has(node.name)) {
    const gives = a?.kind === "future" ? a.gives : typing.promiseElement(arg);
    if (gives !== undefined) infer(tables, node.args[0]!, gives, names, bindings, at);
    return;
  }
  // `Generator<T>` against a generator matches what it yields.
  // A parameter of a generator interface, or one standing for a generator, yields too.
  if (node.kind === "ref" && node.name === "Generator" && node.args.length >= 1 && typing.yieldsOf(arg) !== undefined) return infer(tables, node.args[0]!, typing.yieldsOf(arg)!, names, bindings, at);
  if (node.kind === "ref" && node.name === "AsyncGenerator" && node.args.length >= 1 && typing.yieldsOf(arg, true) !== undefined) return infer(tables, node.args[0]!, typing.yieldsOf(arg, true)!, names, bindings, at);
  // `FixedArray<T, N>` against a fixed array matches its element type.
  if (node.kind === "ref" && node.name === "FixedArray" && node.args.length === 2 && a?.kind === "fixed") return infer(tables, node.args[0]!, a.element, names, bindings, at);
  // `[A, B]` against a tuple of its length matches element by element.
  // An optional element matches what it holds when there, and a rest element the tuple's array.
  const fixed = node.kind === "tuple" ? node.elements.filter((n) => !n.rest) : [];
  if (node.kind === "tuple" && typing.isTuple(arg) && typing.elementsOf(arg as ObjectType).length === fixed.length && (fixed.length < node.elements.length) === (typing.rec(arg as ObjectType).rest !== undefined)) {
    const elements = typing.elementsOf(arg as ObjectType);
    // An optional element left out says nothing about its type.
    fixed.forEach((n, i) => (n.optional && elements[i] === "null") || infer(tables, n.type, n.optional ? typing.withoutNull(elements[i]!) : elements[i]!, names, bindings, at));
    const rest = node.elements.find((n) => n.rest);
    if (rest) infer(tables, rest.type, typing.arrayType(typing.rec(arg as ObjectType).rest!), names, bindings, at);
    return;
  }
  // `T[]` and `Array<T>` against an array match its element type.
  const element = node.kind === "array" ? node.element : node.kind === "ref" && node.name === "Array" && node.args.length === 1 ? node.args[0] : undefined;
  // An empty literal's `never` elements say nothing about the element type.
  if (element && a?.kind === "array") {
    if (a.element !== "never") infer(tables, element, a.element, names, bindings, at);
    return;
  }
  if (node.kind !== "object" || typeof arg === "string") return;
  for (const m of node.members) {
    if (m.kind !== "property" || typeof m.name !== "string" || !m.type) continue;
    const found = typing.field(arg, m.name);
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
  const typing = members.typing;
  const trait = typeof bound === "string" ? undefined : typing.rec(bound);
  const reason = trait?.kind === "interface" ? unsatisfied(type, bound as InterfaceType, members, at)
    : typing.fits(type, bound) ? undefined : "";
  if (reason === undefined) return;
  throw new CompileError(`type '${typing.show(type)}' does not satisfy the constraint '${typing.show(bound)}'${reason ? `: ${reason}` : ""}`, at.start, at.end);
}

// Whether a type has no type parameter in it, so its instance can be compiled. A class's
// fields come from its type arguments and base, so those decide it, and an object type's
// answer is kept, since its fields never change: walking nested types afresh at every level
// would take time exponential in their depth. Each variant's answer is kept too.
class Concreteness {
  typing: Typing;
  private concreteVariants = new TypeMap<VariantType, boolean>();
  private concreteObjects = new TypeMap<ObjectType, boolean>();
  private visiting = new TypeSet<ClassType>();

  constructor(typing: Typing) {
    this.typing = typing;
  }

  concrete(this: Mut<this>, t: Type): boolean {
    if (typeof t === "string") return true;
    const r = this.typing.rec(t);
    if (r.kind === "literal" || r.kind === "pattern") return true;
    // An interface describes values without being one, so only a definition check holds one.
    if (r.kind === "param" || r.kind === "interface" || r.kind === "function") return false;
    if (r.kind === "class") {
      // A class may name itself in its base's type arguments, as `N extends Base<N>` does.
      if (this.visiting.has(t as ClassType)) return true;
      this.visiting.add(t as ClassType);
      try {
        return (r.generic?.args.every((t) => this.concrete(t)) ?? true) && (!r.base || this.concrete(r.base));
      } finally {
        this.visiting.delete(t as ClassType);
      }
    }
    // A type holding itself through an array is as concrete as the type arguments it was made with.
    const tied = this.typing.tiedBy(t);
    if (tied) return this.typing.rec(tied).args.every((t) => this.concrete(t));
    if (r.kind === "union") return r.members.every((t) => this.concrete(t));
    if (r.kind === "ref" || r.kind === "pointer") return this.concrete(r.to);
    if (r.kind === "handle") return this.concrete(r.gives) && (!r.throws || this.concrete(r.throws));
    if (r.kind === "interior" || r.kind === "shared" || r.kind === "block") return this.concrete(r.of);
    if (r.kind === "dyn" || r.kind === "regex") return true;
    if (r.kind === "closure" || r.kind === "generator" || r.kind === "future") return r.concrete;
    if (r.kind === "array" || r.kind === "fixed") return this.concrete(r.element);
    if (r.kind === "map") return this.concrete(r.key) && this.concrete(r.value);
    if (r.kind === "recursive") return r.args.every((t) => this.concrete(t));
    if (r.kind === "variant") {
      let known = this.concreteVariants.get(t as VariantType);
      if (known === undefined) this.concreteVariants.set(t as VariantType, known = r.args.every((t) => this.concrete(t)) && r.fields.every((f) => this.concrete(f.type)));
      return known;
    }
    let known = this.concreteObjects.get(t as ObjectType);
    if (known === undefined) this.concreteObjects.set(t as ObjectType, known = r.fields.every((f) => this.concrete(f.type)));
    return known;
  }
}

// What instantiating needs from the checker.
export interface InstancingHost {
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
}

// The instances of every body: one for a plain function, and for a generic one, its
// definition check plus one per set of type arguments its calls need.
// The binding a comptime parameter's value is kept under, beside the type parameters'.
export function comptimeName(p: Param): string {
  return `comptime ${paramName(p)}`;
}

export class Instancing {
  host: InstancingHost;

  constructor(host: InstancingHost) {
    this.host = host;
    this.typing = this.host.tables.typing;
    this.concreteness = new Concreteness(this.typing);
  }
  private typing: Typing;
  private concreteness: Concreteness;
  private explicit = new Map<BodyId, Map<string, Type>>();
  private instances = new Map<BodyId, Map<string, InstanceId>>();
  // By the method's first type parameter, which only its own list holds.
  private sharedPlaceholders = new NodeMap<TypeParam, Map<string, Type>>();
  private implicits = new Map<BodyId, Map<usize, Bound>>();
  // Which implicit parameters are references to their type, and how.
  private lent = new Map<BodyId, Map<usize, RefType>>();
  private definitions = new Map<BodyId, InstanceId>();
  // Instances still to check.
  pending: InstanceId[] = [];
  all() {
    return [...this.instances.values()].flatMap((m) => [...m.values()].map((i) => this.host.tables.arenas.instanceOf(i)));
  }
  // What a call made inside an instance passed for each type parameter, where that was one of
  // the instance's own.
  private sites = new NodeMap<Span & Id, Map<string, Type>>();
  siteOf(at: Span & Id) {
    return this.sites.get(at);
  }

  // The type an arrow given as a generic body's argument is checked against: its parameter's
  // function type, with the type parameters the other arguments, or the written type
  // arguments, have decided. What it gives decides the rest, through \`infer\`.
  callbackType(this: Mut<this>, f: Body, typeArgs: TypeNode[], argTypes: (Type | undefined)[], i: usize, at: Span): FunctionType | undefined {
    const written = f.params[i]?.type;
    const params = typeParamsOf(f);
    // A parameter written as a type parameter given a function type, by the call as in
    // `id<(x: i64) => i64>((x) => x * 2)` or by its class's instance, types the arrow as that function.
    if (written?.kind === "ref" && written.args.length === 0) {
      const k = params.findIndex((p) => p.name === written.name);
      const given = k < 0 ? f.scope?.get(written.name) : typeArgs.length === params.length ? this.host.resolveType(typeArgs[k]!) : undefined;
      const r = given === undefined || typeof given === "string" ? undefined : this.typing.rec(given);
      if (r?.kind === "dyn") return this.typing.callableOf.get(r.of);
      if (r?.kind !== "function") return undefined;
      if (r.generic) throw unsupported("generic function types as type arguments", at);
      return given as FunctionType;
    }
    if (written?.kind !== "function" || !this.generic(f)) return undefined;
    const bindings = new Map<string, Type>();
    if (typeArgs.length === params.length) params.forEach((p, k) => bindings.set(p.name, this.host.resolveType(typeArgs[k]!)));
    else {
      const names = new Set(params.map((p) => p.name));
      f.params.forEach((p, k) => p.type && argTypes[k] !== undefined && k !== i && infer(this.host.tables, p.type, argTypes[k]!, names, bindings, at));
    }
    // Inferred from a literal, a type parameter types the arrow as its base type; written, as the
    // instance has it, so a callable the arrow is given fits the instance's own.
    const explicit = typeArgs.length === params.length;
    const scope = new Map([...(f.scope ?? []), ...this.explicitPlaceholders(f), ...[...bindings].map(([n, t]): [string, Type] => [n, explicit ? this.typing.lower(t) : this.typing.widenLet(this.typing.lower(t))])]);
    const resolved = this.host.withScope(scope, () => this.host.resolveType(written));
    const t = typeof resolved === "string" ? undefined : this.typing.rec(resolved);
    if (t?.kind !== "function") return undefined;
    // A parameter only the callback itself could decide is left for the call to report.
    const undecided = [...this.explicitPlaceholders(f)].filter(([n]) => !bindings.has(n)).map(([, p]) => p);
    if (t.params.some((p) => this.typing.holdsPart(p, (u) => undecided.includes(u), true))) return undefined;
    // What it gives is left open while it names a type parameter the call hasn't decided.
    const undecidedIn = (u: Type) => this.typing.holdsPart(u, (v) => {
      const r = typeof v === "string" ? undefined : this.typing.rec(v);
      return r?.kind === "param" && r.concrete === undefined;
    }, true);
    const open = undecidedIn(t.returns);
    // So is what it throws, which the arrow then infers.
    const openError = t.throws !== undefined && undecidedIn(t.throws);
    const made = this.typing.functionType(written.params.map((p, k) => (p.pattern.kind === "ident" ? p.pattern.name : `p${k}`)), t.params, open ? "void" : t.returns, openError ? undefined : t.throws);
    if (openError) this.typing.openThrows.add(made);
    return made;
  }

  // A generic class's constructor lent a value as `Mut<T>` keeps its read-only fields too.
  constructs(f: Body, args: Expr[], argTypes: Type[]) {
    this.readOnlyKept(f.params, this.host.classParams(f), new Map(f.scope ?? []), argTypes, args, f.owner ? this.typing.rec(f.owner).name : f.name);
  }

  // A body's written return type. A reference to the type a reference parameter borrows is
  // to what that parameter points at, which may be wider, so a caller reads it as it is.
  returnTypeOf(this: Mut<this>, f: Body, scope: Map<string, Type>): Type | undefined {
    return this.host.signing(f, () => this.writtenReturn(f, scope));
  }
  private writtenReturn(this: Mut<this>, f: Body, scope: Map<string, Type>): Type | undefined {
    if (!f.returnType) return undefined;
    // `x is T` is a boolean that tells a caller's condition what x is.
    if (f.returnType.kind === "predicate") {
      const p = f.returnType;
      if (p.asserts) throw unsupported("assertion signatures", p);
      if (p.name === "this") throw unsupported("'this' type predicates", p);
      const param = f.params.find((x) => x.pattern.kind === "ident" && x.pattern.name === p.name);
      if (!param) throw new CompileError(`a type predicate names one of the function's parameters, and '${p.name}' isn't one`, p.start, p.end);
      const [narrowed, declared] = this.host.withScope(scope, () => [p.type && this.host.resolveType(p.type), param.type && this.host.resolveType(param.type)]);
      // A predicate on a borrowed parameter says what the value it points to is.
      const ref = declared && typeof declared !== "string" ? this.typing.rec(declared) : undefined;
      const held = ref?.kind === "ref" ? ref.to : declared;
      if (narrowed && held && !this.typing.fits(narrowed, held)) throw new CompileError(`a type predicate's type must be assignable to its parameter's type, and '${this.typing.show(narrowed)}' isn't a '${this.typing.show(held)}'`, p.type!.start, p.type!.end);
      return "boolean";
    }
    // A function type returned is a stored callable, and a `Promise<T>` a boxed future, except
    // as an async function's own result, which its `Promise<T>` describes.
    const written = this.host.withScope(scope, () => this.host.resolveType(f.returnType!));
    const returned = f.async ? written : this.typing.stored(written);
    if (typeof returned === "string") return returned;
    const t = this.typing.rec(returned);
    if (t.kind !== "ref") return returned;
    // Only the one parameter the result borrows from, by its lifetime or by elision.
    const implicit = this.implicitOf(f);
    const refs = f.params.flatMap((p, i) => {
      const type = this.lent.get(f.bodyId)?.get(i) ?? (p.type && this.host.withScope(scope, () => this.host.resolveType(p.type!)));
      const r = type && typeof type !== "string" ? this.typing.rec(type) : undefined;
      return r?.kind === "ref" && (!t.life || r.life === t.life) ? [i] : [];
    });
    const [i] = refs;
    const bound = i !== undefined && refs.length === 1 && !(f.self && !f.self.constructor && !t.life) ? implicit.get(i) : undefined;
    return bound && this.lent.get(f.bodyId)?.has(i!) && this.typing.lower(t.to) === this.typing.lower(bound) ? this.typing.refType(scope.get(`#${i}`) ?? bound, t.mutable, t.life) : returned;
  }

  // A body's parameter types as written: an implicit parameter's is its interface or object
  // type, which is what an interface's method signature is compared with.
  declaredParams(this: Mut<this>, f: Body): Type[] {
    const implicit = this.implicitOf(f);
    return this.host.signing(f, () => this.host.withScope(f.scope ?? new Map(), () => f.params.map((p, i) => this.lentAs(f, i, implicit.get(i)) ?? this.host.paramType(p, f.self?.constructor))));
  }

  // An implicit parameter's type, borrowed when the parameter is a reference to it.
  private lentAs(f: Body, i: usize, t: Type | undefined): Type | undefined {
    const ref = this.lent.get(f.bodyId)?.get(i);
    if (!t || !ref) return t;
    const { mutable, life } = this.typing.rec(ref);
    return this.typing.refType(t, mutable, life);
  }

  // A generic body is checked once at its definition, with placeholders for its type
  // parameters, whether or not anything instantiates it.
  // It is made once per body: fresh placeholders would make a new instance each time.
  definition(this: Mut<this>, f: Body): Instance {
    if (!this.generic(f)) return this.instanceOf(f);
    const known = this.definitions.get(f.bodyId);
    if (known) return this.host.tables.arenas.instanceOf(known);
    const scope = this.explicitPlaceholders(f);
    for (const [i, bound] of this.implicitOf(f)) scope.set(`#${i}`, this.typing.typeParameter(this.typing.show(bound), this.sameParams(f, i, bound, new Map([...(f.scope ?? []), ...scope]))));
    // A comptime parameter's value is known only at each call; the definition has a placeholder.
    for (const p of f.params) if (p.comptime) scope.set(comptimeName(p), this.typing.typeParameter(comptimeName(p), undefined));
    const found = this.instanceOf(f, new Map([...(f.scope ?? []), ...scope]));
    this.definitions.set(f.bodyId, found.id);
    return found;
  }

  // A concrete instance's symbol: its name and a hash of its type arguments, rather than a count,
  // so it is the same in every program using it. Arguments shown alike get numbered suffixes.
  private instanceSymbol(name: string, bindings: Map<string, Type>, others: Map<string, InstanceId>): string {
    const stem = `${name}#${digest([...bindings].map(([k, t]) => `${k}=${this.typing.described(t)}`).join(","))}`;
    const symbols = new Set([...others.values()].map((i) => this.host.tables.arenas.instanceOf(i).symbol));
    let symbol = stem;
    for (let n = 1; symbols.has(symbol); n++) symbol = `${stem}.${n}`;
    return symbol;
  }

  // A member of a generic class's instance runs with the class's type arguments in scope.
  instanceOf(this: Mut<this>, f: Body, bindings: Map<string, Type> = f.scope ?? new Map<string, Type>()): Instance {
    const key = [...bindings.values()].map((t) => this.typing.keyOf(t)).join(",");
    let byKey = this.instances.get(f.bodyId);
    if (!byKey) this.instances.set(f.bodyId, byKey = new Map());
    const known = byKey.get(key);
    if (known) return this.host.tables.arenas.instanceOf(known);
    // Every type parameter, implicit ones included, needs a concrete binding to compile.
    const complete = typeParamsOf(f).every((p) => bindings.has(p.name)) && [...this.implicitOf(f).keys()].every((i) => bindings.has(`#${i}`)) && f.params.every((p) => !p.comptime || bindings.has(comptimeName(p)));
    const isConcrete = complete && [...bindings.values()].every((t) => this.concreteness.concrete(t));
    const generic = bindings.size > 0;
    const found = this.host.tables.arenas.addInstance({
      tables: this.host.tables, body: this.host.tables.arenas.addBody(f).bodyId, symbol: generic && isConcrete ? this.instanceSymbol(f.name, bindings, byKey) : f.name, bindings, concrete: isConcrete,
      depth: generic && this.host.checking() ? this.host.checking()!.depth + 1 : 0, returns: "void",
      types: new NodeMap(), locals: new NodeMap(), calls: new NodeMap(), setters: new NodeMap(), coercions: new NodeMap(), jumps: new NodeMap(), borrowsFrom: new NodeMap(), raises: new NodeMap(), caught: new NodeMap(), consumes: new NodeSet(), patterns: new NodeMap(), copiesOut: new NodeSet(),
    });
    byKey.set(key, found.id);
    this.pending.push(found.id);
    return found;
  }

  // The instance a call runs: a generic function's type arguments come from the call, or are
  // inferred from its arguments, and must satisfy their bounds.
  instantiate(this: Mut<this>, f: Body, typeArgs: TypeNode[], args: Expr[], argTypes: Type[], at: Span & Id): Instance {
    const params = typeParamsOf(f);
    if (typeArgs.length > 0 && typeArgs.length !== params.length) {
      throw new CompileError(`expected ${params.length} type argument${params.length === 1 ? "" : "s"}, but got ${typeArgs.length}`, at.start, at.end);
    }
    if (!this.generic(f)) return this.instanceOf(f);
    // Optional parameters may be left out at the end.
    const required = f.params.filter((p) => !p.optional).length;
    if (args.length < required || args.length > f.params.length) {
      const expected = required === f.params.length ? `${required}` : `${required}-${f.params.length}`;
      throw new CompileError(`expected ${expected} argument${expected === "1" ? "" : "s"}, but got ${args.length}`, at.start, at.end);
    }
    const bindings = new Map<string, Type>();
    if (typeArgs.length > 0) {
      params.forEach((p, i) => bindings.set(p.name, this.typing.heldArgument(this.host.resolveType(typeArgs[i]!))));
    } else {
      const names = new Set(params.map((p) => p.name));
      f.params.forEach((p, i) => p.type && argTypes[i] && infer(this.host.tables, p.type, argTypes[i]!, names, bindings, at));
      // `G extends Generator<U>` decides `U` from what `G`'s generator yields.
      for (const p of params) {
        const c = p.constraint;
        const yields = bindings.has(p.name) ? this.typing.yieldsOf(bindings.get(p.name)!) : undefined;
        if (c?.kind === "ref" && c.name === "Generator" && c.args.length === 1 && yields !== undefined) infer(this.host.tables, c.args[0]!, yields, names, bindings, at);
      }
    }
    for (const p of params) {
      const type = bindings.get(p.name);
      if (!type) throw new CompileError(`can't infer a type for '${p.name}'; pass the type arguments explicitly`, at.start, at.end);
      const r = typeof type === "string" ? undefined : this.typing.rec(type);
      if (r?.kind === "interface") {
        throw new CompileError(`an interface can't be a type argument, since it describes values without being one`, at.start, at.end);
      }
      if (r?.kind === "function" && r.generic) throw unsupported("generic function types as type arguments", at);
      // A closure inferred for T is the closure's own type, compiled for it, unless the body holds
      // T in a type argument, which holds the boxed callable, as a written function type is.
      if ((r?.kind === "closure" || r?.kind === "function") && heldInArgument(f, p.name)) bindings.set(p.name, this.typing.heldArgument(type));
    }
    // A bound may name the class's parameters too, as this instance of it holds them.
    this.host.withScope(new Map([...(f.scope ?? []), ...bindings]), () => params.forEach((p) => p.constraint && checkBound(bindings.get(p.name)!, this.host.resolveType(p.constraint), this.host.members, at)));
    // A type parameter only an arrow's own parameters decided is still the definition's
    // placeholder, which the arrow was typed with; a body calling itself passes its placeholder
    // on in an argument of its own.
    const open = new TypeSet(this.explicitPlaceholders(f).values());
    // A placeholder an argument holds, directly or in a function-typed parameter's bound.
    const holds = (given: Type, t: Type): boolean => this.typing.holdsPart(given, (u) => {
      if (u === t) return true;
      const r = typeof u === "string" ? undefined : this.typing.rec(u);
      const bound = r?.kind === "param" && r.bound ? this.typing.rec(r.bound) : undefined;
      return bound?.kind === "function" && [...bound.params, bound.returns].some((b) => holds(b, t));
    }, true);
    for (const p of typeArgs.length > 0 ? [] : params) {
      const t = bindings.get(p.name)!;
      if (!open.has(t)) continue;
      if (!args.some((a, i) => a.kind !== "arrow" && argTypes[i] !== undefined && holds(argTypes[i]!, t))) throw new CompileError(`can't infer a type for '${p.name}'; pass the type arguments explicitly`, at.start, at.end);
    }
    this.readOnlyKept(f.params, params, bindings, argTypes, args, f.name);
    // An argument from inside another instance may be one of its type parameters; the instance
    // is keyed by what that stands for, and the call site remembers the parameter itself.
    const own = new Map(params.map((p): [string, Type] => [p.name, bindings.get(p.name)!]));
    // A `Generator<T>` or `Promise<T>` bound names the function's own type parameters, which the
    // call has just decided, so the argument is checked against what they stand for.
    // So does a function type's, and the class's own parameters stand for what this class
    // instance gives them.
    const outer = classPlaceholders(this.host.tables, this.host.classParams(f), (t, s) => this.host.withScope(s, () => this.host.resolveType(t)));
    const decided = new TypeMap([
      ...[...this.explicitPlaceholders(f)].flatMap(([name, held]): [Type, Type][] => (bindings.has(name) ? [[held, bindings.get(name)!]] : [])),
      ...[...outer].flatMap(([name, held]): [Type, Type][] => (f.scope?.has(name) ? [[held, f.scope.get(name)!]] : [])),
    ]);
    for (const [i, bound] of this.implicitOf(f)) {
      const meant = this.rebound(bound, decided);
      own.set(`#${i}`, this.implicitArgument(args[i]!, argTypes[i]!, meant, this.lent.get(f.bodyId)!.has(i)));
      const given = argTypes[i]!;
      const r = typeof given === "string" ? undefined : this.typing.rec(given);
      const held = r?.kind === "ref" ? r.to : given;
      const ref = this.lent.get(f.bodyId)!.get(i);
      const unlocked = ref && this.typing.rec(ref).mutable ? this.typing.unlocks(held, bound) : undefined;
      if (unlocked) throw new CompileError(`'${unlocked}' is read-only here, but '${f.name}' takes it mutably as '${this.typing.show(bound)}', which could change it`, args[i]!.start, args[i]!.end);
      if (r?.kind === "closure" && r.once && repeats(f, paramName(f.params[i]!))) {
        throw new CompileError(`'${f.name}' may call '${paramName(f.params[i]!)}' more than once, but this closure moves '${r.once}' out, so it can run only once`, args[i]!.start, args[i]!.end);
      }
    }
    // Each value a comptime parameter is given makes an instance of its own.
    f.params.forEach((p, i) => p.comptime && own.set(comptimeName(p), this.host.comptimeArgument(args[i]!)));
    // A type argument holding a pattern keeps it, so the instance's parameters still ask for it;
    // one holding no type parameter keeps how its fields were spelled, which printing and JSON
    // read.
    const lowered = new Map([...own].map(([name, t]): [string, Type] => [name, this.typing.holdsPattern(t) || this.concreteness.concrete(t) ? t : this.typing.lower(t)]));
    // Every instance of the calling body shares the call's node, so each call resets it.
    if ([...own].some(([name, t]) => lowered.get(name) !== t)) this.sites.set(at, own);
    else this.sites.delete(at);
    const instance = this.instanceOf(f, new Map([...(f.scope ?? []), ...lowered]));
    if (instance.depth > 64) {
      const comptime = f.params.some((p) => p.comptime);
      const why = comptime && typeParamsOf(f).length === 0 && this.implicitOf(f).size === 0 ? "a different comptime value" : comptime ? "a different comptime value or larger type arguments" : "larger type arguments";
      throw new CompileError(`instantiating '${f.name}' never ends: each instance needs another with ${why}`, at.start, at.end);
    }
    return instance;
  }

  // A value lent as `Mut<T>`, for a type parameter `T` bounded by a type that declares one of its
  // read-only fields writable, could be changed there.
  private readOnlyKept(written: Param[], params: TypeParam[], bindings: Map<string, Type>, argTypes: Type[], args: Expr[], name: string) {
    written.forEach((p, i) => {
      const node = p.type;
      const inner = node?.kind === "ref" && node.name === "Mut" ? node.args[0] : undefined;
      const param = inner?.kind === "ref" ? params.find((q) => q.name === inner.name) : undefined;
      const given = argTypes[i];
      if (!param?.constraint || given === undefined) return;
      const r = typeof given === "string" ? undefined : this.typing.rec(given);
      const held = r?.kind === "ref" ? r.to : given;
      const bound = this.host.withScope(bindings, () => this.host.resolveType(param.constraint!));
      const unlocked = this.typing.unlocks(held, bound);
      if (unlocked) throw new CompileError(`'${unlocked}' is read-only here, but '${name}' takes it mutably as '${this.typing.show(bound)}', which could change it`, args[i]!.start, args[i]!.end);
    });
  }

  // The parameter types an instance's callers pass, or with `scopeOf(instance)`, the ones its
  // body sees.
  paramTypes(this: Mut<this>, instance: Instance, scope: Map<string, Type> = instance.bindings): Type[] {
    const f = bodyOf(instance);
    const implicit = this.implicitOf(f);
    // A generic class's instance gives its parameters what they stand for there, in an implicit
    // parameter's bound too, as a call decides the function's own.
    const outer = classPlaceholders(this.host.tables, this.host.classParams(f), (t, s) => this.host.withScope(s, () => this.host.resolveType(t)));
    const decided = new TypeMap([...outer].flatMap(([name, held]): [Type, Type][] => (scope.has(name) && scope.get(name) !== held ? [[held, scope.get(name)!]] : [])));
    return this.host.signing(f, () => this.host.withScope(scope, () => f.params.map((p, i) =>
      this.lentAs(f, i, scope.get(`#${i}`) ?? (implicit.has(i) ? this.rebound(implicit.get(i)!, decided) : undefined)) ?? this.host.paramType(p, f.self?.constructor))));
  }

  // An implicit parameter's bound with the type parameters a call or a class instance decided
  // replaced by what they stand for.
  private rebound(bound: Bound, decided: TypeMap<Type, Type>): Bound {
    if (decided.size === 0) return bound;
    const [element, asyncElement, promised] = [this.typing.generatorElement(bound), this.typing.generatorElement(bound, true), this.typing.promiseElement(bound)];
    if (element !== undefined) return this.typing.generatorInterface(this.typing.replaced(element, decided));
    if (asyncElement !== undefined) return this.typing.asyncGeneratorInterface(this.typing.replaced(asyncElement, decided));
    if (promised !== undefined) return this.typing.promiseInterface(this.typing.replaced(promised, decided));
    const b = this.typing.rec(bound);
    return b.kind === "function" || (b.kind === "interface" && b.generic) ? this.typing.replaced(bound, decided) as Bound : bound;
  }

  // What a concrete instance's body sees: each of its type parameters, and those of a generic
  // class it belongs to, offering only its bound, as at the definition, while holding the
  // concrete type for codegen.
  scopeOf(this: Mut<this>, instance: Instance): Map<string, Type> {
    const f = bodyOf(instance);
    const known = (names: string[]) => names.every((n) => instance.bindings.has(n) && this.concreteness.concrete(instance.bindings.get(n)!));
    const stands = (name: string) => instance.bindings.get(name)!;
    const outer = this.host.classParams(f);
    const scope = outer.length > 0 && known(outer.map((p) => p.name)) ? placeholders(this.typing, outer, (t, s) => this.host.withScope(s, () => this.host.resolveType(t)), stands) : new Map(f.scope);
    // A constructor taking its base's parameters also holds the base's type arguments.
    for (const [name, t] of f.scope ?? []) if (!scope.has(name)) scope.set(name, t);
    const names = [...typeParamsOf(f).map((p) => p.name), ...[...this.implicitOf(f).keys()].map((i) => `#${i}`)];
    // A function-typed parameter of a class's member is seen in terms of the class's parameters
    // as this body holds them, even while the parameter itself is still open.
    if (!known(names)) {
      if (outer.length === 0) return instance.bindings;
      // A generic method's own parameters are open here too, offering their bounds.
      for (const [name, t] of this.explicitPlaceholders(f)) if (!scope.has(name)) scope.set(name, instance.bindings.get(name) ?? t);
      for (const [i, bound] of this.implicitOf(f)) if (this.typing.rec(bound).kind === "function" && instance.bindings.has(`#${i}`)) scope.set(`#${i}`, this.typing.wrapped(this.typing.show(bound), this.sameParams(f, i, bound, scope), stands(`#${i}`)));
      return scope;
    }
    for (const [name, t] of placeholders(this.typing, typeParamsOf(f), (t, s) => this.host.withScope(new Map([...scope, ...s]), () => this.host.resolveType(t)), stands)) scope.set(name, t);
    for (const [i, bound] of this.implicitOf(f)) scope.set(`#${i}`, this.typing.wrapped(this.typing.show(bound), this.sameParams(f, i, bound, scope), stands(`#${i}`)));
    return scope;
  }

  // A function-typed parameter's bound as the body sees it: written in terms of the type
  // parameters the body itself holds, so calling it with one of them fits.
  private sameParams(f: Body, i: usize, bound: Bound, scope: Map<string, Type>): Bound {
    const written = f.params[i]!.type!;
    const t = this.host.withScope(scope, () => this.host.resolveType(written));
    const r = typeof t === "string" ? undefined : this.typing.rec(t);
    const own = r?.kind === "ref" ? r.to : t;
    return typeof own !== "string" && this.typing.rec(own).kind === this.typing.rec(bound).kind ? (own as Bound) : bound;
  }

  private generic(this: Mut<this>, f: Body): boolean {
    return typeParamsOf(f).length > 0 || this.implicitOf(f).size > 0 || f.params.some((p) => p.comptime);
  }

  // One set of placeholders per body, so a parameter's type and the body name the same `T`;
  // callers get a copy they may add to.
  private explicitPlaceholders(this: Mut<this>, f: Body): Map<string, Type> {
    let made = this.explicit.get(f.bodyId);
    if (!made) {
      // A generic method's own parameters are one placeholder for every instance of its class
      // when no bound names the class's parameters, so 'map<U>(): Box<U>' makes one 'Box<U>'.
      const own = typeParamsOf(f);
      const outer = this.host.classParams(f).map((p) => p.name);
      const shared = f.owner !== undefined && own.length > 0 && !own.some((p) => p.constraint && holdsNode("typeNode", p.constraint, (n) => n.kind === "ref" && outer.includes(n.name as string)));
      made = shared ? this.sharedPlaceholders.get(f.typeParams![0]!) : undefined;
      // A bound may name the class's own parameters, as this instance holds them.
      if (!made) made = placeholders(this.typing, own, (t, scope) => this.host.withScope(new Map([...(f.scope ?? []), ...scope]), () => this.host.resolveType(t)));
      if (shared) this.sharedPlaceholders.set(f.typeParams![0]!, made);
      this.explicit.set(f.bodyId, made);
    }
    return new Map(made);
  }

  // A parameter typed with an interface or an object type is an implicit type parameter, so
  // each concrete argument type gets its own instance instead of being copied down. A
  // parameter property and a setter's parameter keep their type, since it is a field's.
  implicitOf(this: Mut<this>, f: Body): Map<usize, Bound> {
    let found = this.implicits.get(f.bodyId);
    if (found) return found;
    found = new Map();
    this.implicits.set(f.bodyId, found);
    // A generic class's member decides this as its definition does: a parameter of the class's
    // type parameter is one in every instance, whatever that parameter stands for.
    const outer = classPlaceholders(this.host.tables, this.host.classParams(f), (t, s) => this.host.withScope(s, () => this.host.resolveType(t)));
    const scope = new Map([...(f.scope ?? []), ...outer, ...this.explicitPlaceholders(f)]);
    const borrows = new Map<usize, RefType>();
    this.lent.set(f.bodyId, borrows);
    this.host.withScope(scope, () => f.params.forEach((p, i) => {
      const written = p.type && this.host.resolveType(p.type);
      // A reference to an interface or object type is one over what it borrows.
      const w = written && typeof written !== "string" ? this.typing.rec(written) : undefined;
      const type = w?.kind === "ref" ? w.to : written;
      // An optional parameter is an Option of its type, not a type parameter.
      if (!type || typeof type === "string" || p.modifiers.length > 0 || p.optional) return;
      const t = this.typing.rec(type);
      if (f.accessor && t.kind === "interface") {
        throw new CompileError(`a setter's parameter can't have the interface type '${t.name}'`, p.start, p.end);
      }
      // A tuple's elements are inferred like any other type's parts, so it is no bound of its own.
      // A package's function or object parameter is a callback JS keeps or a JS object, its type
      // the same for every call, not a bound.
      if (!f.accessor && ((t.kind === "interface" && !(f.js && this.typing.promiseElement(type) !== undefined)) || (t.kind === "function" && !f.js) || (t.kind === "regex" && t.any) || (t.kind === "object" && !t.tuple && this.concreteness.concrete(type) && !f.js))) {
        found!.set(i, type as FunctionType | InterfaceType | ObjectType | RegexType);
        if (written !== type) borrows.set(i, written as RefType);
      }
    }));
    return found;
  }

  // What an implicit type parameter stands for in a call: the argument's own type, which must
  // satisfy the parameter's. A fresh object literal takes the declared object type instead, so
  // it gets TypeScript's excess property check.
  private implicitArgument(arg: Expr, type: Type, bound: Bound, borrowed: boolean): Type {
    // A borrowed argument stands for what it is, or what it refers to.
    const given = typeof type === "string" ? undefined : this.typing.rec(type);
    if (borrowed && given?.kind === "ref") type = given.to;
    else if (given?.kind === "ref") {
      throw new CompileError("can't move a value out of a reference to it, which only borrows it; use '.clone()' to hand over a copy", arg.start, arg.end);
    }
    // A recursive type's value stands for the type it stands for.
    type = this.typing.unfold(type);
    const message = `argument of type '${this.typing.show(type)}' is not assignable to parameter of type '${this.typing.show(bound)}'`;
    const t = typeof type === "string" ? undefined : this.typing.rec(type);
    const b = this.typing.rec(bound);
    // A generic function type takes a generic function value, whose calls each instantiate it.
    if (b.kind === "function" && b.generic) {
      const held = t?.kind === "param" && t.concrete ? this.typing.lower(type) : type;
      const h = typeof held === "string" ? undefined : this.typing.rec(held);
      // A parameter of the same generic function type is passed on as it is, the type known by
      // its signature as written.
      // ponytail: compared as shown, which misses differing bounds; compare structurally if that matters
      const family = h?.kind === "param" ? h.bound : held;
      const fam = family === undefined || typeof family === "string" ? undefined : this.typing.rec(family);
      if (fam?.kind === "function" && fam.generic && fam.name === b.name) return type;
      if (h?.kind === "closure" && h.generic) {
        const f = this.host.members.bodyNamed(h.generic);
        const reason = f && familyMismatch(f, bound as FunctionType, this.host.members, arg);
        if (reason) throw new CompileError(`${message}: ${reason}`, arg.start, arg.end);
        return type;
      }
      throw new CompileError(`${message}: it takes a generic function, one that works for every type, as '<T>(x: T) => T'`, arg.start, arg.end);
    }
    if (b.kind === "function") {
      if (!this.typing.fits(type, bound)) throw new CompileError(message, arg.start, arg.end);
      return type;
    }
    if (b.kind === "interface") {
      const reason = unsatisfied(t?.kind === "param" && t.concrete ? this.typing.lower(type) : type, bound as InterfaceType, this.host.members, arg);
      if (reason) throw new CompileError(`${message}: ${reason}`, arg.start, arg.end);
      return type;
    }
    // A fresh object literal is checked against the parameter's type when it meets it, as its
    // nested literals then take their shapes from it.
    if (arg.kind === "object" && (this.typing.holdsRef(bound) || !this.typing.fits(type, bound))) return bound;
    if (!this.typing.fits(type, bound)) throw new CompileError(message, arg.start, arg.end);
    // A value leaving out an optional field is copied into the parameter's type, which fills
    // it in empty; a reference can't be.
    const missing = lacks(this.typing, type, bound);
    if (missing && borrowed) throw new CompileError(`${message}: it has no '${missing}', which a reference can't fill in; pass one that has it`, arg.start, arg.end);
    return arg.kind === "object" || missing ? bound : type;
  }
}

// The path to a field of `to`, at any depth, that a value of `from` leaves out: an optional one,
// since `from` fits.
function lacks(typing: Typing, from: Type, to: Type, path = ""): string | undefined {
  if (typeof from === "string" || typeof to === "string") return undefined;
  const r = typing.rec(to);
  if (r.kind !== "object") return undefined;
  for (const f of r.fields) {
    const found = typing.field(from, f.name);
    const at = `${path}${f.name}`;
    const deeper = found ? lacks(typing, found.type, f.type, `${at}.`) : at;
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
  const visit = (n: AnyNode, repeated: boolean): void => {
    if (n.of === "expr" && n.node.kind === "call" && n.node.callee.kind === "ident" && n.node.callee.name === name) {
      calls++;
      if (repeated) again = true;
      return n.node.args.forEach((a) => visit({ of: "expr", node: a }, repeated));
    }
    if ((n.of === "expr" || n.of === "pattern") && n.node.kind === "ident" && n.node.name === name) again = true;
    const kind = n.of === "stmt" || n.of === "expr" ? n.node.kind : undefined;
    const loops = kind === "while" || kind === "doWhile" || kind === "for" || kind === "forOf" || kind === "forIn" || kind === "arrow";
    forEachChild(n, (c) => visit(c, repeated || loops));
  };
  f.body.forEach((s) => visit({ of: "stmt", node: s }, false));
  return again || calls > 1;
}

// What generic classes need from the checker.
export interface GenericClassesHost {
  tables: Tables;
  classes: Map<string, ClassId>;
  templates: Map<string, ClassNode & { name: string }>;
  register(c: ClassInfo): void;
  layout(c: ClassInfo): void;
  members: Members;
  resolveType(t: TypeNode): Type;
  withScope<T>(bindings: Map<string, Type>, f: () => T): T;
}

// Whether a body's signature or code writes its type parameter `name` inside a type argument, as
// in `Box<T>`, `Lock<T>` or `T[]`; a reference, a pointer or an Option to T doesn't hold one.
function heldInArgument(f: Body, name: string): boolean {
  const isT = (n: { kind?: unknown; name?: unknown }) => n.kind === "ref" && n.name === name && (n as { args: unknown[] }).args.length === 0;
  const holds = (n: { kind?: unknown; name?: unknown }) => {
    const t = n as TypeNode;
    if (t.kind === "array") return holdsNode("typeNode", t.element, isT);
    return t.kind === "ref" && t.args.length > 0 && !["Ref", "Mut", "Ptr", "MutPtr", "Option"].includes(t.name) && holdsNode("typeNode", t.args, isT);
  };
  return holdsNode("typeNode", f.params.flatMap((p) => p.type ?? []), holds) || holdsNode("typeNode", f.returnType, holds) || holdsNode("stmt", f.body, holds);
}

// Generic classes: each set of type arguments declares the class again, on first use.
export class GenericClasses {
  host: GenericClassesHost;

  constructor(host: GenericClassesHost) {
    this.host = host;
    this.typing = this.host.tables.typing;
    this.arenas = this.host.tables.arenas;
  }
  private typing: Typing;
  private arenas: Arenas;
  // Where each instance was first used, and each template's instances by their arguments.
  private uses = new TypeMap<ClassType, { c: ClassId; at: Span }>();
  private instancesOf = new NodeMap<ClassNode, Map<string, ClassId>>();
  private shapesOf = new NodeMap<ClassNode, Set<string>>();
  // An instance made while the resolver is still being built waits for `start` to check its
  // bounds and lay it out, since both need the resolver.
  private ready = false;
  // Each generic class as its definition is checked, which holds the statics every instance shares.
  private defined = new Map<string, ClassId>();
  definedClass(name: string) {
    return this.arenas.classOf(this.defined.get(name));
  }

  start(this: Mut<this>) {
    this.ready = true;
    this.uses.forEach(({ c }) => this.bounded(this.arenas.classOf(c)));
  }

  // A generic class, like a generic body, is checked once at its definition with
  // placeholders for its type parameters, whether or not anything instantiates it.
  define(this: Mut<this>) {
    this.host.templates.forEach((t) => this.defined.set(t.name, this.classInstance(t, [...classPlaceholders(this.host.tables, t.typeParams, (n, s) => this.host.withScope(s, () => this.host.resolveType(n))).values()], t).classId));
  }

  classNamed(this: Mut<this>, name: string, args: Type[], at: Span): ClassType | undefined {
    const c = this.host.tables.arenas.classOf(this.host.classes.get(name));
    if (c && args.length > 0) throw new CompileError(`type '${name}' is not generic`, at.start, at.end);
    if (c) return c.type;
    const template = this.host.templates.get(name);
    return template && this.classInstance(template, args, at).type;
  }

  // The class a generic class's type arguments make, declared on first use, checked for its
  // bounds, and named like `Box<i64>`.
  private classInstance(this: Mut<this>, template: ClassNode & { name: string }, given: Type[], at: Span): ClassInfo {
    if (given.some((a) => {
      const r = typeof a === "string" ? undefined : this.typing.rec(a);
      return (r?.kind === "function" || r?.kind === "closure") && !!r.generic;
    })) throw unsupported("generic function types as type arguments", at);
    given.forEach((a) => unboxedClosure(this.typing, a, at));
    const args = given.map((t) => this.typing.heldArgument(t));
    const params = template.typeParams;
    if (args.length !== params.length) {
      throw new CompileError(`type '${template.name}' expects ${params.length} type argument${params.length === 1 ? "" : "s"}, but got ${args.length}`, at.start, at.end);
    }
    let byKey = this.instancesOf.get(template);
    if (!byKey) this.instancesOf.set(template, byKey = new Map());
    const key = args.map((t) => this.typing.keyOf(t)).join(",");
    const found = byKey.get(key);
    if (found !== undefined) return this.arenas.classOf(found);
    // Spellings of one value shape, like `{ a?: T }` and `{ a: T | null }`, count once.
    let shapes = this.shapesOf.get(template);
    if (!shapes) this.shapesOf.set(template, shapes = new Set());
    const shape = args.map((t) => this.typing.shapeKey(t)).join(",");
    if (!shapes.has(shape) && shapes.size > 64) throw new CompileError(`instantiating '${template.name}' never ends: each instance needs another with larger type arguments`, at.start, at.end);
    if (args.some((a) => typeof a !== "string" && this.typing.rec(a).kind === "interface")) throw new CompileError("an interface can't be a type argument, since it describes values without being one", at.start, at.end);
    const scope = new Map(params.map((p, i) => [p.name, args[i]!]));
    const c = declareClass(this.host.tables, template, `${template.name}<${args.map((t) => this.typing.show(t)).join(", ")}>`, scope);
    byKey.set(key, c.classId);
    shapes.add(shape);
    this.host.register(c);
    this.uses.set(c.type, { c: c.classId, at });
    if (this.ready) this.bounded(c);
    return c;
  }

  // A generic class's type arguments must satisfy their bounds, checked where it is first used.
  private bounded(c: ClassInfo) {
    const { at } = this.uses.get(c.type)!;
    this.host.withScope(c.scope, () => c.node.typeParams.forEach((p) => p.constraint && checkBound(c.scope.get(p.name)!, this.host.resolveType(p.constraint), this.host.members, at)));
    this.host.layout(c);
  }

  // The class a `new` builds; a generic one's type arguments come from the expression or are
  // inferred from the constructor's arguments.
  construct(this: Mut<this>, name: string, typeArgs: TypeNode[], argTypes: Type[], at: Span): ClassInfo | undefined {
    const c = this.host.tables.arenas.classOf(this.host.classes.get(name));
    if (c && typeArgs.length > 0) throw new CompileError(`type '${name}' is not generic`, at.start, at.end);
    const template = this.host.templates.get(name);
    if (!template) return c;
    if (typeArgs.length > 0) return this.classInstance(template, typeArgs.map((t) => this.host.resolveType(t)), at);
    const bindings = this.inferred(template, argTypes, at);
    const args = template.typeParams.map((p) => {
      const type = bindings.get(p.name);
      if (!type) throw new CompileError(`can't infer a type for '${p.name}'; pass the type arguments explicitly`, at.start, at.end);
      return type;
    });
    return this.classInstance(template, args, at);
  }

  // A class with no constructor of its own takes its base's parameters, so its type arguments
  // are inferred through the base's, as its `extends` clause passes them on.
  private inferred(template: ClassNode, argTypes: Type[], at: Span, seen: NodeSet<ClassNode> = new NodeSet<ClassNode>()): Map<string, Type> {
    const names = new Set(template.typeParams.map((p) => p.name));
    const bindings = new Map<string, Type>();
    const ctor = template.members.find((m) => m.kind === "constructor");
    if (ctor) ctor.params.forEach((p, i) => p.type && argTypes[i] && infer(this.host.tables, p.type, argTypes[i]!, names, bindings, at));
    const base = template.extends?.kind === "instantiation" && template.extends.expr.kind === "ident" ? this.host.templates.get(template.extends.expr.name) : undefined;
    if (!ctor && base && !seen.has(base) && template.extends?.kind === "instantiation") {
      const given = this.inferred(base, argTypes, at, seen.add(template));
      const passed = template.extends.typeArgs;
      base.typeParams.forEach((p, i) => given.has(p.name) && passed[i] && infer(this.host.tables, passed[i]!, given.get(p.name)!, names, bindings, at));
    }
    return bindings;
  }
}
