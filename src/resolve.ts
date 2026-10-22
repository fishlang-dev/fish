import { CompileError } from "./diag.ts";
import type { Expr, Interface, Param, Span, TypeAlias, TypeMember, TypeNode } from "./parser.ts";
import type { DataEnum, EnumInfo, EnumInstance } from "./enums.ts";
import { placeholders } from "./generics.ts";
import { arrayType, blockType, holdsHandle, holdsPart, type BlockType, interiorType, sharedType, isInteger, variantType, functionType, generatorInterface, handleType, holdsRef, pointerType, promiseInterface, INTEGERS, interfaceType, type Integer, keyOf, literalType, lower, objectType, refType, show, unionType, type ClassType, type Field, type InteriorType, type SharedType, type InterfaceType, type Method, type ObjectType, type Type } from "./typing.ts";
import { TYPE_FORMS, unsupported } from "./unsupported.ts";

// Type annotations and the top-level type aliases they name, resolved to the checker's types.

// Aliases, classes and interfaces share one namespace of type names.
export function addAlias(aliases: Map<string, TypeAlias>, s: TypeAlias, ...others: Map<string, unknown>[]) {
  typeName(s.name, s, aliases, ...others);
  aliases.set(s.name, s);
}
export function paramName(p: Param): string {
  if (p.pattern.kind !== "ident") throw unsupported("destructuring patterns", p.pattern);
  return p.pattern.name;
}

export function typeName(name: string, at: Span, ...namespaces: Map<string, unknown>[]) {
  if (BUILT_IN_TYPES.has(name)) throw new CompileError(`'${name}' is a built-in type`, at.start, at.end);
  if (namespaces.some((n) => n.has(name))) throw new CompileError(`duplicate type name '${name}'`, at.start, at.end);
}

// A field holds a value, and an interface type describes values without being one. A
// function type in a field would be a boxed callable, which needs the heap.
export function storable(type: Type, at: Span): Type {
  if (typeof type !== "string" && type.kind === "interface") {
    throw new CompileError(`a field can't have the interface type '${type.name}'; use a type parameter instead`, at.start, at.end);
  }
  if (typeof type !== "string" && (type.kind === "function" || type.kind === "closure")) throw unsupported("functions stored in fields", at);
  return type;
}

// The class a name and type arguments refer to; a generic one is instantiated on first use.
type ClassNamed = (name: string, args: Type[], at: Span) => ClassType | undefined;

