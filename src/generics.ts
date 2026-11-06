import { bodyOf, type Arenas, type BodyId, type ClassId, type InstanceId } from "./arenas.ts";
import { emptyTables, holdsNode, type Instance } from "./check.ts";
import { cloneBody, declareClass, inherited, isApart, isLifetime, type Body, type ClassInfo } from "./classes.ts";
import { CompileError } from "./diag.ts";
import type { Tables } from "./compilation.ts";
import { literalValue } from "./narrow.ts";
import { unsupported } from "./unsupported.ts";
import { familyMismatch, unsatisfied, type Members } from "./interfaces.ts";
import type { ClassNode, Expr, Id, Param, Span, TypeNode, TypeParam } from "./parser.ts";
import { paramName, unboxedClosure } from "./resolve.ts";
import { INTERIORS, ITERATOR, TypeSet, TypeMap, digest, type RegexType, type FunctionType, type Bound, type ClassType, type InterfaceType, type ObjectType, type RefType, type Type, type VariantType, type Typing } from "./typing.ts";
import { NodeMap, NodeSet, forEachChild, nextId, renumberTypeNode, Rewrites, walkWhile, type AnyNode, type Ids } from "./nodes.ts";
import { cloneClassNode, cloneTypeNode, cloneTypeParam, rebuiltTypeNode } from "./rebuild.ts";

// Generic functions: the placeholders a generic body is checked with at its definition, the
// type arguments a call infers, and the bounds those arguments must satisfy.

// What resolving a type parameter's bound needs: the program's types, and a type resolved in a
// scope of type parameters.
export interface BoundResolver {
  tables: Tables;
  /** @throws {CompileError} */
  resolveIn(this: Mut<this>, scope: Ref<Map<string, Type>> | undefined, t: Ref<TypeNode>): Type;
}

// A bound is an interface or an object type, offering its members, or a type naming values, as
// `K extends "a" | "b"` does. Classes are nominal and embed rather than subclass, so a class
// bound could only ever mean that one class. Each bound is resolved with `around` in scope and the
// parameters before it. In an instance, each parameter also holds the concrete type `concrete`
// gives it.
/** @throws {CompileError} */
export function placeholders<R extends BoundResolver>(r: Mut<R>, params: TypeParam[], around: Map<string, Type> | undefined, concrete: Map<string, Type> | undefined): Map<string, Type> {
  let scope = new Map<string, Type>();
  for (const p of params) {
    if (p.modifiers.length > 0) throw new CompileError("E0801", `'${p.modifiers[0]}' type parameters are not supported yet`, p.start, p.end);
    if (p.default !== undefined) throw new CompileError("E0801", "default type arguments are not supported yet", p.default.start, p.default.end);
    let bound: ObjectType | InterfaceType | undefined = undefined;
    let within: Type | undefined = undefined;
    if (p.constraint !== undefined) {
      let seen = new Map<string, Type>();
      if (around !== undefined) for (const [n, t] of around) seen.set(n, t);
      for (const [n, t] of scope) seen.set(n, t);
      const t = r.resolveIn(seen, p.constraint);
      const kind = typeof t === "string" ? undefined : r.tables.typing.rec(t).kind;
      if (kind === "interface" || kind === "object") bound = t as ObjectType | InterfaceType;
      else if (valueBound(r.tables.typing, t)) within = t;
      else throw new CompileError("E0107", `a type parameter's bound must be an interface, an object type, or a union, primitive, literal or brand type, not '${r.tables.typing.show(t)}'`, p.constraint.start, p.constraint.end);
    }
    const stands = concrete !== undefined ? concrete.get(p.name) : undefined;
    scope.set(p.name, stands !== undefined ? r.tables.typing.wrapped(p.name, bound, stands) : r.tables.typing.typeParameter(p.name, bound, within));
  }
  return scope;
}

// Whether a type holds the placeholder `t`, directly or in a function-typed parameter's bound.
function holdsPlaceholder(typing: Ref<Typing>, given: Type, t: Type): boolean {
  return typing.holdsPart(given, (u) => {
    if (u === t) return true;
    const r = typeof u === "string" ? undefined : typing.rec(u);
    if (r === undefined || r.kind !== "param" || r.bound === undefined) return false;
    const bound = typing.rec(r.bound);
    if (bound.kind !== "function") return false;
    for (const b of bound.params) if (holdsPlaceholder(typing, b, t)) return true;
    return holdsPlaceholder(typing, bound.returns, t);
  }, true);
}

// A copy of a body's scope, empty when it has none.
function scopeCopy(f: Ref<Body>): Map<string, Type> {
  let out = new Map<string, Type>();
  if (f.scope !== undefined) for (const [n, t] of f.scope) out.set(n, t);
  return out;
}

// A copy of a generic class's declaration.
function named(t: Ref<ClassNode & { name: string }>): ClassNode & { name: string } {
  return { ...cloneClassNode(t), name: t.name };
}

// A copy of `a` with `b`'s entries over it, either of which may be missing.
function merged(a: Ref<Map<string, Type>> | undefined, b: Ref<Map<string, Type>> | undefined): Map<string, Type> {
  let out = new Map<string, Type>();
  if (a !== undefined) for (const [n, t] of a) out.set(n, t);
  if (b !== undefined) for (const [n, t] of b) out.set(n, t);
  return out;
}

// A bound naming values rather than members: a primitive, literal, pattern or brand, or a union
// with no interface or type parameter in it.
function valueBound(typing: Ref<Typing>, t: Type): boolean {
  if (typeof t === "string") return t !== "void" && t !== "never";
  const r = typing.rec(t);
  if (r.kind === "union") {
    for (const m of r.members) {
      const mr = typing.recOf(m);
      if (mr !== undefined && (mr.kind === "interface" || mr.kind === "param")) return false;
    }
    return true;
  }
  return r.kind === "literal" || r.kind === "pattern" || r.kind === "brand";
}

// The literal type of the first literal argument given for a parameter typed `name`.
function literalArgument(typing: Mut<Typing>, f: Ref<Body>, name: string, args: Ref<Expr[]>): Type | undefined {
  for (let i: usize = 0; i < f.params.length; i++) {
    const value = i < args.length ? literalValue(args[i]!) : undefined;
    if (value !== undefined && namesParam(f.params[i]!, name)) return typing.literalType(value);
  }
  return undefined;
}

// Whether a parameter is typed as the type parameter `name` itself.
function namesParam(p: Ref<Param>, name: string): boolean {
  return p.type !== undefined && p.type.kind === "ref" && p.type.name === name && p.type.args.length === 0;
}

// A generic class's placeholders, one set shared by its definition check and its members,
// since each new set would name another instance of the class. They are kept by the class's
// first type parameter, which only its own list holds; a list of none has nothing to share.
/** @throws {CompileError} */
function classPlaceholders<R extends BoundResolver>(r: Mut<R>, params: TypeParam[]): Map<string, Type> {
  if (params.length === 0) return new Map<string, Type>();
  const key = cloneTypeParam(params[0]!);
  const found = r.tables.classScopes.get(key);
  if (found !== undefined) return found;
  const made = placeholders(r, params, undefined, undefined);
  r.tables.classScopes.set(cloneTypeParam(key), made);
  return r.tables.classScopes.get(key)!;
}

// A body's type parameters, leaving out its lifetimes.
export function typeParamsOf(f: Ref<Body>): TypeParam[] {
  let out: TypeParam[] = [];
  if (f.typeParams !== undefined) for (const p of f.typeParams) if (!isLifetime(p)) out.push(cloneTypeParam(p));
  return out;
}

