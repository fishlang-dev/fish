import type { Arenas, BodyId } from "./arenas.ts";
import { inheritedId, isLifetime, type Body, type ClassInfo } from "./classes.ts";
import type { CompileError } from "./diag.ts";
import type { Span } from "./parser.ts";
import { TypeMap, TypeSet, type ClassType, type FunctionType, type InterfaceType, type Type, type Typing } from "./typing.ts";

// Each class whose `implements` claim was refused and the interface, as shown, with why, which an
// error at a use of it as that interface repeats.
export type Refused = { type: string; trait: string; reason: string };

// What satisfying an interface needs from the checker: a class's members and their types.
export type Members = {
  /** @throws {CompileError} */
  classOf(t: ClassType): ClassInfo;
  /** @throws {CompileError} */
  returnOf(f: BodyId, at: Span): Type;
  /** @throws {CompileError} */
  throwsOf(f: BodyId): Type | undefined;
  // A method's parameter types, resolved with its class's type arguments.
  paramTypesOf(f: BodyId): Type[];
  // A generic method's own type parameters' placeholders, in order.
  /** @throws {CompileError} */
  typeParamsOf(f: BodyId): Type[];
  // A function declared at the top level, or lifted there, by its name.
  bodyNamed(name: string): Body | undefined;
  /** @throws {CompileError} */
  replaced(t: Type, swap: Ref<TypeMap<Type, Type>>): Type;
  typing: Typing;
  arenas: Arenas;
  // The pairs of a type and an interface being checked, each taken as satisfied while it is.
  assuming: Set<string>;
  refused: Refused[];
};

// Why the generic function `f` can't be given where the generic function type `family` is, or
// undefined when it can: as many type parameters, bounded alike, and the same signature with
// them standing for the type's.
/** @throws {CompileError} */
export function familyMismatch(f: BodyId, family: FunctionType, members: Mut<Members>, at: Span): string | undefined {
  const g = members.typing.rec(family).generic!;
  const own = ownTypeParams(members.arenas.bodyOf(f));
  if (own.length !== g.names.length) return `it has ${own.length} type parameter${own.length === 1 ? "" : "s"}, where '${members.typing.show(family)}' has ${g.names.length}`;
  const written = members.paramTypesOf(f).map((p) => implicitBound(members.typing, p));
  if (written.length !== members.typing.rec(family).params.length) return `it takes ${written.length} parameter${written.length === 1 ? "" : "s"}, where '${members.typing.show(family)}' takes ${members.typing.rec(family).params.length}`;
  if (members.arenas.bodyOf(f).throws !== undefined) return `it can throw, which '${members.typing.show(family)}' doesn't say`;
  const given = members.returnOf(f, { start: at.start, end: at.end });
  const swap = byName(members.typing, [...written, given], own, g.own);
  if (members.typeParamsOf(f).some((p, i) => !sameBounds(members.typing, p, g.own[i as usize]!))) return "its type parameters' bounds differ";
  const params = written.map((p) => members.replaced(p, swap));
  const expected = members.typing.rec(family).params;
  const wrong = params.findIndex((p, i) => !same(members.typing, p, expected[i as usize]!));
  if (wrong >= 0) return `its parameter ${wrong + 1} is '${members.typing.show(params[wrong as usize]!)}', where '${members.typing.show(family)}' passes '${members.typing.show(members.typing.rec(family).params[wrong as usize]!)}'`;
  const givenReplaced = members.replaced(given, swap);
  if (!members.typing.fits(givenReplaced, members.typing.rec(family).returns)) return `it returns '${members.typing.show(givenReplaced)}', where '${members.typing.show(family)}' returns '${members.typing.show(members.typing.rec(family).returns)}'`;
  return undefined;
}

// The type parameters named `names` found in `types`, each mapped to the one at its place in `to`:
// a method's own placeholders may be met as more than one type, so they are found by name.
function byName(typing: Mut<Typing>, types: Ref<Type[]>, names: Ref<string[]>, to: Ref<Type[]>): TypeMap<Type, Type> {
  let swap = new TypeMap<Type, Type>();
  let seen = new TypeSet<Type>();
  let left: Type[] = [...types];
  while (left.length > 0) {
    const t = left.pop()!;
    if (typeof t === "string" || seen.has(t)) continue;
    seen.add(t);
    const r = typing.rec(t);
    if (r.kind === "param" && names.includes(r.name)) swap.set(t, to[names.indexOf(r.name) as usize]!);
    for (const u of typing.links(t)) left.push(u);
  }
  return swap;
}