// Resolves every alias and interface up front, so an unused one is still checked. A generic
// alias is checked with placeholders for its type parameters, and resolved again per set of
// type arguments.
export function resolver(aliases: Map<string, TypeAlias>, classNamed: ClassNamed, interfaces: Map<string, Interface>, enums: Map<string, EnumInfo>, slots: Map<string, boolean[]>) {
  const resolved = new Map<string, Type>();
  const resolving = new Set<string>();
  const traits = new Map<Interface, InterfaceType>();
  // Each combined interface `A & B`, by its sides.
  const combined = new Map<string, InterfaceType>();
  // The type parameters in scope, bound to what they stand for in the body being checked.
  let scope = new Map<string, Type>();
  // The data-carrying enums being made, to catch one that holds itself.
  const making = new Set<DataEnum>();
  aliases.forEach((a) => {
    const scope = placeholders(a.typeParams, (t, s) => withScope(s, () => resolveType(t)));
    aliasType(a, [...scope.values()], a);
  });
  interfaces.forEach(interfaceOf);
  return { resolveType, paramType, withScope, enumInstance };

  // A data-carrying enum made with these type arguments: a variant per member, its payload
  // types resolved with the type parameters bound, and the enum as their union. An enum
  // holding itself would be infinitely large.
  function enumInstance(info: EnumInfo, args: Type[], at: Span): EnumInstance {
    const data = info.data!;
    if (args.length !== data.params.length) {
      const n = data.params.length;
      throw new CompileError(`enum '${data.name}' takes ${n} type argument${n === 1 ? "" : "s"}`, at.start, at.end);
    }
    const key = args.map(keyOf).join(",");
    const made = data.instances.get(key);
    if (made) return made;
    if (making.has(data)) throw new CompileError(`enum '${data.name}' holds itself, which would make it infinitely large; this isn't supported yet`, at.start, at.end);
    making.add(data);
    try {
      const bindings = new Map(data.params.map((p, i) => [p, args[i]!]));
      const variants = new Map(data.members.map((m) => {
        const payload = withScope(bindings, () => (m.payload ?? []).map((t) => {
          const type = storable(resolveType(t), t);
          // A held reference would need its enum tracked as a borrower.
          // Said where the enum is used when its type argument brought the reference.
          if (holdsRef(type)) throw unsupported("enum members holding references", args.some(holdsRef) ? at : t);
          return type;
        }));
        return [m.name, variantType(data.name, data.id, m.name, args, payload)];
      }));
      const shown = args.length > 0 ? `${data.name}<${args.map(show).join(", ")}>` : data.name;
      const type = unionType([...variants.values()], shown);
      for (const v of variants.values()) v.of = type;
      const instance = { type, variants };
      data.instances.set(key, instance);
      return instance;
    } finally {
      making.delete(data);
    }
  }

  function withScope<T>(bindings: Map<string, Type>, f: () => T): T {
    const outer = scope;
    scope = bindings;
    try {
      return f();
    } finally {
      scope = outer;
    }
  }

  // TypeScript's strict mode has no implicit `any`, and Fish has no `any` at all. Only a
  // constructor's parameters may carry modifiers, which make them parameter properties.
  function paramType(p: Param, property = false): Type {
    if (p.rest) throw unsupported("rest parameters", p);
    const name = paramName(p);
    if (p.decorators.length > 0) throw unsupported("decorators", p);
    if (p.comptime) throw unsupported("comptime parameters", p);
    if (p.modifiers.length > 0 && !property) throw unsupported("parameter properties", p);
    if (name === "this") throw unsupported("'this' parameters", p);
    if (p.default) throw unsupported("default parameter values", p);
    if (!p.type) throw new CompileError(`parameter '${name}' implicitly has an 'any' type; add a type annotation`, p.start, p.end);
    // A call may leave out an optional parameter, which is then empty.
    return p.optional ? unionType([unionMember(p.type), "null"]) : resolveType(p.type);
  }

  // An array of an element type. Arrays of references, and of functions, which would need their
  // calls boxed, aren't supported yet.
  function array(element: Type, at: TypeNode): Type {
    if (holdsRef(element)) throw unsupported("arrays of references", at);
    if (typeof element !== "string" && (element.kind === "function" || element.kind === "closure")) throw unsupported("arrays of functions", at);
    // An interface describes values of many types, each laid out its own way, so an array of
    // them has no one element size.
    if (typeof element !== "string" && element.kind === "interface") {
      throw new CompileError(`an array can't hold the interface type '${element.name}' directly, since its values may each be a different type; use a type parameter instead`, at.start, at.end);
    }
    return arrayType(element);
  }

  function resolveType(t: TypeNode): Type {
    // `readonly T[]` is a shared borrow of an array.
    if (t.kind === "operator" && t.op === "readonly" && t.type.kind === "array") return refType(arrayType(resolveType(t.type.element)), false);
    if (t.kind === "operator") throw unsupported(`'${t.op}' types`, t);
    if (t.kind === "function") {
      if (t.construct) throw unsupported("constructor types", t);
      if (t.typeParams.length > 0) throw unsupported("generic function types", t);
      return functionType(t.params.map(paramName), t.params.map((p) => paramType(p)), resolveType(t.returns));
    }
    if (t.kind === "object") return objectType(fields(t.members.map(member), t.members));
    if (t.kind === "literal") return literal(t.value);
    if (t.kind === "union") return unionType(t.types.map(unionMember));
    if (t.kind === "intersection") return intersection(t.types);
    if (t.kind === "array") return array(resolveType(t.element), t);
    if (t.kind !== "ref") throw unsupported(TYPE_FORMS[t.kind], t);
    const bound = scope.get(t.name);
    if (bound && t.args.length === 0) return bound;
    if (t.name in INTEGERS || ["boolean", "void", "number", "f32", "f64", "string"].includes(t.name)) {
      if (t.args.length > 0) throw new CompileError(`type '${t.name}' is not generic`, t.start, t.end);
      // `number` is JavaScript's 64-bit float.
      return t.name === "number" ? "f64" : (t.name as Integer | "f32" | "f64" | "boolean" | "void" | "string");
    }
    if (t.name === "Array" && t.args.length === 1) return array(resolveType(t.args[0]!), t);
    if (t.name === "Array" || t.name === "ReadonlyArray") throw unsupported(t.name === "Array" ? "'Array' without one type argument" : "'ReadonlyArray' types", t);
    if (t.name === "Ref" || t.name === "Mut") return reference(t);
    if (t.name === "null" || t.name === "undefined") {
      if (t.args.length > 0) throw new CompileError(`type '${t.name}' is not generic`, t.start, t.end);
      return "null";
    }
    if (t.name === "Ptr" || t.name === "MutPtr") {
      if (t.args.length !== 1) throw new CompileError(`'${t.name}' takes the type it points to, like '${t.name}<u8>'`, t.start, t.end);
      return pointerType(resolveType(t.args[0]!), t.name === "MutPtr");
    }
    if (t.name === "Atomic" || t.name === "Lock" || t.name === "Cell") {
      if (t.args.length !== 1) throw new CompileError(`'${t.name}' takes the type it holds, like '${t.name}<i64>'`, t.start, t.end);
      return interior(t.name, resolveType(t.args[0]!), t);
    }
    if (t.name === "Semaphore" || t.name === "Permit" || t.name === "AbortController" || t.name === "AbortSignal") {
      if (t.args.length !== 0) throw new CompileError(`'${t.name}' takes no type arguments`, t.start, t.end);
      return blockType(t.name);
    }
    if (t.name === "Channel") {
      if (t.args.length !== 1) throw new CompileError("'Channel' takes the type it carries, like 'Channel<string>'", t.start, t.end);
      return channel(resolveType(t.args[0]!), t);
    }
    if (t.name === "shared") {
      if (t.args.length !== 1) throw new CompileError("'shared' takes the type it holds, like 'shared<State>'", t.start, t.end);
      return shareable(resolveType(t.args[0]!), t);
    }
    // A `JoinHandle<T>` written out is one whose task can't throw.
    if (t.name === "JoinHandle") {
      if (t.args.length !== 1) throw new CompileError("'JoinHandle' takes the type its task gives, like 'JoinHandle<i64>'", t.start, t.end);
      return handleType(resolveType(t.args[0]!), undefined);
    }
    if (t.name === "Promise") {
      if (t.args.length !== 1) throw new CompileError("'Promise' takes the type it gives once awaited, like 'Promise<i64>'", t.start, t.end);
      return promiseInterface(resolveType(t.args[0]!));
    }
    if (t.name === "Generator") {
      if (t.args.length !== 1) throw new CompileError("'Generator' takes the type it yields, like 'Generator<i64>'", t.start, t.end);
      return generatorInterface(resolveType(t.args[0]!));
    }
    if (t.name === "Option") {
      if (t.args.length !== 1) throw new CompileError("'Option' takes the type it may hold, like 'Option<i64>'", t.start, t.end);
      return unionType([unionMember(t.args[0]!), "null"]);
    }
    // A class's lifetimes, written or left out, are no type arguments.
    const lifetime = slots.get(t.name);
    const args = (lifetime && t.args.length === lifetime.length ? t.args.filter((_, i) => !lifetime[i]) : t.args).map(resolveType);
    const alias = aliases.get(t.name);
    if (alias) return aliasType(alias, args, t);
    const named = classNamed(t.name, args, t);
    if (named) return named;
    const [owner, name] = t.name.split(".");
    const e = enums.get(owner!);
    if (e?.data) {
      const instance = enumInstance(e, args, t);
      if (name === undefined) return instance.type;
      const variant = instance.variants.get(name);
      if (variant) return variant;
    }
    if (e && name === undefined) return e.type;
    if (e && e.members.has(name!)) return e.members.get(name!)!;
    const trait = interfaces.get(t.name);
    if (trait && args.length > 0) throw unsupported("generic interfaces", t);
    if (trait) return interfaceOf(trait);
    throw new CompileError(`cannot find type '${t.name}'`, t.start, t.end);
  }

  // `Ref<T>` borrows a T, and `Mut<T>` borrows it mutably.
  // `Ref<T, A>` also names the lifetime parameter it lives for, checked by the function.
  function reference(t: Extract<TypeNode, { kind: "ref" }>): Type {
    if (t.args.length !== 1 && t.args.length !== 2) {
      throw new CompileError(`type '${t.name}' takes the type it borrows, and optionally a lifetime`, t.start, t.end);
    }
    const to = resolveType(t.args[0]!);
    if (to === "void") throw new CompileError("there is no 'void' value to borrow", t.start, t.end);
    if (typeof to !== "string" && to.kind === "function") throw unsupported("references to functions", t);
    // A type parameter standing for a reference makes one too.
    const real = lower(to);
    if (typeof real !== "string" && real.kind === "ref") throw unsupported("references to references", t);
    const life = t.args[1];
    if (life && (life.kind !== "ref" || life.args.length > 0)) throw new CompileError("a lifetime is a name declared as '<A extends Lifetime>'", life.start, life.end);
    return refType(to, t.name === "Mut", life?.name);
  }

  // A union holds values, so an interface, which describes values without being one, can't be
  // a member, and neither can `void`.
  function unionMember(node: TypeNode): Type {
    const t = resolveType(node);
    if (t === "void") throw new CompileError("'void' can't be a union member", node.start, node.end);
    if (typeof t !== "string" && t.kind === "interface") throw new CompileError(`an interface can't be a union member; '${t.name}' describes values without being one`, node.start, node.end);
    if (typeof t !== "string" && t.kind === "param") throw unsupported("unions holding a type parameter", node);
    if (typeof t !== "string" && t.kind === "function") throw unsupported("unions holding functions", node);
    if (holdsRef(t)) throw unsupported("unions holding references", node);
    return t;
  }

  function literal(e: Expr): Type {
    if (e.kind === "string" || e.kind === "bool") return literalType(e.value);
    const negative = e.kind === "unary" && e.op === "-";
    const digits = negative ? e.operand : e;
    if (digits.kind !== "int") throw unsupported("literal types of this kind", e);
    const value = negative ? -digits.value : digits.value;
    if (value > I64_MAX || value < -I64_MAX - 1n) throw new CompileError("integer literal does not fit in i64", e.start, e.end);
    return literalType(value);
  }

  // `A & B` of object types is one object type with the fields of both. With an interface it
  // is a combined bound: an interface with every side's fields and methods.
  function intersection(nodes: TypeNode[]): Type {
    const sides = nodes.map((node) => {
      const t = resolveType(node);
      if (typeof t !== "string" && (t.kind === "object" || t.kind === "interface")) return t;
      throw unsupported(`intersections with ${typeof t === "string" || t.kind === "literal" ? "primitive types" : SIDE_FORMS[t.kind]}`, node);
    });
    const [from, to] = [nodes[0]!, nodes.at(-1)!];
    const fields = sides.map((s) => objectType(s.fields)).reduce((a, b) => merged(a, b, from, to));
    if (sides.every((s) => s.kind === "object")) return fields;
    const key = sides.map(keyOf).join(" & ");
    let found = combined.get(key);
    if (found) return found;
    combined.set(key, found = interfaceType(sides.map(show).join(" & ")));
    found.fields.push(...fields.fields);
    for (const m of sides.flatMap((s) => (s.kind === "interface" ? s.methods : []))) {
      const same = found.methods.find((x) => x.name === m.name);
      if (!same) found.methods.push(m);
      else if (same.returns !== m.returns || same.params.length !== m.params.length || same.params.some((p, i) => p !== m.params[i])) {
        throw new CompileError(`method '${m.name}' has different types on each side of '&'`, from.start, to.end);
      }
    }
    return found;
  }

  // The interface is registered before its members resolve, so a member may name it.
  function interfaceOf(i: Interface): InterfaceType {
    const found = traits.get(i);
    if (found) return found;
    const t = interfaceType(i.name);
    traits.set(i, t);
    if (i.typeParams.length > 0) throw unsupported("generic interfaces", { start: i.typeParams[0]!.start, end: i.typeParams.at(-1)!.end });
    const add = (name: string, at: Span) => {
      if (t.fields.some((f) => f.name === name) || t.methods.some((m) => m.name === name)) {
        throw new CompileError(`duplicate member '${name}' in interface '${i.name}'`, at.start, at.end);
      }
    };
    for (const node of i.extends) {
      const base = resolveType(node);
      if (typeof base === "string" || base.kind !== "interface") throw new CompileError("an interface can only extend interfaces", node.start, node.end);
      for (const f of base.fields) add(f.name, node), t.fields.push(f);
      for (const m of base.methods) add(m.name, node), t.methods.push(m);
    }
    for (const m of i.members) {
      if (m.kind === "method") {
        if (typeof m.name !== "string") throw unsupported("computed property names", m.name);
        if (m.optional) throw unsupported("optional methods", m);
        if (m.typeParams.length > 0) throw unsupported("generic methods", m);
        if (!m.returns) throw new CompileError(`method '${m.name}' implicitly returns 'any'; add a return type`, m.start, m.end);
        add(m.name, m);
        const method: Method = { name: m.name, params: m.params.map((p) => paramType(p)), returns: resolveType(m.returns) };
        t.methods.push(method);
      } else {
        const f = member(m);
        add(f.name, m);
        t.fields.push(f);
      }
    }
    return t;
  }

  // An object type holds its fields inline, so one that contains itself has no finite size.
  function aliasType(a: TypeAlias, args: Type[], at: Span): Type {
    if (args.length !== a.typeParams.length) {
      throw new CompileError(`type '${a.name}' expects ${a.typeParams.length} type argument${a.typeParams.length === 1 ? "" : "s"}, but got ${args.length}`, at.start, at.end);
    }
    const key = `${a.name}<${args.map(keyOf).join(",")}>`;
    const done = resolved.get(key);
    if (done) return done;
    if (resolving.has(key) || resolving.size > 64) throw new CompileError(`type '${a.name}' refers to itself, so it would have infinite size`, a.start, a.end);
    resolving.add(key);
    const type = withScope(new Map(a.typeParams.map((p, i) => [p.name, args[i]!])), () => resolveType(a.type));
    resolving.delete(key);
    resolved.set(key, type);
    return type;
  }

  function member(m: TypeMember): Field {
    if (m.kind !== "property") throw unsupported(MEMBER_FORMS[m.kind], m);
    if (typeof m.name !== "string") throw unsupported("computed property names", m.name);
    if (!m.type) throw new CompileError(`property '${m.name}' implicitly has an 'any' type; add a type annotation`, m.start, m.end);
    // An object may leave out an optional property, which is then empty.
    const type = m.optional ? unionType([unionMember(m.type), "null"]) : resolveType(m.type);
    return { name: m.name, type: storable(type, m), ...(m.readonly && { readonly: true }) };
  }
}