// Binds the type parameters `node` names by matching it against an argument's type, looking
// through the check's type aliases.
/** @throws {CompileError} */
export function infer(tables: Mut<Tables>, node: Ref<TypeNode>, arg: Type, names: Ref<Set<string>>, bindings: Mut<Map<string, Type>>, at: Ref<Span>): void {
  arg = tables.typing.unfold(arg);
  // `Pair<T>` naming a generic alias matches what the alias stands for, its parameters given
  // as written.
  const alias = node.kind === "ref" && node.args.length > 0 && !names.has(node.name) ? tables.aliases.get(node.name) : undefined;
  if (node.kind === "ref" && alias !== undefined && alias.typeParams.length === node.args.length && !tables.expanding.has(alias.name)) {
    let given = new Map<string, TypeNode>();
    for (let i: usize = 0; i < alias.typeParams.length; i++) given.set(alias.typeParams[i]!.name, cloneTypeNode(node.args[i]!));
    const name = alias.name;
    const body = substituted(tables.ids, alias.type, given);
    tables.expanding.add(name);
    try {
      infer(tables, body, arg, names, bindings, at);
    } finally {
      tables.expanding.delete(name);
    }
  }
  if (node.kind === "ref" && node.args.length === 0 && names.has(node.name)) {
    arg = tables.typing.widenEnum(arg);
    const earlier = bindings.get(node.name);
    // A closure meeting T already decided as the stored callable it fits is boxed into it, as one
    // given first is boxed where the body holds T in a type argument.
    if (earlier !== undefined && tables.typing.sameCallable(earlier, tables.typing.heldArgument(arg))) return;
    if (earlier !== undefined && tables.typing.sameCallable(tables.typing.heldArgument(earlier), arg)) {
      bindings.set(node.name, arg);
      return;
    }
    // A literal and its base type, as a string literal and a callback taking a string give,
    // agree on the base type, as TypeScript widens them.
    if (earlier !== undefined && earlier !== arg && tables.typing.widenLet(earlier) === tables.typing.widenLet(arg)) {
      bindings.set(node.name, tables.typing.widenLet(arg));
      return;
    }
    // An `unknown` takes whatever else is given beside it, as TypeScript infers it.
    if (earlier !== undefined && tables.typing.isUnknown(earlier) && tables.typing.fits(arg, earlier)) return;
    if (earlier !== undefined && tables.typing.isUnknown(arg) && tables.typing.fits(earlier, arg)) {
      bindings.set(node.name, arg);
      return;
    }
    if (earlier !== undefined && !(tables.typing.sameLowered(earlier, arg) && tables.typing.sameLowered(arg, earlier))) {
      throw new CompileError("E0104", `the type argument for '${node.name}' can't be both '${tables.typing.show(earlier)}' and '${tables.typing.show(arg)}'`, at.start, at.end);
    }
    bindings.set(node.name, arg);
    return;
  }
  const a = typeof arg === "string" ? undefined : tables.typing.rec(arg);
  // `T | null`, `Option<T>` and `T | string` against a value: the members the written ones
  // already cover say nothing, and the rest are T, as TypeScript infers. Absence alone gives no T.
  const option = node.kind === "ref" && node.name === "Option" && node.args.length === 1 && !names.has(node.name);
  const members = node.kind === "union" ? node.types : node.kind === "ref" && option ? node.args : undefined;
  if (members !== undefined) {
    // The one member naming a type parameter decides it, from what the others don't cover.
    let open: usize | undefined = undefined;
    let opens: usize = 0;
    for (let i: usize = 0; i < members.length; i++) {
      if (!holdsNode({ of: "typeNode", node: members[i]! }, (x) => x.of === "typeNode" && x.node.kind === "ref" && names.has(x.node.name))) continue;
      opens++;
      open = i;
    }
    if (opens !== 1 || open === undefined) return;
    let given: Type[] = [];
    if (a !== undefined && a.kind === "union") for (const m of a.members) given.push(m);
    else given.push(arg);
    let rest: Type[] = [];
    for (const m of given) {
      if (option && m === "null") continue;
      let covered = false;
      for (let i: usize = 0; i < members.length; i++) if (i !== open && covers(tables.typing, members[i]!, m)) covered = true;
      if (!covered) rest.push(m);
    }
    if (rest.length > 0) infer(tables, members[open]!, rest.length === 1 ? rest[0]! : tables.typing.unionType(rest), names, bindings, at);
    return;
  }
  // `Ref<T>` against a value or a reference borrows a T.
  if (node.kind === "ref" && (node.name === "Ref" || node.name === "Mut") && node.args.length >= 1 && !names.has(node.name)) {
    infer(tables, node.args[0]!, a?.kind === "ref" ? a.to : arg, names, bindings, at);
    return;
  }
  // A function type against a closure binds through its parameters and what it gives.
  if (node.kind === "function" && a?.kind === "closure") {
    for (let i: usize = 0; i < node.params.length && i < a.params.length; i++) {
      const written = node.params[i]!.type;
      if (written !== undefined) infer(tables, written, a.params[i]!, names, bindings, at);
    }
    if (a.returns !== "void" || node.returns.kind !== "ref" || !names.has(node.returns.name)) infer(tables, node.returns, a.returns, names, bindings, at);
    if (node.throws !== undefined && a.throws !== undefined) infer(tables, node.throws, a.throws, names, bindings, at);
    return;
  }
  // `Ptr<T>` against a raw pointer points at a T.
  if (node.kind === "ref" && (node.name === "Ptr" || node.name === "MutPtr") && node.args.length === 1 && !names.has(node.name)) {
    if (a?.kind === "pointer") infer(tables, node.args[0]!, a.to, names, bindings, at);
    return;
  }
  // `Lock<T>` against a Lock holds a T.
  if (node.kind === "ref" && INTERIORS.has(node.name) && node.args.length === 1 && !names.has(node.name)) {
    if (a?.kind === "interior" && a.which === node.name) infer(tables, node.args[0]!, a.of, names, bindings, at);
    return;
  }
  if (node.kind === "ref" && node.name === "Channel" && node.args.length === 1 && !names.has(node.name)) {
    if (a?.kind === "block" && a.which === "Channel") infer(tables, node.args[0]!, a.of, names, bindings, at);
    return;
  }
  // `Map<K, V>` and `Set<T>` against one match their key and value types.
  if (node.kind === "ref" && (node.name === "Map" || node.name === "Set") && !names.has(node.name)) {
    if (a !== undefined && a.kind === "map" && a.set === (node.name === "Set") && a.dict !== true) {
      if (node.args.length > 0) infer(tables, node.args[0]!, a.key, names, bindings, at);
      if (node.args.length > 1) infer(tables, node.args[1]!, a.value, names, bindings, at);
    }
    return;
  }
  // `Record<string, V>` and `{ [k: string]: V }` against a dictionary match its value type.
  const index = node.kind === "object" && node.members.length === 1 ? node.members[0] : undefined;
  const entry = node.kind === "ref" && node.name === "Record" && node.args.length === 2 && !names.has(node.name) ? node.args[1] : index?.kind === "index" ? index.type : undefined;
  if (entry && a?.kind === "map" && a.dict) {
    infer(tables, entry, a.value, names, bindings, at);
    return;
  }
  if (node.kind === "ref" && (node.name === "shared" || node.name === "Rc" || node.name === "Weak") && node.args.length === 1 && !names.has(node.name)) {
    if (a?.kind === "shared" && a.which === node.name) infer(tables, node.args[0]!, a.of, names, bindings, at);
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
  const trait = typeof held === "string" ? undefined : tables.typing.rec(held);
  if (node.kind === "ref" && trait?.kind === "interface" && trait.generic?.name === node.name) {
    node.args.forEach((n, i) => trait.generic!.args[i] && infer(tables, n, trait.generic!.args[i]!, names, bindings, at));
    return;
  }
  // `Promise<T>` against a promise matches what it gives.
  if (node.kind === "ref" && node.name === "Promise" && node.args.length === 1 && !names.has(node.name)) {
    const gives = a?.kind === "future" ? a.gives : tables.typing.promiseElement(arg);
    if (gives !== undefined) infer(tables, node.args[0]!, gives, names, bindings, at);
    return;
  }
  // `Generator<T>` against a generator matches what it yields.
  // A parameter of a generator interface, or one standing for a generator, yields too.
  if (node.kind === "ref" && node.name === "Generator" && node.args.length >= 1 && tables.typing.yieldsOf(arg) !== undefined) {
    infer(tables, node.args[0]!, tables.typing.yieldsOf(arg)!, names, bindings, at);
    return;
  }
  // `Iterable<T>` against anything a loop reads matches what it reads.
  if (node.kind === "ref" && node.name === "Iterable" && node.args.length === 1 && !names.has(node.name) && tables.typing.iteratedBy(arg) !== undefined) {
    infer(tables, node.args[0]!, tables.typing.iteratedBy(arg)!, names, bindings, at);
    return;
  }
  if (node.kind === "ref" && node.name === "AsyncGenerator" && node.args.length >= 1 && tables.typing.yieldsOf(arg, true) !== undefined) {
    infer(tables, node.args[0]!, tables.typing.yieldsOf(arg, true)!, names, bindings, at);
    return;
  }
  // `FixedArray<T, N>` against a fixed array matches its element type.
  if (node.kind === "ref" && node.name === "FixedArray" && node.args.length === 2 && a?.kind === "fixed") {
    infer(tables, node.args[0]!, a.element, names, bindings, at);
    return;
  }
  if (node.kind === "operator" && node.op === "readonly" && node.type.kind === "tuple") {
    infer(tables, node.type, arg, names, bindings, at);
    return;
  }
  // `[A, B]` against a tuple of its length matches element by element.
  // An optional element matches what it holds when there, and a rest element the tuple's array.
  const fixed = node.kind === "tuple" ? node.elements.filter((n) => !n.rest) : [];
  if (node.kind === "tuple" && tables.typing.isTuple(arg) && tables.typing.elementsOf(arg as ObjectType).length === fixed.length && (fixed.length < node.elements.length) === (tables.typing.rec(arg as ObjectType).rest !== undefined)) {
    const elements = tables.typing.elementsOf(arg as ObjectType);
    // An optional element left out says nothing about its type.
    fixed.forEach((n, i) => (n.optional && elements[i] === "null") || infer(tables, n.type, n.optional ? tables.typing.withoutNull(elements[i]!) : elements[i]!, names, bindings, at));
    const rest = node.elements.find((n) => n.rest);
    if (rest) infer(tables, rest.type, tables.typing.arrayType(tables.typing.rec(arg as ObjectType).rest!), names, bindings, at);
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
    const found = tables.typing.field(arg, m.name);
    if (found) infer(tables, m.type, found.type, names, bindings, at);
  }
}

// Whether a member of a union as written already covers a member of the union an argument is.
function covers(typing: Mut<Typing>, n: Ref<TypeNode>, m: Type): boolean {
  if (n.kind === "ref") return n.args.length === 0 && (m === "null" ? n.name === "null" || n.name === "undefined" : n.name === typing.show(m) || n.name === typing.show(typing.widenLet(m)));
  if (n.kind !== "literal" || typeof m === "string") return false;
  const r = typing.rec(m);
  if (r.kind !== "literal") return false;
  return literalIs(n.value, r.value);
}

function literalIs(v: Ref<Expr>, value: string | bigint | boolean): boolean {
  if (v.kind === "string") return v.value === value;
  if (v.kind === "bool") return v.value === value;
  if (v.kind === "bigint") return v.value === value;
  if (v.kind === "int") return v.value === value;
  return false;
}

// A type written with some names standing for other types, as an alias's body with its
// parameters given.
// The copy is renumbered before its names are replaced, so what the replacing records is the
// copy's, never the alias's own nodes.
function substituted(ids: Mut<Ids>, node: Ref<TypeNode>, given: Ref<Map<string, TypeNode>>): TypeNode {
  const copy = renumberTypeNode(cloneTypeNode(node), () => nextId(ids));
  let rewrites = new Rewrites();
  walkWhile({ of: "typeNode", node: copy }, (n) => {
    if (n.of !== "typeNode") return true;
    const t = n.node;
    if (t.kind !== "ref" || t.args.length !== 0) return true;
    const by = given.get(t.name);
    if (by === undefined) return true;
    rewrites.replaceTypeNode(t, by);
    return false;
  });
  return rebuiltTypeNode(copy, rewrites);
}

// A type argument must satisfy its parameter's bound: an interface by shape, an object type
// by fitting it.
/** @throws {CompileError} */
export function checkBound(type: Type, bound: Type, members: Mut<Members>, at: Ref<Span>) {
  const trait = typeof bound === "string" ? undefined : members.typing.rec(bound);
  const interfaced = trait !== undefined && trait.kind === "interface";
  const reason = interfaced ? unsatisfied(type, bound as InterfaceType, members, { start: at.start, end: at.end })
    : members.typing.fits(type, bound) ? undefined : "";
  if (reason === undefined) return;
  throw new CompileError("E0107", `type '${members.typing.show(type)}' does not satisfy the constraint '${members.typing.show(bound)}'${reason !== "" ? `: ${reason}` : ""}`, at.start, at.end);
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
        if (r.generic !== undefined) for (const a of r.generic.args) if (!this.concrete(a)) return false;
        return r.base === undefined || this.concrete(r.base);
      } finally {
        this.visiting.delete(t as ClassType);
      }
    }
    // A type holding itself through an array is as concrete as the type arguments it was made with.
    const tied = this.typing.tiedBy(t);
    if (tied !== undefined) return this.typing.rec(tied).args.every((t) => this.concrete(t));
    if (r.kind === "union") return r.members.every((t) => this.concrete(t));
    if (r.kind === "ref" || r.kind === "pointer") return this.concrete(r.to);
    if (r.kind === "handle") return this.concrete(r.gives) && (r.throws === undefined || this.concrete(r.throws));
    if (r.kind === "interior" || r.kind === "shared" || r.kind === "block") return this.concrete(r.of);
    if (r.kind === "dyn" || r.kind === "regex") return true;
    if (r.kind === "closure" || r.kind === "generator" || r.kind === "future") return r.concrete;
    if (r.kind === "array" || r.kind === "fixed") return this.concrete(r.element);
    if (r.kind === "map") return this.concrete(r.key) && this.concrete(r.value);
    if (r.kind === "recursive") return r.args.every((t) => this.concrete(t));
    if (r.kind === "variant") {
      const known = this.concreteVariants.get(t as VariantType);
      if (known !== undefined) return known;
      let all = true;
      for (const a of r.args) if (all && !this.concrete(a)) all = false;
      for (const f of r.fields) if (all && !this.concrete(f.type)) all = false;
      this.concreteVariants.set(t as VariantType, all);
      return all;
    }
    const known = this.concreteObjects.get(t as ObjectType);
    if (known !== undefined) return known;
    let all = true;
    for (const f of r.fields) if (all && !this.concrete(f.type)) all = false;
    this.concreteObjects.set(t as ObjectType, all);
    return all;
  }
}