// Whether two type parameters standing for each other have the same bound.
function sameBounds(typing: Ref<Typing>, a: Type, b: Type): boolean {
  const x = boundOf(typing, a);
  const y = boundOf(typing, b);
  return x === y || (x !== undefined && y !== undefined && typing.keyOf(x) === typing.keyOf(y));
}

function boundOf(typing: Ref<Typing>, t: Type): Type | undefined {
  const r = typeof t === "string" ? undefined : typing.rec(t);
  return r?.kind === "param" ? r.bound : undefined;
}


// Why a value of `type` doesn't satisfy `trait`, or undefined when it does. Satisfying is
// by shape: a public field or getter of a fitting type for each of the interface's fields,
// and a public method taking exactly its parameter types and returning a fitting type for
// each of its methods. `implements` is never needed.
/** @throws {CompileError} */
export function unsatisfied(type: Type, trait: InterfaceType, members: Mut<Members>, at: Span): string | undefined {
  // An interface can name itself, as a builder's methods return the builder, so a pair already
  // being checked is taken as satisfied rather than checked again forever.
  const key = `${members.typing.keyOf(type)} ${members.typing.keyOf(trait)}`;
  if (members.assuming.has(key)) return undefined;
  members.assuming.add(key);
  try {
    return check(type, trait, members, at);
  } finally {
    members.assuming.delete(key);
  }
}

// Two parameter types are one when they differ only in a reference's lifetime, which each
// method names for itself, or in how an optional field is spelled.
// A function-typed parameter of a generic method is its implicit type parameter, bounded by the
// function type written, which is what it is compared as.
function implicitBound(typing: Ref<Typing>, t: Type): Type {
  const r = typeof t === "string" ? undefined : typing.rec(t);
  return r?.kind === "param" && typing.recOf(r.bound)?.kind === "function" ? r.bound! : t;
}

function same(typing: Mut<Typing>, a: Type, b: Type): boolean {
  const left = implicitBound(typing, a);
  const right = implicitBound(typing, b);
  const x = typeof left === "string" ? undefined : typing.rec(left);
  const y = typeof right === "string" ? undefined : typing.rec(right);
  // Function types, which each signature makes anew, are the same when their parts are.
  if (x?.kind === "function" && y?.kind === "function") {
    if (x.params.length !== y.params.length) return false;
    for (let i: usize = 0; i < x.params.length; i++) if (!same(typing, x.params[i]!, y.params[i as usize]!)) return false;
    return same(typing, x.returns, y.returns) && x.generic?.names.length === y.generic?.names.length;
  }
  return plain(typing, left) === plain(typing, right);
}

function plain(typing: Mut<Typing>, t: Type): string {
  const r = typeof t === "string" ? undefined : typing.rec(t);
  const shaped = r?.kind === "ref" ? typing.refType(r.to, r.mutable) : t;
  return typing.shapeKey(shaped);
}