// A field both sides of `&` declare keeps its type, merging nested object types; other types
// conflict, since no value could have both. It is readonly only when both sides say so, as in
// TypeScript.
function merged(a: ObjectType, b: ObjectType, from: Span, to: Span): ObjectType {
  const fields = [...a.fields];
  for (const f of b.fields) {
    const i = fields.findIndex((g) => g.name === f.name);
    const g = fields[i];
    if (!g) {
      fields.push(f);
      continue;
    }
    const both = typeof g.type !== "string" && g.type.kind === "object" && typeof f.type !== "string" && f.type.kind === "object";
    if (g.type !== f.type && !both) {
      throw new CompileError(`property '${f.name}' has type '${show(g.type)}' on one side of '&' and '${show(f.type)}' on the other`, from.start, to.end);
    }
    const type = both ? merged(g.type as ObjectType, f.type as ObjectType, from, to) : f.type;
    fields[i] = { name: f.name, type, ...(g.readonly && f.readonly && { readonly: true }) };
  }
  return objectType(fields);
}

// What each other kind of type is called when it can't be a side of `&`.
const SIDE_FORMS = { class: "classes", param: "type parameters", union: "unions", ref: "references", closure: "functions", function: "function types", array: "arrays", variant: "enum members", generator: "generators", pointer: "raw pointers", future: "promises", handle: "join handles", interior: "atomics, locks and cells", shared: "shared values", block: "semaphores and channels" };