// What instantiating needs from the checker.
export interface InstancingHost {
  tables: Tables;
  /** @throws {CompileError} */
  resolveType(t: TypeNode): Type;
  /** @throws {CompileError} */
  paramType(p: Param, property?: boolean): Type;
  /** @throws {CompileError} */
  resolveIn(this: Mut<this>, scope: Ref<Map<string, Type>> | undefined, t: Ref<TypeNode>): Type;
  // A type in a body's own signature, where its parameter names shadow top-level ones.
  /** @throws {CompileError} */
  resolveSigned(this: Mut<this>, f: BodyId, scope: Ref<Map<string, Type>>, t: Ref<TypeNode>): Type;
  // A body's parameter's type, in its signature.
  /** @throws {CompileError} */
  paramTypeIn(this: Mut<this>, f: BodyId, scope: Ref<Map<string, Type>>, i: usize): Type;
  members(this: Mut<this>): Members;
  instancingState: InstancingState;
  // The instance being checked, which new instantiations count their depth from.
  checking(): Instance | undefined;
  // The type parameters of the generic class a body belongs to, if any.
  /** @throws {CompileError} */
  classParams(f: Ref<Body>): TypeParam[];
  // A comptime parameter's argument, computed while compiling, as the literal type of its value.
  /** @throws {CompileError} */
  comptimeArgument(arg: Expr): Type;
  // The error a body's check failed with, when it did.
  failure(f: Ref<Body>): CompileError | undefined;
  /** @throws {CompileError} */
  replaced(this: Mut<this>, t: Type, swap: Ref<TypeMap<Type, Type>>): Type;
}

// The instances of every body: one for a plain function, and for a generic one, its
// definition check plus one per set of type arguments its calls need.
// The binding a comptime parameter's value is kept under, beside the type parameters'.
/** @throws {CompileError} */
export function comptimeName(p: Ref<Param>): string {
  return `comptime ${paramName(p)}`;
}

// The instances made so far and what making them worked out, kept by the host between uses.
export class InstancingState {
  concreteness: Concreteness;
  explicit = new Map<BodyId, Map<string, Type>>();
  instances = new Map<BodyId, Map<string, InstanceId>>();
  // By the method's first type parameter, which only its own list holds.
  sharedPlaceholders = new NodeMap<TypeParam, Map<string, Type>>();
  implicits = new Map<BodyId, Map<usize, Bound>>();
  // Which implicit parameters are references to their type, and how.
  lent = new Map<BodyId, Map<usize, RefType>>();
  definitions = new Map<BodyId, InstanceId>();
  // Instances still to check.
  pending: InstanceId[] = [];
  // What a call made inside an instance passed for each type parameter, where that was one of
  // the instance's own.
  sites = new NodeMap<Span & Id, Map<string, Type>>();

  constructor(typing: Typing) {
    this.concreteness = new Concreteness(typing);
  }
}

export class Instancing<H extends InstancingHost> {
  host: Mut<H>;

  constructor(host: Mut<H>) {
    this.host = host;
  }
  all(): InstanceId[] {
    let out: InstanceId[] = [];
    for (const m of this.host.instancingState.instances.values()) for (const i of m.values()) out.push(i);
    return out;
  }
  siteOf(at: Span & Id) {
    return this.host.instancingState.sites.get(at);
  }

  // The type an arrow given as a generic body's argument is checked against: its parameter's
  // function type, with the type parameters the other arguments, or the written type
  // arguments, have decided. What it gives decides the rest, through \`infer\`.
  /** @throws {CompileError} */
  callbackType(this: Mut<this>, f: Ref<Body>, typeArgs: TypeNode[], argTypes: (Type | undefined)[], i: usize, at: Span): FunctionType | undefined {
    const written = i < f.params.length && f.params[i]!.type !== undefined ? cloneTypeNode(f.params[i]!.type!) : undefined;
    const params = typeParamsOf(f);
    // A parameter written as a type parameter given a function type, by the call as in
    // `id<(x: i64) => i64>((x) => x * 2)` or by its class's instance, types the arrow as that function.
    if (written?.kind === "ref" && written.args.length === 0) {
      const k = params.findIndex((p) => p.name === written.name);
      const given = k < 0 ? (f.scope !== undefined ? f.scope.get(written.name) : undefined) : typeArgs.length === params.length ? this.host.resolveType(cloneTypeNode(typeArgs[k as usize]!)) : undefined;
      const r = given === undefined || typeof given === "string" ? undefined : this.host.tables.typing.rec(given);
      if (r?.kind === "dyn") return this.host.tables.typing.callableOf.get(r.of);
      if (r?.kind !== "function") return undefined;
      if (r.generic !== undefined) throw unsupported("generic function types as type arguments", at);
      return given as FunctionType;
    }
    if (written?.kind !== "function" || !this.generic(f)) return undefined;
    let bindings = new Map<string, Type>();
    if (typeArgs.length === params.length) for (let k: usize = 0; k < params.length; k++) bindings.set(params[k]!.name, this.host.resolveType(cloneTypeNode(typeArgs[k]!)));
    else {
      const names = new Set(params.map((p) => p.name));
      for (let k: usize = 0; k < f.params.length && k < argTypes.length; k++) {
        const t = f.params[k]!.type;
        const given = argTypes[k];
        if (t !== undefined && given !== undefined && k !== i) infer(this.host.tables, t, given, names, bindings, at);
      }
    }
    // Inferred from a literal, a type parameter types the arrow as its base type; written, as the
    // instance has it, so a callable the arrow is given fits the instance's own.
    const explicit = typeArgs.length === params.length;
    let scope = new Map<string, Type>();
    if (f.scope !== undefined) for (const [n, t] of f.scope) scope.set(n, t);
    for (const [n, t] of this.explicitPlaceholders(f)) scope.set(n, t);
    for (const [n, t] of bindings) scope.set(n, explicit ? this.host.tables.typing.lowerKeepingBrands(t) : this.host.tables.typing.widenLet(this.host.tables.typing.lowerKeepingBrands(t)));
    const resolved = this.host.resolveIn(scope, written);
    const t = typeof resolved === "string" ? undefined : this.host.tables.typing.rec(resolved);
    if (t?.kind !== "function") return undefined;
    // A parameter only the callback itself could decide is left for the call to report.
    const undecided = [...this.explicitPlaceholders(f)].filter(([n]) => !bindings.has(n)).map(([, p]) => p);
    if (t.params.some((p) => this.host.tables.typing.holdsPart(p, (u) => undecided.includes(u), true))) return undefined;
    // What it gives is left open while it names a type parameter the call hasn't decided.
    const undecidedIn = (u: Type) => this.host.tables.typing.holdsPart(u, (v) => {
      const r = typeof v === "string" ? undefined : this.host.tables.typing.rec(v);
      return r?.kind === "param" && r.concrete === undefined;
    }, true);
    const open = undecidedIn(t.returns);
    // So is what it throws, which the arrow then infers.
    const openError = t.throws !== undefined && undecidedIn(t.throws);
    const made = this.host.tables.typing.functionType(written.params.map((p, k) => (p.pattern.kind === "ident" ? p.pattern.name : `p${k}`)), t.params, open ? "void" : t.returns, openError ? undefined : t.throws);
    if (openError) this.host.tables.typing.openThrows.add(made);
    return made;
  }

  // A generic class's constructor lent a value as `Mut<T>` keeps its read-only fields too.
  /** @throws {CompileError} */
  constructs(this: Mut<this>, f: Ref<Body>, args: Expr[], argTypes: Type[]) {
    let scope = new Map<string, Type>();
    if (f.scope !== undefined) for (const [n, t] of f.scope) scope.set(n, t);
    const params = this.classParamsOf(f);
    const name = f.owner !== undefined ? this.host.tables.typing.rec(f.owner).name : f.name;
    readOnlyKept(this.host, f.params, params, scope, argTypes, args, name);
  }