/** @throws {CompileError} */
function check(type: Type, trait: InterfaceType, members: Mut<Members>, at: Span): string | undefined {
  if (type === trait) return undefined;
  // An array, a Map, a Set, a string or a generator is an `Iterable<T>` for exactly what a loop
  // over it reads; a class is one through its `[Symbol.iterator]` method, checked as any method.
  const iterable = members.typing.iterableElement(trait);
  const gives = iterable === undefined ? undefined : members.typing.iteratedBy(type);
  // A pair is the `readonly [K, V]` a table's entries are written as, whether or not it is readonly.
  if (gives !== undefined && iterable !== undefined) {
    const givesWritable = members.typing.writable(gives);
    const wantsWritable = members.typing.writable(iterable);
    if (members.typing.lower(givesWritable) === members.typing.lower(wantsWritable)) return undefined;
    const loweredGives = members.typing.lower(gives);
    if (members.typing.lower(iterable) === "string" && text(members.typing, loweredGives)) return undefined;
    return `it gives '${members.typing.show(gives)}', not '${members.typing.show(iterable)}'`;
  }
  const t = typeof type === "string" ? undefined : members.typing.rec(type);
  // A type parameter has what its bound has.
  if (t?.kind === "param") {
    return t.bound !== undefined ? unsatisfied(t.bound, trait, members, at) : `type '${t.name}' has no members`;
  }
  // A future is a `Promise<T>` for exactly what it gives, a type parameter's union in an
  // instance being the one it flattens into.
  if (t?.kind === "future") {
    const element = members.typing.promiseElement(trait);
    if (element === undefined) return `a promise has no members, which type '${members.typing.rec(trait).name}' expects`;
    return members.typing.lower(t.gives) === members.typing.lower(element) ? undefined : `it gives '${members.typing.show(t.gives)}', not '${members.typing.show(element)}'`;
  }
  // A generator is a `Generator<T>` for exactly what it yields, its `next` being its only member.
  if (t?.kind === "generator") {
    const element = members.typing.generatorElement(trait, t.async === true);
    if (element === undefined) return `${t.async === true ? "an async" : "a"} generator has only 'next', which type '${members.typing.rec(trait).name}' doesn't describe`;
    if (t.throws !== undefined) return `its 'next' throws '${members.typing.show(t.throws)}', which '${members.typing.rec(trait).name}' doesn't`;
    // One taking values may still be advanced without, as `Generator<T>`'s `next()` is.
    const sends = members.typing.generatorSends(trait);
    if (sends !== undefined && (t.sends === undefined || members.typing.lower(t.sends) !== members.typing.lower(sends))) return `its 'next' takes ${t.sends === undefined ? "nothing" : `'${members.typing.show(t.sends)}'`}, not '${members.typing.show(sends)}'`;
    return members.typing.lower(t.yields) === members.typing.lower(element) ? undefined : `it yields '${members.typing.show(t.yields)}', not '${members.typing.show(element)}'`;
  }
  const c = t !== undefined && t.kind === "class" ? members.classOf(type as ClassType) : undefined;
  const wanted = members.typing.rec(trait);
  for (const f of wanted.fields) {
    const own = typeof type === "string" ? undefined : members.typing.field(type, f.name);
    const getter = own === undefined && c !== undefined ? inheritedId(members.arenas, c, "getters", f.name) : undefined;
    if (getter !== undefined && members.arenas.bodyOf(getter).access === "public") {
      if (!members.typing.fits(members.returnOf(getter, { start: at.start, end: at.end }), f.type)) return `types of property '${f.name}' are incompatible`;
      continue;
    }
    if (own === undefined || (own.access ?? "public") !== "public") return missing(members.typing, type, trait, "property", f.name);
    if (!members.typing.fits(own.type, f.type)) return `types of property '${f.name}' are incompatible`;
  }
  for (const m of wanted.methods) {
    const found = t?.kind === "interface" ? t.methods.find((x) => x.name === m.name) : undefined;
    if (found !== undefined) {
      if (found.omittable === true && m.omittable !== true) return `method '${m.name}' is optional in type '${members.typing.show(type)}' but required in type '${members.typing.rec(trait).name}'`;
      // Generic methods are compared with their type parameters standing for each other.
      let swap = new TypeMap<Type, Type>();
      if (m.generic !== undefined || found.generic !== undefined) {
        if (found.generic?.names.length !== m.generic?.names.length) return `types of method '${m.name}' are incompatible`;
        let parts: Type[] = [...found.params, found.returns];
        if (found.throws !== undefined) parts.push(found.throws);
        swap = byName(members.typing, parts, found.generic!.names, m.generic!.own);
        if (found.generic!.own.some((p, i) => !sameBounds(members.typing, p, m.generic!.own[i as usize]!))) return `types of method '${m.name}' are incompatible: their type parameters' bounds differ`;
      }
      const params = found.params.map((p) => members.replaced(p, swap));
      const thrown = found.throws !== undefined ? members.replaced(found.throws, swap) : undefined;
      let fit = !params.some((p, i) => !same(members.typing, p, m.params[i as usize]!)) && params.length === m.params.length;
      if (fit) {
        const returns = members.replaced(found.returns, swap);
        fit = returnsFit(members, { start: at.start, end: at.end }, returns, m.returns);
      }
      if (fit && thrown !== undefined && (m.throws === undefined || !members.typing.fits(thrown, m.throws))) fit = false;
      if (!fit) return `types of method '${m.name}' are incompatible`;
      continue;
    }
    const method = c !== undefined ? inheritedId(members.arenas, c, "methods", m.name) : undefined;
    const access = method !== undefined ? members.arenas.bodyOf(method).access : undefined;
    // An optional method may be left out, but not stood in for by a field.
    if (method === undefined && m.omittable === true && (typeof type === "string" || members.typing.field(type, m.name) === undefined)) continue;
    if (m.omittable === true && method === undefined) return `property '${m.name}' of type '${members.typing.show(type)}' is a field, where '${members.typing.rec(trait).name}' declares an optional method`;
    if (m.omittable === true && access !== "public") return `method '${m.name}' is ${access === undefined ? "public" : access} in type '${members.typing.show(type)}', where '${members.typing.rec(trait).name}' declares it public`;
    // An object's fields hold values, and a callable held in one isn't a method yet.
    if (t?.kind === "object") return `${missing(members.typing, type, trait, "method", m.name)}; an object can't supply a method yet, so use a class`;
    if (method === undefined || access !== "public") return missing(members.typing, type, trait, "method", m.name);
    if (members.arenas.bodyOf(method).throws !== undefined && m.throws === undefined) return `method '${m.name}' can throw, and an interface's methods can't declare errors yet`;
    // A generic method stands in for one with as many type parameters, compared with them
    // standing for the interface's.
    let swap = new TypeMap<Type, Type>();
    const written = members.paramTypesOf(method).map((p) => implicitBound(members.typing, p));
    const given = members.returnOf(method, { start: at.start, end: at.end });
    const thrown = members.throwsOf(method);
    if (m.generic !== undefined) {
      const own = ownTypeParams(members.arenas.bodyOf(method));
      if (own.length !== m.generic.names.length) return `method '${m.name}' must be generic with ${m.generic.names.length} type parameter${m.generic.names.length === 1 ? "" : "s"}, as '${members.typing.rec(trait).name}' declares it`;
      let parts: Type[] = [...written, given];
      if (thrown !== undefined) parts.push(thrown);
      swap = byName(members.typing, parts, own, m.generic.own);
      if (members.typeParamsOf(method).some((p, i) => !sameBounds(members.typing, p, m.generic!.own[i as usize]!))) return `types of method '${m.name}' are incompatible: its type parameters' bounds differ from '${members.typing.rec(trait).name}''s`;
    }
    const params = written.map((p) => members.replaced(p, swap));
    const result = members.replaced(given, swap);
    const error = thrown !== undefined ? members.replaced(thrown, swap) : undefined;
    if (params.length !== m.params.length || params.some((p, i) => !same(members.typing, p, m.params[i as usize]!)) || !returnsFit(members, { start: at.start, end: at.end }, result, m.returns) || (error !== undefined && (m.throws === undefined || !members.typing.fits(error, m.throws)))) {
      return `types of method '${m.name}' are incompatible`;
    }
    // An interface method's reference borrows from its receiver, so one borrowing from a
    // parameter instead can't stand in for it.
    const r = typeof result === "string" ? undefined : members.typing.rec(result);
    if (r !== undefined && r.kind === "ref" && r.life !== undefined) {
      return `method '${m.name}' returns a reference tied to lifetime '${r.life}' of a parameter, where '${members.typing.rec(trait).name}' borrows from 'this'`;
    }
  }
  return undefined;
}
// A return type fits an interface method's when it fits, or, for an interface, satisfies it.
/** @throws {CompileError} */
function returnsFit(members: Mut<Members>, at: Span, actual: Type, expected: Type): boolean {
  const r = typeof expected === "string" ? undefined : members.typing.rec(expected);
  return r?.kind === "interface" ? unsatisfied(actual, expected as InterfaceType, members, at) === undefined : members.typing.fits(actual, expected);
}

function missing(typing: Mut<Typing>, type: Type, trait: InterfaceType, what: string, name: string): string {
  return `${what} '${name}' is missing in type '${typing.show(type)}' but required in type '${typing.rec(trait).name}'`;
}

// A function's own type parameters' names, its lifetimes left out.
function ownTypeParams(f: Ref<Body>): string[] {
  let own: string[] = [];
  if (f.typeParams !== undefined) for (const p of f.typeParams) if (!isLifetime(p)) own.push(p.name);
  return own;
}

// String literals, or a union of them, give strings, as a `let` of one widens.
function text(typing: Mut<Typing>, t: Type): boolean {
  const r = typing.recOf(t);
  if (r?.kind !== "union") return typing.widenLet(t) === "string";
  for (const m of r.members) if (typing.widenLet(m) !== "string") return false;
  return true;
}