const I64_MAX = (1n << 63n) - 1n;

// An `Atomic<T>`, `Lock<T>` or `Cell<T>` holding a T it can hold: an Atomic, an integer or a
// boolean, which the processor changes in one step.
export function interior(which: InteriorType["which"], of: Type, at: Span): InteriorType {
  const held = lower(of);
  if (which === "Atomic" && held !== "boolean" && !isInteger(held) && !(typeof held !== "string" && held.kind === "param")) {
    throw new CompileError(`'Atomic' holds an integer or a boolean, not '${show(of)}'; use a 'Lock' for other values`, at.start, at.end);
  }
  if (holdsRef(of)) throw new CompileError(`'${which}' can't hold a reference yet ('${show(of)}')`, at.start, at.end);
  abstractless(of, `'${which}'`, at);
  return interiorType(which, of);
}

// What only describes values, an interface (a written `Promise<T>` or `Generator<T>` is one) or a
// function type, can't be held where its value is laid out once for every use, as a channel, a
// shared value and a lock hold theirs.
function abstractless(of: Type, holder: string, at: Span) {
  let found: Type | undefined;
  holdsPart(lower(of), (u) => typeof u !== "string" && (u.kind === "interface" || u.kind === "function") && (found = u) !== undefined);
  if (found) throw new CompileError(`${holder} can't hold a '${show(found)}' yet: name a concrete type`, at.start, at.end);
}