  // A body's written return type. A reference to the type a reference parameter borrows is
  // to what that parameter points at, which may be wider, so a caller reads it as it is.
  /** @throws {CompileError} */
  returnTypeOf(this: Mut<this>, f: Ref<Body>, scope: Map<string, Type>): Type | undefined {
    return this.writtenReturn(f, scope);
  }
  /** @throws {CompileError} */
  private writtenReturn(this: Mut<this>, f: Ref<Body>, scope: Map<string, Type>): Type | undefined {
    if (f.returnType === undefined) return undefined;
    // `x is T` is a boolean that tells a caller's condition what x is.
    if (f.returnType.kind === "predicate") {
      const p = f.returnType;
      if (p.asserts) throw unsupported("assertion signatures", p);
      if (p.name === "this") throw unsupported("'this' type predicates", p);
      const param = f.params.find((x) => x.pattern.kind === "ident" && x.pattern.name === p.name);
      if (param === undefined) throw new CompileError("E0114", `a type predicate names one of the function's parameters, and '${p.name}' isn't one`, p.start, p.end);
      const narrowed = p.type !== undefined ? this.host.resolveSigned(f.bodyId, scope, p.type) : undefined;
      const declared = param.type !== undefined ? this.host.resolveSigned(f.bodyId, scope, param.type) : undefined;
      // A predicate on a borrowed parameter says what the value it points to is.
      const ref = declared !== undefined && typeof declared !== "string" ? this.host.tables.typing.rec(declared) : undefined;
      const held = ref?.kind === "ref" ? ref.to : declared;
      if (narrowed !== undefined && held !== undefined && !this.host.tables.typing.fits(narrowed, held)) throw new CompileError("E0101", `a type predicate's type must be assignable to its parameter's type, and '${this.host.tables.typing.show(narrowed)}' isn't a '${this.host.tables.typing.show(held)}'`, p.type!.start, p.type!.end);
      return "boolean";
    }
    // A function type returned is a stored callable, and a `Promise<T>` a boxed future, except
    // as an async function's own result, which its `Promise<T>` describes.
    // In a method's return type, `this` is the class of the receiver: each subclass checks its own copy.
    let self = new Map<string, Type>();
    for (const [n, t] of scope) self.set(n, t);
    if (f.self !== undefined && !f.self.constructor) self.set("this", f.self.type);
    const written = this.host.resolveSigned(f.bodyId, self, f.returnType);
    const returned = f.async === true ? written : this.host.tables.typing.stored(written);
    if (typeof returned === "string") return returned;
    const t = this.host.tables.typing.rec(returned);
    if (t.kind !== "ref") return returned;
    // Only the one parameter the result borrows from, by its lifetime or by elision.
    const implicit = this.implicitOf(f);
    const refs = f.params.flatMap((p, i) => {
      const lent = this.host.instancingState.lent.get(f.bodyId);
      const kept = lent !== undefined ? lent.get(i as usize) : undefined;
      const type = kept !== undefined ? kept : p.type !== undefined ? this.host.resolveSigned(f.bodyId, scope, p.type) : undefined;
      const r = type !== undefined && typeof type !== "string" ? this.host.tables.typing.rec(type) : undefined;
      return r !== undefined && r.kind === "ref" && (t.life === undefined || r.life === t.life) ? [i] : [];
    });
    const [i] = refs;
    const bound = i !== undefined && refs.length === 1 && !(f.self && !f.self.constructor && !t.life) ? implicit.get(i) : undefined;
    return bound && this.host.instancingState.lent.get(f.bodyId)?.has(i!) && this.host.tables.typing.lower(t.to) === this.host.tables.typing.lower(bound) ? this.host.tables.typing.refType(scope.get(`#${i}`) ?? bound, t.mutable, t.life) : returned;
  }

  // A body's parameter types as written: an implicit parameter's is its interface or object
  // type, which is what an interface's method signature is compared with.
  /** @throws {CompileError} */
  declaredParams(this: Mut<this>, f: Ref<Body>): Type[] {
    const implicit = this.implicitOf(f);
    let scope = new Map<string, Type>();
    if (f.scope !== undefined) for (const [n, t] of f.scope) scope.set(n, t);
    let out: Type[] = [];
    for (let i: usize = 0; i < f.params.length; i++) {
      const implicitType = this.implicitParam(f, i, implicit.get(i));
      out.push(implicitType !== undefined ? implicitType : this.host.paramTypeIn(f.bodyId, scope, i));
    }
    return out;
  }

  // An implicit parameter's type as the body and its callers see it: borrowed when it is a
  // reference, and empty when it is optional and left out.
  private implicitParam(this: Mut<this>, f: Ref<Body>, i: usize, t: Type | undefined): Type | undefined {
    return t !== undefined && f.params[i]!.optional ? this.host.tables.typing.unionType([t, "null"]) : this.lentAs(f, i, t);
  }

  // An implicit parameter's type, borrowed when the parameter is a reference to it.
  private lentAs(this: Mut<this>, f: Ref<Body>, i: usize, t: Type | undefined): Type | undefined {
    const lent = this.host.instancingState.lent.get(f.bodyId);
    const ref = lent !== undefined ? lent.get(i) : undefined;
    if (t === undefined || ref === undefined) return t;
    const { mutable, life } = this.host.tables.typing.rec(ref);
    return this.host.tables.typing.refType(t, mutable, life);
  }

  // A generic body is checked once at its definition, with placeholders for its type
  // parameters, whether or not anything instantiates it.
  // It is made once per body: fresh placeholders would make a new instance each time.
  /** @throws {CompileError} */
  definition(this: Mut<this>, f: Ref<Body>): Ref<Instance> {
    if (!this.generic(f)) return this.instanceOf(f);
    const known = this.host.instancingState.definitions.get(f.bodyId);
    if (known !== undefined) return this.host.tables.arenas.instanceOf(known);
    let scope = this.explicitPlaceholders(f);
    for (const [i, bound] of this.implicitOf(f)) {
      const shown = this.host.tables.typing.show(bound);
      const same = this.sameParams(f, i, bound, merged(scopeCopy(f), scope));
      scope.set(`#${i}`, this.host.tables.typing.typeParameter(shown, same));
    }
    // A comptime parameter's value is known only at each call; the definition has a placeholder.
    for (const p of f.params) if (p.comptime) scope.set(comptimeName(p), this.host.tables.typing.typeParameter(comptimeName(p), undefined));
    const found = this.instanceOf(f, merged(scopeCopy(f), scope));
    const id = found.id;
    this.host.instancingState.definitions.set(f.bodyId, id);
    return this.host.tables.arenas.instanceOf(id);
  }

  // A concrete instance's symbol: its name and a hash of its type arguments, rather than a count,
  // so it is the same in every program using it. Arguments shown alike get numbered suffixes.
  private instanceSymbol(this: Mut<this>, name: string, bindings: Map<string, Type>, others: Map<string, InstanceId>): string {
    const stem = `${name}#${digest([...bindings].map(([k, t]) => `${k}=${this.host.tables.typing.described(t)}`).join(","))}`;
    const symbols = new Set([...others.values()].map((i) => this.host.tables.arenas.instanceOf(i).symbol));
    let symbol = stem;
    for (let n = 1; symbols.has(symbol); n++) symbol = `${stem}.${n}`;
    return symbol;
  }

  // A member of a generic class's instance runs with the class's type arguments in scope.
  /** @throws {CompileError} */
  instanceOf(this: Mut<this>, f: Ref<Body>, given?: Map<string, Type>): Ref<Instance> {
    const bindings = given !== undefined ? given : scopeCopy(f);
    const key = [...bindings.values()].map((t) => this.host.tables.typing.keyOf(t)).join(",");
    if (!this.host.instancingState.instances.has(f.bodyId)) this.host.instancingState.instances.set(f.bodyId, new Map<string, InstanceId>());
    let byKey = this.host.instancingState.instances.get(f.bodyId)!;
    const known = byKey.get(key);
    if (known !== undefined) return this.host.tables.arenas.instanceOf(known);
    // Every type parameter, implicit ones included, needs a concrete binding to compile.
    const complete = typeParamsOf(f).every((p) => bindings.has(p.name)) && [...this.implicitOf(f).keys()].every((i) => bindings.has(`#${i}`)) && f.params.every((p) => !p.comptime || bindings.has(comptimeName(p)));
    const isConcrete = complete && [...bindings].every(([name, t]) => isApart(name) || this.host.instancingState.concreteness.concrete(t));
    const generic = bindings.size > 0;
    const body = this.host.tables.arenas.addBody(cloneBody(f)).bodyId;
    const symbol = generic && isConcrete ? this.instanceSymbol(f.name, bindings, byKey) : f.name;
    const checking = this.host.checking();
    const depth = generic && checking !== undefined ? checking.depth + 1 : 0;
    const found = this.host.tables.arenas.addInstance({
      body, symbol, bindings, concrete: isConcrete,
      depth, returns: "void",
      ...emptyTables(),
    });
    byKey.set(key, found.id);
    this.host.instancingState.pending.push(found.id);
    return found;
  }

  // The instance a call runs: a generic function's type arguments come from the call, or are
  // inferred from its arguments, and must satisfy their bounds.
  /** @throws {CompileError} */
  instantiate(this: Mut<this>, f: Ref<Body>, typeArgs: TypeNode[], args: Expr[], argTypes: Type[], at: Span & Id): Ref<Instance> {
    // A call of a body whose signature failed, or whose result only its body could tell, would
    // report the same mistake again in other words; one with a written signature is typed by it.
    const failed = this.host.failure(f);
    const signature = { start: f.start, end: f.body.length > 0 ? f.body[0]!.start : f.end };
    if (failed !== undefined && (f.returnType === undefined || (failed.start >= signature.start && failed.end <= signature.end))) throw failed;
    const params = typeParamsOf(f);
    if (typeArgs.length > 0 && typeArgs.length !== params.length) {
      throw new CompileError("E0106", `expected ${params.length} type argument${params.length === 1 ? "" : "s"}, but got ${typeArgs.length}`, at.start, at.end);
    }
    if (!this.generic(f)) return this.instanceOf(f);
    // Optional parameters may be left out at the end.
    const required = f.params.filter((p) => !p.optional).length;
    if (args.length < required || args.length > f.params.length) {
      const expected = required === f.params.length ? `${required}` : `${required}-${f.params.length}`;
      throw new CompileError("E0501", `expected ${expected} argument${expected === "1" ? "" : "s"}, but got ${args.length}`, at.start, at.end);
    }
    let bindings = new Map<string, Type>();
    if (typeArgs.length > 0) {
      for (let i: usize = 0; i < params.length; i++) bindings.set(params[i]!.name, this.host.tables.typing.heldArgument(this.host.resolveType(typeArgs[i]!)));
    } else {
      const names = new Set(params.map((p) => p.name));
      for (let i: usize = 0; i < f.params.length && i < argTypes.length; i++) {
        const written = f.params[i]!.type;
        if (written !== undefined) infer(this.host.tables, written, this.iteratesAs(written, argTypes[i]!, at), names, bindings, at);
      }
      // `G extends Generator<U>` decides `U` from what `G`'s generator yields.
      for (const p of params) {
        const c = p.constraint;
        const yields = bindings.has(p.name) ? this.host.tables.typing.yieldsOf(bindings.get(p.name)!) : undefined;
        if (c?.kind === "ref" && c.name === "Generator" && c.args.length === 1 && yields !== undefined) infer(this.host.tables, c.args[0]!, yields, names, bindings, at);
      }
    }
    for (const p of params) {
      const type = bindings.get(p.name);
      if (type === undefined) throw new CompileError("E0104", `can't infer a type for '${p.name}'; pass the type arguments explicitly`, at.start, at.end);
      const r = typeof type === "string" ? undefined : this.host.tables.typing.rec(type);
      if (r?.kind === "interface") {
        throw new CompileError("E0115", `an interface can't be a type argument, since it describes values without being one`, at.start, at.end);
      }
      if (r !== undefined && r.kind === "function" && r.generic !== undefined) throw unsupported("generic function types as type arguments", at);
      // A closure inferred for T is the closure's own type, compiled for it, unless the body holds
      // T in a type argument, which holds the boxed callable, as a written function type is.
      if ((r?.kind === "closure" || r?.kind === "function") && heldInArgument(f, p.name)) bindings.set(p.name, this.host.tables.typing.heldArgument(type));
    }
    // A bound may name the class's parameters too, as this instance of it holds them.
    let bounded = new Map<string, Type>();
    if (f.scope !== undefined) for (const [n, t] of f.scope) bounded.set(n, t);
    for (const [n, t] of bindings) bounded.set(n, t);
    for (const p of params) {
      if (p.constraint === undefined) continue;
      const bound = this.host.resolveIn(bounded, p.constraint);
      // A number literal argument is that literal where the bound takes it and not its type, as
      // `lt(1)` with `K extends 1 | 2` infers `1` in TypeScript.
      const literal = typeArgs.length === 0 && !this.host.tables.typing.fits(bindings.get(p.name)!, bound) ? literalArgument(this.host.tables.typing, f, p.name, args) : undefined;
      if (literal !== undefined && this.host.tables.typing.fits(literal, bound)) bindings.set(p.name, literal);
      let members = this.host.members();
      checkBound(bindings.get(p.name)!, bound, members, at);
    }
    // A type parameter only an arrow's own parameters decided is still the definition's
    // placeholder, which the arrow was typed with; a body calling itself passes its placeholder
    // on in an argument of its own.
    const open = new TypeSet([...this.explicitPlaceholders(f).values()]);
    // A placeholder an argument holds, directly or in a function-typed parameter's bound.
    if (typeArgs.length === 0) for (const p of params) {
      const t = bindings.get(p.name)!;
      if (!open.has(t)) continue;
      let held = false;
      for (let i: usize = 0; i < args.length && i < argTypes.length; i++) if (!held && args[i]!.kind !== "arrow" && holdsPlaceholder(this.host.tables.typing, argTypes[i]!, t)) held = true;
      if (!held) throw new CompileError("E0104", `can't infer a type for '${p.name}'; pass the type arguments explicitly`, at.start, at.end);
    }
    readOnlyKept(this.host, f.params, params, bindings, argTypes, args, f.name);
    // An argument from inside another instance may be one of its type parameters; the instance
    // is keyed by what that stands for, and the call site remembers the parameter itself.
    const own = new Map(params.map((p): [string, Type] => [p.name, bindings.get(p.name)!]));
    // A `Generator<T>` or `Promise<T>` bound names the function's own type parameters, which the
    // call has just decided, so the argument is checked against what they stand for.
    // So does a function type's, and the class's own parameters stand for what this class
    // instance gives them.
    const classParams = this.classParamsOf(f);
    const outer = classPlaceholders(this.host, classParams);
    const decided = new TypeMap([
      ...[...this.explicitPlaceholders(f)].flatMap(([name, held]): [Type, Type][] => (bindings.has(name) ? [[held, bindings.get(name)!]] : [])),
      ...[...outer].flatMap(([name, held]): [Type, Type][] => (f.scope?.has(name) ? [[held, f.scope.get(name)!]] : [])),
    ]);
    for (const [i, bound] of this.implicitOf(f)) {
      const meant = rebound(this.host, bound, decided);
      if (f.params[i]!.optional) {
        own.set(`#${i}`, this.presentArgument(args[i], argTypes[i], meant));
        continue;
      }
      own.set(`#${i}`, this.implicitArgument(args[i]!, argTypes[i]!, meant, this.host.instancingState.lent.get(f.bodyId)!.get(i)));
      const given = argTypes[i]!;
      const r = typeof given === "string" ? undefined : this.host.tables.typing.rec(given);
      const held = r?.kind === "ref" ? r.to : given;
      const ref = this.host.instancingState.lent.get(f.bodyId)!.get(i);
      const unlocked = ref && this.host.tables.typing.rec(ref).mutable ? this.host.tables.typing.unlocks(held, bound) : undefined;
      if (unlocked) throw new CompileError("E0206", `'${unlocked}' is read-only here, but '${f.name}' takes it mutably as '${this.host.tables.typing.show(bound)}', which could change it`, args[i]!.start, args[i]!.end);
      if (r?.kind === "closure" && r.once && repeats(f, paramName(f.params[i]!))) {
        throw new CompileError("E0210", `'${f.name}' may call '${paramName(f.params[i]!)}' more than once, but this closure moves '${r.once}' out, so it can run only once`, args[i]!.start, args[i]!.end);
      }
    }
    // Each value a comptime parameter is given makes an instance of its own.
    f.params.forEach((p, i) => p.comptime && own.set(comptimeName(p), this.host.comptimeArgument(args[i]!)));
    // A type argument holding a pattern keeps it, so the instance's parameters still ask for it;
    // one holding no type parameter keeps how its fields were spelled, which printing and JSON
    // read.
    const lowered = new Map([...own].map(([name, t]): [string, Type] => [name, this.host.tables.typing.holdsPattern(t) || this.host.instancingState.concreteness.concrete(t) ? t : this.host.tables.typing.lowerKeepingBrands(t)]));
    // Every instance of the calling body shares the call's node, so each call resets it.
    if ([...own].some(([name, t]) => lowered.get(name) !== t)) this.host.instancingState.sites.set(at, own);
    else this.host.instancingState.sites.delete(at);
    const instance = this.instanceOf(f, new Map([...(f.scope ?? []), ...lowered]));
    if (instance.depth > 64) {
      const comptime = f.params.some((p) => p.comptime);
      const why = comptime && typeParamsOf(f).length === 0 && this.implicitOf(f).size === 0 ? "a different comptime value" : comptime ? "a different comptime value or larger type arguments" : "larger type arguments";
      throw new CompileError("E0113", `instantiating '${f.name}' never ends: each instance needs another with ${why}`, at.start, at.end);
    }
    return instance;
  }

  // The parameter types an instance's callers pass, or with `scopeOf(instance)`, the ones its
  // body sees.
  /** @throws {CompileError} */
  paramTypes(this: Mut<this>, instance: Ref<Instance>, given?: Map<string, Type>): Type[] {
    const scope = given !== undefined ? given : merged(instance.bindings, undefined);
    const f = bodyOf(this.host.tables.arenas, instance);
    const implicit = this.implicitOf(f);
    // A generic class's instance gives its parameters what they stand for there, in an implicit
    // parameter's bound too, as a call decides the function's own.
    const classParams = this.classParamsOf(f);
    const outer = classPlaceholders(this.host, classParams);
    let decided = new TypeMap<Type, Type>();
    for (const [name, held] of outer) {
      const given = scope.get(name);
      if (given !== undefined && given !== held) decided.set(held, given);
    }
    let out: Type[] = [];
    for (let i: usize = 0; i < f.params.length; i++) {
      const given = scope.get(`#${i}`);
      const bound = given !== undefined ? given : implicit.has(i) ? rebound(this.host, implicit.get(i)!, decided) : undefined;
      const implicitType = this.implicitParam(f, i, bound);
      out.push(implicitType !== undefined ? implicitType : this.host.paramTypeIn(f.bodyId, scope, i));
    }
    return out;
  }