// A `shared<T>` holding a T every thread may use at once: nothing in it borrows, points
// unchecked, or changes without a lock.
export function shareable(of: Type, at: Span): SharedType {
  const held = lower(of);
  abstractless(of, "a 'shared' value", at);
  let blocker: Type | undefined;
  holdsPart(held, (u) => {
    if (typeof u === "string" || !(u.kind === "ref" || u.kind === "pointer" || (u.kind === "interior" && u.which === "Cell"))) return false;
    blocker = u;
    return true;
  });
  if (holdsHandle(held)) throw new CompileError("a 'shared' value can't hold a JoinHandle: every clone could await it, and a task's result can be awaited in one place only", at.start, at.end);
  if (blocker) {
    const why = typeof blocker !== "string" && blocker.kind === "interior" ? "changes without a lock; use an 'Atomic' or a 'Lock' instead" : typeof blocker !== "string" && blocker.kind === "pointer" ? "is a raw pointer no thread can vouch for" : "borrows from one place, which other threads can't keep alive";
    throw new CompileError(`a 'shared' value is used from many threads at once, so it can't hold a '${show(blocker)}', which ${why}`, at.start, at.end);
  }
  return sharedType(of);
}

// A `Channel<T>` carrying values from one task to another: nothing in them borrows, points
// unchecked, or changes without a lock.
export function channel(of: Type, at: Span): BlockType {
  const held = lower(of);
  if (typeof held !== "string" && held.kind === "union" && held.members.includes("null") || held === "null") {
    throw new CompileError(`a 'Channel' can't carry '${show(held)}': 'receive' gives null once the channel is closed, so a null sent through it would look the same; wrap it, as in 'Channel<{ value: ${show(held)} }>'`, at.start, at.end);
  }
  abstractless(of, "a 'Channel'", at);
  let blocker: Type | undefined;
  holdsPart(lower(of), (u) => {
    if (typeof u === "string" || !(u.kind === "ref" || u.kind === "pointer" || (u.kind === "interior" && u.which === "Cell"))) return false;
    blocker = u;
    return true;
  });
  if (blocker) throw new CompileError(`a 'Channel' carries values to other tasks, so it can't carry a '${show(blocker)}', which ${typeof blocker !== "string" && blocker.kind === "interior" ? "changes without a lock" : typeof blocker !== "string" && blocker.kind === "pointer" ? "is a raw pointer no thread can vouch for" : "borrows from where it was made"}`, at.start, at.end);
  return blockType("Channel", of);
}

const BUILT_IN_TYPES = new Set([...Object.keys(INTEGERS), "f32", "f64", "boolean", "void", "number", "string", "Ref", "Mut", "Lifetime", "Option", "Generator", "Promise", "JoinHandle", "Ptr", "MutPtr", "Atomic", "Lock", "Cell", "shared", "Semaphore", "Permit", "Channel", "AbortController", "AbortSignal", "null", "undefined"]);

// What each kind of object type member besides a property is called when rejected.
const MEMBER_FORMS = {
  method: "methods in object types",
  call: "call signatures",
  construct: "construct signatures",
  index: "index signatures",
  get: "accessors in object types",
  set: "accessors in object types",
};

// Fields with their source spans, checked for a name given twice.
export function fields(list: Field[], at: Span[]): Field[] {
  list.forEach((f, i) => {
    if (list.findIndex((other) => other.name === f.name) !== i) throw new CompileError(`duplicate property '${f.name}'`, at[i]!.start, at[i]!.end);
  });
  return list;
}