  // What a concrete instance's body sees: each of its type parameters, and those of a generic
  // class it belongs to, offering only its bound, as at the definition, while holding the
  // concrete type for codegen.
  /** @throws {CompileError} */
  scopeOf(this: Mut<this>, instance: Ref<Instance>): Map<string, Type> {
    const f = bodyOf(this.host.tables.arenas, instance);
    const outer = this.host.classParams(f);
    const outerCount = outer.length;
    let scope = new Map<string, Type>();
    if (outer.length > 0 && this.known(instance, outer.map((p) => p.name))) scope = placeholders(this.host, outer, undefined, merged(instance.bindings, undefined));
    else if (f.scope !== undefined) for (const [n, t] of f.scope) scope.set(n, t);
    // A constructor taking its base's parameters also holds the base's type arguments.
    if (f.scope !== undefined) for (const [name, t] of f.scope) if (!scope.has(name)) scope.set(name, t);
    const names = [...typeParamsOf(f).map((p) => p.name), ...[...this.implicitOf(f).keys()].map((i) => `#${i}`)];
    // A function-typed parameter of a class's member is seen in terms of the class's parameters
    // as this body holds them, even while the parameter itself is still open.
    if (!this.known(instance, names)) {
      if (outerCount === 0) return merged(instance.bindings, undefined);
      // A generic method's own parameters are open here too, offering their bounds.
      for (const [name, t] of this.explicitPlaceholders(f)) if (!scope.has(name)) scope.set(name, instance.bindings.get(name) ?? t);
      for (const [i, bound] of this.implicitOf(f)) {
        if (this.host.tables.typing.rec(bound).kind !== "function" || !instance.bindings.has(`#${i}`)) continue;
        const shown = this.host.tables.typing.show(bound);
        const same = this.sameParams(f, i, bound, scope);
        scope.set(`#${i}`, this.host.tables.typing.wrapped(shown, same, instance.bindings.get(`#${i}`)!));
      }
      return scope;
    }
    for (const [name, t] of placeholders(this.host, typeParamsOf(f), merged(scope, undefined), merged(instance.bindings, undefined))) scope.set(name, t);
    for (const [i, bound] of this.implicitOf(f)) {
      const shown = this.host.tables.typing.show(bound);
      const same = this.sameParams(f, i, bound, scope);
      scope.set(`#${i}`, this.host.tables.typing.wrapped(shown, same, instance.bindings.get(`#${i}`)!));
    }
    return scope;
  }

  // Whether an instance gives each of `names` a concrete type.
  private known(this: Mut<this>, instance: Ref<Instance>, names: string[]): boolean {
    for (const n of names) {
      const t = instance.bindings.get(n);
      if (t === undefined || !this.host.instancingState.concreteness.concrete(t)) return false;
    }
    return true;
  }

  // A generic class's type parameters, for the body of one of its members.
  /** @throws {CompileError} */
  private classParamsOf(this: Mut<this>, f: Ref<Body>): TypeParam[] {
    let out: TypeParam[] = [];
    for (const p of this.host.classParams(f)) out.push(cloneTypeParam(p));
    return out;
  }

  // A function-typed parameter's bound as the body sees it: written in terms of the type
  // parameters the body itself holds, so calling it with one of them fits.
  /** @throws {CompileError} */
  private sameParams(f: Ref<Body>, i: usize, bound: Bound, scope: Map<string, Type>): Bound {
    const t = this.host.resolveIn(scope, f.params[i]!.type!);
    const r = typeof t === "string" ? undefined : this.host.tables.typing.rec(t);
    const own = r?.kind === "ref" ? r.to : t;
    return typeof own !== "string" && this.host.tables.typing.rec(own).kind === this.host.tables.typing.rec(bound).kind ? (own as Bound) : bound;
  }

  /** @throws {CompileError} */
  private generic(this: Mut<this>, f: Ref<Body>): boolean {
    return typeParamsOf(f).length > 0 || this.implicitOf(f).size > 0 || f.params.some((p) => p.comptime);
  }

  // One set of placeholders per body, so a parameter's type and the body name the same `T`;
  // callers get a copy they may add to.
  /** @throws {CompileError} */
  private explicitPlaceholders(this: Mut<this>, f: Ref<Body>): Map<string, Type> {
    let made = this.host.instancingState.explicit.get(f.bodyId);
    if (made === undefined) {
      // A generic method's own parameters are one placeholder for every instance of its class
      // when no bound names the class's parameters, so 'map<U>(): Box<U>' makes one 'Box<U>'.
      const own = typeParamsOf(f);
      const outer = this.host.classParams(f).map((p) => p.name);
      const shared = f.owner !== undefined && own.length > 0 && !own.some((p) => p.constraint !== undefined && holdsNode({ of: "typeNode", node: p.constraint }, (n) => n.of === "typeNode" && n.node.kind === "ref" && outer.includes(n.node.name)));
      made = shared ? this.host.instancingState.sharedPlaceholders.get(f.typeParams![0]!) : undefined;
      // A bound may name the class's own parameters, as this instance holds them.
      const around = scopeCopy(f);
      if (made === undefined) made = placeholders(this.host, own, around, undefined);
      if (shared) this.host.instancingState.sharedPlaceholders.set(cloneTypeParam(f.typeParams![0]!), merged(made, undefined));
      const copy = merged(made, undefined);
      this.host.instancingState.explicit.set(f.bodyId, made);
      return copy;
    }
    return merged(made, undefined);
  }

  // What a class argument to an `Iterable<T>` parameter, or a reference to one, gives to infer `T`
  // from: what its `[Symbol.iterator]` method gives, which inference alone can't read.
  /** @throws {CompileError} */
  private iteratesAs(this: Mut<this>, node: TypeNode, t: Type, at: Span): Type {
    const written = unlent(node);
    if (written.kind !== "ref" || written.name !== "Iterable") return t;
    const r = typeof t === "string" ? undefined : this.host.tables.typing.rec(t);
    const held = r?.kind === "ref" ? r.to : t;
    if (this.host.tables.typing.recOf(held)?.kind !== "class") return t;
    const members = this.host.members();
    const method = inherited(members.arenas, members.classOf(held as ClassType), "methods", ITERATOR);
    if (method === undefined) return t;
    const gives = members.returnOf(method.bodyId, at);
    return r?.kind === "ref" ? this.host.tables.typing.refType(gives, r.mutable) : gives;
  }

  // A parameter typed with an interface or an object type is an implicit type parameter, so
  // each concrete argument type gets its own instance instead of being copied down. A
  // parameter property and a setter's parameter keep their type, since it is a field's, save a
  // parameter property of a function type.
  /** @throws {CompileError} */
  implicitOf(this: Mut<this>, f: Ref<Body>): Map<usize, Bound> {
    let found = this.host.instancingState.implicits.get(f.bodyId);
    if (found !== undefined) return found;
    found = new Map<usize, Bound>();
    this.host.instancingState.implicits.set(f.bodyId, found);
    // A generic class's member decides this as its definition does: a parameter of the class's
    // type parameter is one in every instance, whatever that parameter stands for.
    const classParams = this.classParamsOf(f);
    const outer = classPlaceholders(this.host, classParams);
    let scope = merged(scopeCopy(f), outer);
    for (const [n, t] of this.explicitPlaceholders(f)) scope.set(n, t);
    const borrows = new Map<usize, RefType>();
    this.host.instancingState.lent.set(f.bodyId, borrows);
    f.params.forEach((p, i) => {
      const written = p.type !== undefined ? this.host.resolveIn(scope, p.type) : undefined;
      // A reference to an interface or object type is one over what it borrows.
      const w = written !== undefined && typeof written !== "string" ? this.host.tables.typing.rec(written) : undefined;
      const type = w?.kind === "ref" ? w.to : written;
      // An optional parameter is an Option of its type, not a type parameter, save one of an
      // interface type, which is an Option of a type parameter. One with a default holds the
      // default's type when left out, which differs from an argument's, so it stays refused. A
      // function-typed parameter property takes a closure as a declared field assigned from a
      // parameter does.
      const optional = p.optional && (written !== type || this.host.tables.typing.recOf(type)?.kind !== "interface" || this.host.tables.defaulted.has(p));
      if (type === undefined || typeof type === "string" || optional) return;
      const t = this.host.tables.typing.rec(type);
      if (p.modifiers.length > 0 && t.kind !== "function") return;
      if (f.accessor === true && t.kind === "interface") {
        throw new CompileError("E0705", `a setter's parameter can't have the interface type '${t.name}'`, p.start, p.end);
      }
      // A tuple's elements are inferred like any other type's parts, so it is no bound of its own.
      // A package's function or object parameter is a callback JS keeps or a JS object, its type
      // the same for every call, not a bound.
      if (f.accessor !== true && ((t.kind === "interface" && !(f.js !== undefined && this.host.tables.typing.promiseElement(type) !== undefined)) || (t.kind === "function" && f.js === undefined) || (t.kind === "regex" && t.any === true) || (t.kind === "object" && t.tuple !== true && this.host.instancingState.concreteness.concrete(type) && f.js === undefined))) {
        found!.set(i, type as FunctionType | InterfaceType | ObjectType | RegexType);
        if (written !== type) borrows.set(i, written as RefType);
      }
    });
    return found;
  }

  // What an optional interface parameter stands for in a call: what the argument holds besides
  // null. A call leaving it out or passing null makes an instance where it is always empty, whose
  // type only needs to satisfy the bound: an array for an `Iterable`, so loops over it check, and
  // otherwise `never`.
  /** @throws {CompileError} */
  private presentArgument(this: Mut<this>, arg: Expr | undefined, type: Type | undefined, bound: Bound): Type {
    const element = this.host.tables.typing.iterableElement(bound);
    const absent = element !== undefined ? this.host.tables.typing.arrayType(element) : "never";
    if (arg === undefined || type === undefined || type === "null") return absent;
    const r = typeof type === "string" ? undefined : this.host.tables.typing.rec(type);
    const held = r?.kind === "union" && r.members.includes("null") ? this.host.tables.typing.unionType(r.members.filter((m) => m !== "null")) : type;
    if (this.host.tables.typing.lower(held) === "never") return absent;
    return this.implicitArgument(arg, held, bound, undefined);
  }

  // What an implicit type parameter stands for in a call: the argument's own type, which must
  // satisfy the parameter's. A fresh object literal takes the declared object type instead, so
  // it gets TypeScript's excess property check.
  /** @throws {CompileError} */
  private implicitArgument(this: Mut<this>, arg: Expr, type: Type, bound: Bound, lent: RefType | undefined): Type {
    const borrowed = lent !== undefined;
    // A borrowed argument stands for what it is, or what it refers to.
    const given = typeof type === "string" ? undefined : this.host.tables.typing.rec(type);
    // Looping over a generator advances it, which a shared reference to one can't.
    const referred = given?.kind === "ref" ? given.to : type;
    if (lent !== undefined && !this.host.tables.typing.rec(lent).mutable && this.host.tables.typing.iterableElement(bound) !== undefined && this.host.tables.typing.recOf(this.host.tables.typing.lower(referred))?.kind === "generator") {
      throw new CompileError("E0206", `an 'Iterable' parameter is looped over, which advances a generator, so a generator passed by reference needs a 'Mut' parameter, not a 'Ref'`, arg.start, arg.end);
    }
    if (borrowed && given?.kind === "ref") type = given.to;
    else if (given?.kind === "ref") {
      throw new CompileError("E0202", "can't move a value out of a reference to it, which only borrows it; use '.clone()' to hand over a copy", arg.start, arg.end);
    }
    // A recursive type's value stands for the type it stands for.
    type = this.host.tables.typing.unfold(type);
    // Only an instance where an optional interface parameter was left out holds a 'never', and
    // that code never runs, so it stands in for any bound.
    if (this.host.tables.typing.lower(type) === "never") return "never";
    const message = `argument of type '${this.host.tables.typing.show(type)}' is not assignable to parameter of type '${this.host.tables.typing.show(bound)}'`;
    const t = typeof type === "string" ? undefined : this.host.tables.typing.rec(type);
    const b = this.host.tables.typing.rec(bound);
    // A generic function type takes a generic function value, whose calls each instantiate it.
    if (b.kind === "function" && b.generic !== undefined) {
      const held = t !== undefined && t.kind === "param" && t.concrete !== undefined ? this.host.tables.typing.lower(type) : type;
      const h = typeof held === "string" ? undefined : this.host.tables.typing.rec(held);
      // A parameter of the same generic function type is passed on as it is, the type known by
      // its signature as written.
      // ponytail: compared as shown, which misses differing bounds; compare structurally if that matters
      const family = h?.kind === "param" ? h.bound : held;
      const fam = family === undefined || typeof family === "string" ? undefined : this.host.tables.typing.rec(family);
      if (fam !== undefined && fam.kind === "function" && fam.generic !== undefined && fam.name === b.name) return type;
      if (h !== undefined && h.kind === "closure" && h.generic !== undefined) {
        const f = this.host.members().bodyNamed(h.generic);
        const reason = f !== undefined ? familyMismatch(f.bodyId, bound as FunctionType, this.host.members(), arg) : undefined;
        if (reason !== undefined && reason !== "") throw new CompileError("E0101", `${message}: ${reason}`, arg.start, arg.end);
        return type;
      }
      throw new CompileError("E0101", `${message}: it takes a generic function, one that works for every type, as '<T>(x: T) => T'`, arg.start, arg.end);
    }
    if (b.kind === "function") {
      if (!this.host.tables.typing.fits(type, bound)) throw new CompileError("E0101", message, arg.start, arg.end);
      return type;
    }
    if (b.kind === "interface") {
      const reason = unsatisfied(t?.kind === "param" && t.concrete ? this.host.tables.typing.lower(type) : type, bound as InterfaceType, this.host.members(), arg);
      if (reason) throw new CompileError("E0101", `${message}: ${reason}`, arg.start, arg.end);
      return type;
    }
    // A fresh object literal is checked against the parameter's type when it meets it, as its
    // nested literals then take their shapes from it.
    if (arg.kind === "object" && (this.host.tables.typing.holdsRef(bound) || !this.host.tables.typing.fits(type, bound))) return bound;
    if (!this.host.tables.typing.fits(type, bound)) throw new CompileError("E0101", message, arg.start, arg.end);
    // A value leaving out an optional field is copied into the parameter's type, which fills
    // it in empty; a reference can't be.
    const missing = lacks(this.host.tables.typing, type, bound);
    if (missing && borrowed) throw new CompileError("E0101", `${message}: it has no '${missing}', which a reference can't fill in; pass one that has it`, arg.start, arg.end);
    return arg.kind === "object" || missing ? bound : type;
  }
}

// The path to a field of `to`, at any depth, that a value of `from` leaves out: an optional one,
// since `from` fits.
function lacks(typing: Ref<Typing>, from: Type, to: Type, path = ""): string | undefined {
  if (typeof from === "string" || typeof to === "string") return undefined;
  const r = typing.rec(to);
  if (r.kind !== "object") return undefined;
  for (const f of r.fields) {
    const found = typing.field(from, f.name);
    const at = `${path}${f.name}`;
    const deeper = found !== undefined ? lacks(typing, found.type, f.type, `${at}.`) : at;
    if (deeper !== undefined) return deeper;
  }
  return undefined;
}

// Whether a body may call its function-typed parameter `name` more than once: it calls it
// twice, or in a loop or a closure, which may run again, or uses it any other way, as passing
// it on. A name shadowing the parameter counts too, which only errs towards caution.
function repeats(f: Ref<Body>, name: string): boolean {
  let count: Calls = { calls: 0, again: false };
  for (const s of f.body) callsIn({ of: "stmt", node: s }, name, false, count);
  return count.again || count.calls > 1;
}

type Calls = { calls: usize; again: boolean };

function callsIn(n: AnyNode, name: string, repeated: boolean, count: Mut<Calls>): void {
  if (n.of === "expr" && n.node.kind === "call" && n.node.callee.kind === "ident" && n.node.callee.name === name) {
    count.calls++;
    if (repeated) count.again = true;
    for (const a of n.node.args) callsIn({ of: "expr", node: a }, name, repeated, count);
    return;
  }
  if (n.of === "expr" && n.node.kind === "ident" && n.node.name === name) count.again = true;
  if (n.of === "pattern" && n.node.kind === "ident" && n.node.name === name) count.again = true;
  const kind = n.of === "stmt" ? n.node.kind : n.of === "expr" ? n.node.kind : undefined;
  const loops = kind === "while" || kind === "doWhile" || kind === "for" || kind === "forOf" || kind === "forIn" || kind === "arrow";
  forEachChild(n, (c) => callsIn(c, name, repeated || loops, count));
}

// What generic classes need from the checker.
export interface GenericClassesHost {
  tables: Tables;
  classes: Map<string, ClassId>;
  templates: Map<string, ClassNode & { name: string }>;
  register(c: ClassInfo): void;
  /** @throws {CompileError} */
  /** @throws {CompileError} */
  layout(this: Mut<this>, c: ClassId): void;
  members(this: Mut<this>): Members;
  genericClassesState: GenericClassesState;
  /** @throws {CompileError} */
  resolveType(t: TypeNode): Type;
  /** @throws {CompileError} */
  resolveIn(this: Mut<this>, scope: Ref<Map<string, Type>> | undefined, t: Ref<TypeNode>): Type;
}

// The type a parameter written `Mut<T>` lends, by the name `T` it is written with.
function mutOf(p: Ref<Param>): string | undefined {
  if (p.type === undefined || p.type.kind !== "ref" || p.type.name !== "Mut" || p.type.args.length === 0) return undefined;
  return refName(p.type.args[0]!);
}

function refName(t: Ref<TypeNode>): string | undefined {
  return t.kind === "ref" ? t.name : undefined;
}

// What a parameter written `Ref<T>` or `Mut<T>` borrows, or its type.
function unlent(node: Ref<TypeNode>): Ref<TypeNode> {
  if (node.kind === "ref" && (node.name === "Ref" || node.name === "Mut") && node.args.length === 1) return node.args[0]!;
  return node;
}

// Whether a body's signature or code writes its type parameter `name` inside a type argument, as
// in `Box<T>`, `Lock<T>` or `T[]`; a reference, a pointer or an Option to T doesn't hold one.
function heldInArgument(f: Ref<Body>, name: string): boolean {
  const isT = (n: AnyNode) => n.of === "typeNode" && n.node.kind === "ref" && n.node.name === name && n.node.args.length === 0;
  const holds = (n: AnyNode) => {
    if (n.of !== "typeNode") return false;
    const t = n.node;
    if (t.kind === "array") return holdsNode({ of: "typeNode", node: t.element }, isT);
    return t.kind === "ref" && t.args.length > 0 && !["Ref", "Mut", "Ptr", "MutPtr", "Option"].includes(t.name) && t.args.some((a) => holdsNode({ of: "typeNode", node: a }, isT));
  };
  return f.params.some((p) => p.type !== undefined && holdsNode({ of: "typeNode", node: p.type }, holds)) || (f.returnType !== undefined && holdsNode({ of: "typeNode", node: f.returnType }, holds)) || holdsNode({ of: "stmts", node: f.body }, holds);
}

// A value lent as `Mut<T>`, for a type parameter `T` bounded by a type that declares one of its
// read-only fields writable, could be changed there.
/** @throws {CompileError} */
function readOnlyKept<H extends InstancingHost>(host: Mut<H>, written: Ref<Param[]>, params: Ref<TypeParam[]>, bindings: Ref<Map<string, Type>>, argTypes: Ref<Type[]>, args: Ref<Expr[]>, name: string): void {
  for (let i: usize = 0; i < written.length; i++) {
    const lent = mutOf(written[i]!);
    if (lent === undefined || i >= argTypes.length) continue;
    let constraint: TypeNode | undefined = undefined;
    for (const q of params) if (constraint === undefined && q.name === lent && q.constraint !== undefined) constraint = cloneTypeNode(q.constraint);
    if (constraint === undefined) continue;
    const given = argTypes[i]!;
    const r = typeof given === "string" ? undefined : host.tables.typing.rec(given);
    const held = r !== undefined && r.kind === "ref" ? r.to : given;
    const bound = host.resolveIn(bindings, constraint);
    const unlocked = host.tables.typing.unlocks(held, bound);
    if (unlocked !== undefined) throw new CompileError("E0206", `'${unlocked}' is read-only here, but '${name}' takes it mutably as '${host.tables.typing.show(bound)}', which could change it`, args[i]!.start, args[i]!.end);
  }
}

// An implicit parameter's bound with the type parameters a call or a class instance decided
// replaced by what they stand for.
/** @throws {CompileError} */
function rebound<H extends InstancingHost>(host: Mut<H>, bound: Bound, decided: Ref<TypeMap<Type, Type>>): Bound {
  if (decided.size === 0) return bound;
  const [element, asyncElement, promised] = [host.tables.typing.generatorElement(bound), host.tables.typing.generatorElement(bound, true), host.tables.typing.promiseElement(bound)];
  if (element !== undefined) return host.tables.typing.generatorInterface(host.replaced(element, decided));
  const iterable = host.tables.typing.iterableElement(bound);
  if (iterable !== undefined) return host.tables.typing.iterableInterface(host.replaced(iterable, decided));
  if (asyncElement !== undefined) return host.tables.typing.asyncGeneratorInterface(host.replaced(asyncElement, decided));
  if (promised !== undefined) return host.tables.typing.promiseInterface(host.replaced(promised, decided));
  const b = host.tables.typing.rec(bound);
  return b.kind === "function" || (b.kind === "interface" && b.generic !== undefined) ? host.replaced(bound, decided) as Bound : bound;
}

// The generic classes' instances so far, kept by the host between uses.
export class GenericClassesState {
  // Where each instance was first used, and each template's instances by their arguments.
  uses = new TypeMap<ClassType, { c: ClassId; at: Span; derived?: boolean }>();
  instancesOf = new NodeMap<ClassNode, Map<string, ClassId>>();
  shapesOf = new NodeMap<ClassNode, Set<string>>();
  // An instance made while the resolver is still being built waits for `start` to check its
  // bounds and lay it out, since both need the resolver.
  ready = false;
  // Each generic class as its definition is checked, which holds the statics every instance shares.
  defined = new Map<string, ClassId>();
}

// Generic classes: each set of type arguments declares the class again, on first use.
export class GenericClasses<H extends GenericClassesHost> {
  host: Mut<H>;

  constructor(host: Mut<H>) {
    this.host = host;
  }
  definedClass(name: string) {
    return this.host.tables.arenas.classOf(this.host.genericClassesState.defined.get(name));
  }

  /** @throws {CompileError} */
  start(this: Mut<this>) {
    this.host.genericClassesState.ready = true;
    let used: ClassId[] = [];
    for (const u of this.host.genericClassesState.uses.values()) used.push(u.c);
    for (const c of used) this.bounded(c);
  }

  // A generic class, like a generic body, is checked once at its definition with
  // placeholders for its type parameters, whether or not anything instantiates it.
  /** @throws {CompileError} */
  define(this: Mut<this>) {
    let templates: (ClassNode & { name: string })[] = [];
    for (const t of this.host.templates.values()) templates.push({ ...cloneClassNode(t), name: t.name });
    while (templates.length > 0) {
      const t = templates.shift()!;
      let params: TypeParam[] = [];
      for (const p of t.typeParams) params.push(cloneTypeParam(p));
      let args: Type[] = [];
      for (const a of classPlaceholders(this.host, params).values()) args.push(a);
      const name = t.name;
      const at = { start: t.start, end: t.end };
      const made = this.classInstance(t, args, at).classId;
      this.host.genericClassesState.defined.set(name, made);
    }
  }

  /** @throws {CompileError} */
  classNamed(this: Mut<this>, name: string, args: Type[], at: Span, derived = false): ClassType | undefined {
    const c = this.host.tables.arenas.classOf(this.host.classes.get(name));
    if (c !== undefined && args.length > 0) throw new CompileError("E0106", `type '${name}' is not generic`, at.start, at.end);
    if (c !== undefined) return c.type;
    const template = this.host.templates.get(name);
    return template !== undefined ? this.classInstance(named(template), args, at, derived).type : undefined;
  }

  // The class a generic class's type arguments make, declared on first use, checked for its
  // bounds, and named like `Box<i64>`.
  /** @throws {CompileError} */
  private classInstance(this: Mut<this>, template: ClassNode & { name: string }, given: Type[], at: Span, derived = false): Ref<ClassInfo> {
    if (given.some((a) => {
      const r = typeof a === "string" ? undefined : this.host.tables.typing.rec(a);
      return r !== undefined && (r.kind === "function" || r.kind === "closure") && r.generic !== undefined;
    })) throw unsupported("generic function types as type arguments", at);
    given.forEach((a) => unboxedClosure(this.host.tables.typing, a, at));
    const args = given.map((t) => this.host.tables.typing.heldArgument(t));
    const params = template.typeParams;
    if (args.length !== params.length) {
      throw new CompileError("E0106", `type '${template.name}' expects ${params.length} type argument${params.length === 1 ? "" : "s"}, but got ${args.length}`, at.start, at.end);
    }
    let byKey = this.host.genericClassesState.instancesOf.get(template);
    if (!byKey) this.host.genericClassesState.instancesOf.set(template, byKey = new Map());
    const key = args.map((t) => this.host.tables.typing.keyOf(t)).join(",");
    const found = byKey.get(key);
    if (found !== undefined) return this.host.tables.arenas.classOf(found);
    // Spellings of one value shape, like `{ a?: T }` and `{ a: T | null }`, count once.
    let shapes = this.host.genericClassesState.shapesOf.get(template);
    if (!shapes) this.host.genericClassesState.shapesOf.set(template, shapes = new Set());
    const shape = args.map((t) => this.host.tables.typing.shapeKey(t)).join(",");
    if (!shapes.has(shape) && shapes.size > 64) throw new CompileError("E0113", `instantiating '${template.name}' never ends: each instance needs another with larger type arguments`, at.start, at.end);
    if (args.some((a) => typeof a !== "string" && this.host.tables.typing.rec(a).kind === "interface")) throw new CompileError("E0115", "an interface can't be a type argument, since it describes values without being one", at.start, at.end);
    const scope = new Map(params.map((p, i) => [p.name, args[i]!]));
    const c = this.host.tables.arenas.classOf(declareClass(this.host.tables, template, `${template.name}<${args.map((t) => this.host.tables.typing.show(t)).join(", ")}>`, scope));
    byKey.set(key, c.classId);
    this.host.tables.typing.noteClassInstance(template.name, key, c.type);
    shapes.add(shape);
    this.host.register(c);
    this.host.genericClassesState.uses.set(c.type, { c: c.classId, at, derived });
    if (args.some((a) => this.host.tables.typing.lowerKeepingBrands(a) !== a)) {
      this.classInstance(template, args.map((a) => this.host.tables.typing.lowerKeepingBrands(a)), at, true);
    }
    if (this.host.genericClassesState.ready) this.bounded(c.classId);
    return c;
  }

  // A generic class's type arguments must satisfy their bounds, checked where it is first used.
  // One made from another's arguments, as lowering makes one holding a brand's base or a member
  // views its class through its type parameters, was checked as that other.
  /** @throws {CompileError} */
  private bounded(this: Mut<this>, id: ClassId) {
    const c = this.host.tables.arenas.classOf(id);
    const use = this.host.genericClassesState.uses.get(c.type)!;
    if (use.derived !== true) {
      let scope = new Map<string, Type>();
      for (const [n, t] of c.scope) scope.set(n, t);
      let params: TypeParam[] = [];
      for (const p of c.node.typeParams) params.push(cloneTypeParam(p));
      for (const p of params) {
        if (p.constraint === undefined) continue;
        const bound = this.host.resolveIn(scope, p.constraint);
        let members = this.host.members();
        checkBound(scope.get(p.name)!, bound, members, use.at);
      }
    }
    this.host.layout(id);
  }

  // The class a `new` builds; a generic one's type arguments come from the expression or are
  // inferred from the constructor's arguments.
  /** @throws {CompileError} */
  construct(this: Mut<this>, name: string, typeArgs: TypeNode[], argTypes: Type[], at: Span): Ref<ClassInfo> | undefined {
    const c = this.host.tables.arenas.classOf(this.host.classes.get(name));
    if (c !== undefined && typeArgs.length > 0) throw new CompileError("E0106", `type '${name}' is not generic`, at.start, at.end);
    const template = this.host.templates.get(name);
    if (template === undefined) return c;
    if (typeArgs.length > 0) {
      let args: Type[] = [];
      for (const t of typeArgs) args.push(this.host.resolveType(cloneTypeNode(t)));
      return this.classInstance(named(template), args, at);
    }
    const bindings = this.inferred(named(template), argTypes, { start: at.start, end: at.end }, new NodeSet<ClassNode>());
    const args = template.typeParams.map((p) => {
      const type = bindings.get(p.name);
      if (type === undefined) throw new CompileError("E0104", `can't infer a type for '${p.name}'; pass the type arguments explicitly`, at.start, at.end);
      return type;
    });
    return this.classInstance(template, args, at);
  }

  // A class with no constructor of its own takes its base's parameters, so its type arguments
  // are inferred through the base's, as its `extends` clause passes them on.
  /** @throws {CompileError} */
  private inferred(this: Mut<this>, template: ClassNode & { name: string }, argTypes: Type[], at: Span, seen: NodeSet<ClassNode>): Map<string, Type> {
    let names = new Set<string>();
    for (const p of template.typeParams) names.add(p.name);
    let bindings = new Map<string, Type>();
    let hasConstructor = false;
    for (const m of template.members) {
      if (m.kind !== "constructor" || hasConstructor) continue;
      hasConstructor = true;
      for (let i: usize = 0; i < m.params.length; i++) {
        if (m.params[i]!.type !== undefined && i < argTypes.length) infer(this.host.tables, m.params[i]!.type!, argTypes[i]!, names, bindings, { start: at.start, end: at.end });
      }
    }
    let baseName: string | undefined = undefined;
    if (template.extends !== undefined && template.extends.kind === "instantiation" && template.extends.expr.kind === "ident") baseName = template.extends.expr.name;
    const found = baseName !== undefined ? this.host.templates.get(baseName) : undefined;
    if (hasConstructor || found === undefined || seen.has(found) || template.extends === undefined || template.extends.kind !== "instantiation") return bindings;
    const base = named(found);
    seen.add(cloneClassNode(template));
    let passed: TypeNode[] = [];
    for (const a of template.extends.typeArgs) passed.push(cloneTypeNode(a));
    let params: string[] = [];
    for (const p of base.typeParams) params.push(p.name);
    const given = this.inferred(base, argTypes.slice(), { start: at.start, end: at.end }, seen);
    for (let i: usize = 0; i < params.length; i++) {
      const g = given.get(params[i]!);
      if (g !== undefined && i < passed.length) infer(this.host.tables, passed[i]!, g, names, bindings, { start: at.start, end: at.end });
    }
    return bindings;
  }
}
