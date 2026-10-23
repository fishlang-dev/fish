import { CompileError } from "./diag.ts";
import type { Expr, Interface, Param, Span, TypeAlias, TypeMember, TypeNode } from "./parser.ts";
import type { DataEnum, EnumInfo, EnumInstance } from "./enums.ts";
import { placeholders } from "./generics.ts";
import { field, fits, holdsPattern, isFloat, splitTemplate, textFits, typeParameter, optionalField, shapeKey, withoutNull, arrayType, blockType, dynType, stored, generatorElement, promiseElement, holdsHandle, holdsPart, type BlockType, interiorType, sharedType, isInteger, variantType, functionType, generatorInterface, handleType, holdsRef, pointerType, promiseInterface, INTEGERS, interfaceType, type Integer, keyOf, literalType, lower, objectType, refType, show, unionType, type ClassType, type Field, type InteriorType, type SharedType, type InterfaceType, type Method, type ObjectType, type ParamType, type Type } from "./typing.ts";
import { TYPE_FORMS, unsupported } from "./unsupported.ts";
import { openParam, standIn, typeFunctions } from "./typefns.ts";
import { mutates, owns } from "./classes.ts";

// Type annotations and the top-level type aliases they name, resolved to the checker's types.

// Aliases, classes and interfaces share one namespace of type names.
export function addAlias(aliases: Map<string, TypeAlias>, s: TypeAlias, ...others: Map<string, unknown>[]) {
  typeName(s.name, s, aliases, ...others);
  aliases.set(s.name, s);
}
// The rest parameters given a meaning so far: a tag's, which the template's values fill.
export const restParams = new WeakSet<Param>();

// Whether a parameter is written as a tag's strings: `comptime` and a string array.
export function tagStrings(p: Param | undefined): boolean {
  const t = p?.type;
  const typed = t?.kind === "ref" ? t.name === "TemplateStringsArray" : t?.kind === "array" && t.element.kind === "ref" && t.element.name === "string";
  return !!p?.comptime && typed;
}

export function paramName(p: Param): string {
  if (p.pattern.kind !== "ident") throw unsupported("destructuring patterns", p.pattern);
  return p.pattern.name;
}

// The classes every program's prelude declares.
const STD_CLASSES = new Set(["AbortError", "IoError", "TextEncoder", "TextDecoder"]);

export function typeName(name: string, at: Span, ...namespaces: Map<string, unknown>[]) {
  if (BUILT_IN_TYPES.has(name)) throw new CompileError(`'${name}' is a built-in type`, at.start, at.end);
  if (STD_CLASSES.has(name) && namespaces.some((n) => n.has(name))) throw new CompileError(`'${name}' is a std class; give yours another name`, at.start, at.end);
  if (namespaces.some((n) => n.has(name))) throw new CompileError(`duplicate type name '${name}'`, at.start, at.end);
}

// A field holds a value, and an interface type describes values without being one. A
// function type in a field would be a boxed callable, which needs the heap.
export function storable(written: Type, at: Span): Type {
  const type = stored(written);
  if (typeof type !== "string" && type.kind === "interface") {
    throw new CompileError(`a field can't have the interface type '${type.name}'; use a type parameter instead`, at.start, at.end);
  }
  if (typeof type !== "string" && type.kind === "closure") throw unsupported("functions stored in fields", at);
  return type;
}

// The class a name and type arguments refer to; a generic one is instantiated on first use.
type ClassNamed = (name: string, args: Type[], at: Span) => ClassType | undefined;

// Resolves type annotations and aliases. A generic alias is checked with placeholders for its
// type parameters, and resolved again per set of type arguments.
export function resolver(aliases: Map<string, TypeAlias>, classNamed: ClassNamed, interfaces: Map<string, Interface>, enums: Map<string, EnumInfo>, slots: Map<string, boolean[]>, layout: (c: ClassType) => boolean, valueType: (name: string, at: Span, shadowed: boolean) => Type,
  conforms: (from: Type, to: Type, at: Span) => boolean) {
  // What was being resolved as each class layout under way began: an alias met again inside one
  // reads the fields of a class whose own field types need it.
  const layouts: Set<string>[] = [];
  const { keyofType, indexedType, fieldsOf, keysOf, templateType, UTILITIES } = typeFunctions((c) => {
    layouts.push(new Set(resolving));
    try {
      return withSight(undefined, () => layout(c));
    } finally {
      layouts.pop();
    }
  }, () => deferring > 0, conforms);
  const resolved = new Map<string, Type>();
  const resolving = new Set<string>();
  const traits = new Map<Interface, InterfaceType>();
  // Each combined interface `A & B`, by its sides.
  const combined = new Map<string, InterfaceType>();
  // The type parameters in scope, bound to what they stand for in the body being checked.
  let scope = new Map<string, Type>();
  // Above zero while a generic alias is checked with placeholders, before any use.
  let deferring = 0;
  // How many alias instances computing the outermost type has needed, against the budget.
  let computed = 0;
  // Whether a name is a local or parameter where a type written at `at` sits, which `typeof`
  // can't name yet; unset where only top-level names are in sight.
  let sight: ((name: string, at: Span) => boolean) | undefined;
  function setSight(names: typeof sight) {
    sight = names;
  }
  function withSight<T>(names: typeof sight, f: () => T): T {
    const outer = sight;
    sight = names;
    try {
      return f();
    } finally {
      sight = outer;
    }
  }
  // The data-carrying enums being made, to catch one that holds itself.
  const making = new Set<DataEnum>();
  return { resolveType, paramType, withScope, withSight, setSight, enumInstance, validate };

  // Resolves every alias and interface once, so a mistake in one is reported even when nothing
  // uses it. Run once classes are linked, since an alias may read a class's fields.
  function validate() {
    aliases.forEach((a) => {
      const scope = placeholders(a.typeParams, (t, s) => withScope(s, () => resolveType(t)));
      if (a.typeParams.length > 0) deferring++;
      try {
        aliasType(a, [...scope.values()], a);
      } finally {
        if (a.typeParams.length > 0) deferring--;
      }
    });
    interfaces.forEach(interfaceOf);
  }

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
          if (holdsRef(type)) throw unsupported("enum members holding references", args.some((a) => holdsRef(a)) ? at : t);
          // An enum is laid out as written; one made from a pattern type argument is remade from its lowered argument.
          if (holdsPattern(type) && !args.some(holdsPattern)) throw unsupported("template literal pattern types in enum members", t);
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
    if (p.rest && !restParams.has(p)) throw new CompileError("rest parameters are only supported on tags so far, as in 'function tag(comptime strings: TemplateStringsArray, ...values: T[])'", p.start, p.end);
    const name = paramName(p);
    if (p.decorators.length > 0) throw unsupported("decorators", p);
    if (p.modifiers.length > 0 && !property) throw unsupported("parameter properties", p);
    if (name === "this") throw unsupported("'this' parameters", p);
    if (p.default) throw unsupported("default parameter values", p);
    if (!p.type) throw new CompileError(`parameter '${name}' implicitly has an 'any' type; add a type annotation`, p.start, p.end);
    // A call may leave out an optional parameter, which is then empty.
    const type = p.optional ? unionType([unionMember(p.type), "null"]) : resolveType(p.type);
    if (p.rest && (typeof type === "string" || type.kind !== "array")) throw new CompileError(`a rest parameter takes an array of the values, as in '...${name}: ${show(type)}[]'`, p.type.start, p.type.end);
    // A comptime parameter makes an instance per value, so its type is one whose values compare.
    const keyed = (t: Type): boolean => isInteger(t) || t === "boolean" || t === "string" || (typeof t !== "string" && (t.kind === "literal" || (t.kind === "union" && t.members.every(keyed))));
    // A tag's strings, `TemplateStringsArray`, are an array of strings.
    const strings = typeof type !== "string" && type.kind === "array" && type.element === "string";
    if (p.comptime && (p.optional || !(keyed(type) || strings))) throw new CompileError(`a comptime parameter takes an integer, a boolean, a string, an enum member or a string array, not '${show(type)}'`, p.type.start, p.type.end);
    return type;
  }

  // An array of an element type. Arrays of references, and of functions, which would need their
  // calls boxed, aren't supported yet.
  function array(element: Type, at: TypeNode): Type {
    if (holdsRef(element)) throw unsupported("arrays of references", at);
    if (typeof element !== "string" && element.kind === "closure") throw unsupported("arrays of functions", at);
    if (typeof element !== "string" && element.kind === "function") return arrayType(stored(element));
    if (typeof element !== "string" && element.kind === "interface" && stored(element) !== element) return arrayType(stored(element));
    // An interface describes values of many types, each laid out its own way, so an array of
    // them has no one element size.
    if (typeof element !== "string" && element.kind === "interface") {
      throw new CompileError(`an array can't hold the interface type '${element.name}' directly, since its values may each be a different type; use 'Dyn<${element.name}>[]' to hold any of them`, at.start, at.end);
    }
    return arrayType(element);
  }

  function resolveType(t: TypeNode): Type {
    // `readonly T[]` is a shared borrow of an array.
    if (t.kind === "operator" && t.op === "readonly" && t.type.kind === "array") return refType(arrayType(resolveType(t.type.element)), false);
    if (t.kind === "operator" && t.op === "keyof") return keyofType(resolveType(t.type), t);
    if (t.kind === "operator") throw unsupported(`'${t.op}' types`, t);
    if (t.kind === "indexed") return indexedType(resolveType(t.object), resolveType(t.index), t, t.index);
    if (t.kind === "conditional") return conditional(t);
    if (t.kind === "mapped") return mapped(t);
    if (t.kind === "template") {
      const holes = t.types.map(resolveType);
      return standIn(holes, "a template literal type", t, false, () => deferring > 0) ?? templateType(t.quasis, holes, t, t.types);
    }
    if (t.kind === "infer") throw new CompileError(`'infer ${t.name}' declares a type only inside a conditional type's 'extends' clause, like 'T extends (infer U)[] ? U : never'`, t.start, t.end);
    if (t.kind === "function") {
      if (t.construct) throw unsupported("constructor types", t);
      if (t.typeParams.length > 0) throw unsupported("generic function types", t);
      const fn = functionType(t.params.map(paramName), t.params.map((p) => paramType(p)), resolveType(t.returns));
      if ([fn.returns, ...fn.params].some(holdsPattern)) throw unsupported("template literal pattern types in function types", t);
      return fn;
    }
    if (t.kind === "object") return objectType(fields(t.members.map(member), t.members));
    if (t.kind === "literal") return literal(t.value);
    if (t.kind === "union") return unionType(t.types.map(unionMember));
    if (t.kind === "intersection") return intersection(t.types);
    if (t.kind === "array") return array(resolveType(t.element), t);
    // `typeof f` or `typeof X`: a top-level function's or const's type.
    if (t.kind === "query") {
      if (t.target.kind !== "ref" || t.target.args.length > 0 || t.target.name.includes(".")) throw unsupported("'typeof' types other than of a top-level function or const", t);
      return valueType(t.target.name, t, sight?.(t.target.name, t) === true);
    }
    if (t.kind !== "ref") throw unsupported(TYPE_FORMS[t.kind], t);
    const bound = scope.get(t.name);
    if (bound && t.args.length === 0) return bound;
    if (Object.hasOwn(INTEGERS, t.name) || ["boolean", "void", "number", "f32", "f64", "string"].includes(t.name)) {
      if (t.args.length > 0) throw new CompileError(`type '${t.name}' is not generic`, t.start, t.end);
      // `number` is JavaScript's 64-bit float.
      return t.name === "number" ? "f64" : (t.name as Integer | "f32" | "f64" | "boolean" | "void" | "string");
    }
    if (t.name === "Array" && t.args.length === 1) return array(resolveType(t.args[0]!), t);
    if (t.name === "Array" || t.name === "ReadonlyArray") throw unsupported(t.name === "Array" ? "'Array' without one type argument" : "'ReadonlyArray' types", t);
    if (t.name === "Ref" || t.name === "Mut") return reference(t);
    if (t.name === "never" && t.args.length === 0) return "never";
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
    if (t.name === "Dyn") {
      const of = t.args.length === 1 ? resolveType(t.args[0]!) : undefined;
      if (typeof of === "string" || of?.kind !== "interface" || promiseElement(of) !== undefined || generatorElement(of) !== undefined) {
        throw new CompileError("'Dyn' takes the interface its values implement, like 'Dyn<Handler>'", t.start, t.end);
      }
      return dynType(of);
    }
    if (t.name === "Semaphore" || t.name === "Permit" || t.name === "AbortController" || t.name === "AbortSignal" || t.name === "TcpListener" || t.name === "TcpStream") {
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
      const gives = resolveType(t.args[0]!);
      if (holdsPattern(gives)) throw unsupported("template literal pattern types in promises", t);
      return promiseInterface(gives);
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
    // TypeScript's utility types, unless the program declares its own of the name.
    const utility = UTILITIES.get(t.name);
    if (utility) {
      const [count, apply, example] = utility;
      if (args.length !== count) throw new CompileError(`'${t.name}' takes ${count === 1 ? "one type argument" : "two type arguments"}, like '${example}'`, t.start, t.end);
      return apply(args, t, t.args);
    }
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
    // A generic alias checked before any use holds its parameters anywhere; each use gives them types.
    if (typeof t !== "string" && t.kind === "param" && deferring === 0) throw unsupported("unions holding a type parameter", node);
    // A union holds a value, so a function type in one is a stored callable.
    if (typeof t !== "string" && t.kind === "function") return stored(t);
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
      else if (shapeKey(same.returns) !== shapeKey(m.returns) || same.params.length !== m.params.length || same.params.some((p, i) => shapeKey(p) !== shapeKey(m.params[i]!))) {
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
        const first = m.params[0];
        const self = first?.pattern.kind === "ident" && first.pattern.name === "this" ? first : undefined;
        const params = (self ? m.params.slice(1) : m.params).map((p) => paramType(p));
        const method: Method = { name: m.name, params, returns: resolveType(m.returns), mutable: self ? mutates(self) : false, owned: self ? owns(self) : false };
        if ([method.returns, ...method.params].some(holdsPattern)) throw unsupported("template literal pattern types in interface methods", m);
        t.methods.push(method);
      } else {
        const f = member(m);
        if (holdsPattern(f.type)) throw unsupported("template literal pattern types in interface fields", m);
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
    // Inside a generic alias checked before any use, another alias given its placeholders is only
    // checked for its arguments: following it could recurse without end.
    const open = deferring > 0 && resolving.size > 0 ? args.map((t) => openParam(t, true)).find((t) => t) : undefined;
    if (open) return open;
    if (layouts.some((s) => s.has(key))) {
      throw new CompileError(`type '${a.name}' reads a class's fields while that class's own field types are being worked out from it, so it can't be computed yet`, at.start, at.end);
    }
    if (resolving.has(key)) throw new CompileError(`type '${a.name}' refers to itself, so it would have infinite size`, a.start, a.end);
    // A type that branches as it recurses grows exponentially, so the whole program's type
    // evaluation has a budget, as TypeScript caps instantiations.
    if (resolving.size === 0) computed = 0;
    if (++computed > 20_000) throw new CompileError(`computing type '${a.name}' needed more than 20000 alias instances; a type that branches as it recurses grows exponentially`, at.start, at.end);
    if (resolving.size > 64) throw new CompileError(`type '${a.name}' is nested more than 64 alias instances deep while being computed; a type that uses itself must reach a branch that stops sooner`, at.start, at.end);
    resolving.add(key);
    let type: Type;
    try {
      // An alias's body sees the names where it is declared, not where it is used.
      type = withSight(undefined, () => withScope(new Map(a.typeParams.map((p, i) => [p.name, args[i]!])), () => resolveType(a.type)));
    } finally {
      resolving.delete(key);
    }
    resolved.set(key, type);
    return type;
  }

  // `{ [K in C as N]: X }`: a field for each key C names, its type X with K bound to the key. Over
  // `keyof T` it keeps T's optional and readonly fields unless a modifier says otherwise, and
  // `as` renames each key, or drops one renamed to `never`.
  function mapped(t: Extract<TypeNode, { kind: "mapped" }>): Type {
    const homomorphic = t.constraint.kind === "operator" && t.constraint.op === "keyof" ? resolveType(t.constraint.type) : undefined;
    const keys = resolveType(t.constraint);
    if (!t.type) throw new CompileError(`a mapped type needs the type of its fields, like '{ [${t.name} in keyof T]: i64 }'`, t.start, t.end);
    const held = standIn(homomorphic ? [homomorphic, keys] : [keys], "a mapped type", t.constraint, false, () => deferring > 0);
    if (held) {
      withScope(new Map([...scope, [t.name, held]]), () => (t.as && resolveType(t.as), resolveType(t.type!)));
      return held;
    }
    const source = homomorphic ? fieldsOf(homomorphic, "a mapped type", t.constraint) : [];
    const fields: Field[] = [];
    for (const key of keys === "never" ? [] : keysOf(keys, "a mapped type", t.constraint)) {
      const bound = new Map([...scope, [t.name, literalType(key)]]);
      const renamed = t.as ? withScope(bound, () => resolveType(t.as!)) : literalType(key);
      const names = renamed === "never" ? [] : keysOf(renamed, "a mapped type's 'as' clause", t.as ?? t);
      const value = storable(withScope(bound, () => resolveType(t.type!)), t.type);
      const from = source.find((f) => f.name === key);
      const readonly = t.readonly ? t.readonly === "+" : from?.readonly === true;
      for (const name of names) {
        if (fields.some((f) => f.name === name)) throw new CompileError(`two keys of this mapped type are both renamed '${name}', and an object type has each field once`, (t.as ?? t).start, (t.as ?? t).end);
        const field = t.optional === "+" ? optionalField(name, value)
          : t.optional === "-" ? { name, type: from?.optional === "added" ? withoutNull(value) : value }
          : from?.optional ? kept(name, value, from.optional)
          : { name, type: value };
        fields.push({ ...field, ...(readonly && { readonly: true }) });
      }
    }
    return objectType(fields);
  }

  // A field a homomorphic mapped type keeps optional: its null is the one `?` added unless the
  // new type held one of its own as the old did.
  function kept(name: string, value: Type, was: "added" | "held"): Field {
    const own = value === "null" || (typeof value !== "string" && value.kind === "union" && value.members.includes("null"));
    return { name, type: own ? value : unionType([value, "null"]), optional: was === "held" && own ? "held" : "added" };
  }

  // `T extends U ? X : Y`: X when every value of T fits U. A check type that is a bare type
  // parameter distributes over the union it stands for, each member checked on its own, as in
  // TypeScript.
  function conditional(t: Extract<TypeNode, { kind: "conditional" }>): Type {
    const naked = t.check.kind === "ref" && t.check.args.length === 0 && scope.has(t.check.name) ? t.check.name : undefined;
    let check = resolveType(t.check);
    if (typeof check !== "string" && check.kind === "param" && check.concrete) check = check.concrete;
    const held = standIn([check], "a conditional type", t.check, true, () => deferring > 0);
    if (held) return branches(t, held);
    try {
      if (naked && check === "never") return "never";
      if (naked && typeof check !== "string" && check.kind === "union") {
        return unionType(check.members.map((m) => withScope(new Map([...scope, [naked, m]]), () => decide(t, m))));
      }
      return decide(t, check);
    } catch (e) {
      if (e instanceof Open) return branches(t, e.param);
      throw e;
    }
  }

  // A conditional a generic alias's placeholder decides, while the alias is checked before any
  // use: both branches are still checked, each `infer` name standing for an unknown type, and the
  // placeholder stands in for the result.
  function branches(t: Extract<TypeNode, { kind: "conditional" }>, held: Type): Type {
    const names = new Map([...inferNames(t.extends)].map((n): [string, Type] => [n, typeParameter(n, undefined)]));
    withScope(new Map([...scope, ...names]), () => resolveType(t.then));
    resolveType(t.else);
    return held;
  }

  // One check type's branch: the true one, with what each `infer` matched in scope, when the
  // check type fits the extends type.
  function decide(t: Extract<TypeNode, { kind: "conditional" }>, check: Type): Type {
    const names = inferNames(t.extends);
    if (names.size === 0) return resolveType(conforms(check, comparable(resolveType(t.extends), t.extends), t.extends) ? t.then : t.else);
    const found = new Map<string, Type>();
    if (!matches(t.extends, check, found)) return resolveType(t.else);
    for (const name of names) {
      if (!found.has(name)) throw new CompileError(`'infer ${name}' matched nothing in '${show(check)}', since the optional field holding it is missing; TypeScript would give 'unknown', which Fish doesn't have`, t.extends.start, t.extends.end);
    }
    return withScope(new Map([...scope, ...found]), () => resolveType(t.then));
  }

  // A type a conditional compares against, which can't hold a type parameter of generic code,
  // since fitting it would be decided once for every instance.
  function comparable(type: Type, at: Span): Type {
    const open = openParam(type, true);
    if (open && deferring > 0) throw new Open(open);
    standIn([type], "a conditional type", at, true, () => false);
    return type;
  }

  // Whether `t` fits the pattern `p`, recording in `found` the type each `infer` in it stands
  // for; a name inferred twice stands for the union of both. The pattern's form is checked
  // before the type it is matched against, so a refused form is refused for every type.
  function matches(p: TypeNode, t: Type, found: Map<string, Type>): boolean {
    if (inferNames(p).size === 0) return conforms(t, comparable(resolveType(p), p), p);
    if (typeof t !== "string" && t.kind === "param" && t.concrete) return matches(p, t.concrete, found);
    const kind = typeof t === "string" ? t : t.kind;
    if (p.kind === "infer") {
      if (p.constraint && !conforms(t, comparable(resolveType(p.constraint), p.constraint), p.constraint)) return false;
      const prior = found.get(p.name);
      found.set(p.name, prior ? unionType([prior, t]) : t);
      return true;
    }
    if (p.kind === "array" || (p.kind === "ref" && p.name === "Array" && p.args.length === 1)) {
      return kind === "array" && matches(p.kind === "array" ? p.element : p.args[0]!, (t as { element: Type }).element, found);
    }
    if (p.kind === "ref" && p.name === "Promise" && p.args.length === 1) {
      const gives = promiseElement(t) ?? (typeof t !== "string" && t.kind === "future" ? t.gives : undefined);
      return gives !== undefined && matches(p.args[0]!, gives, found);
    }
    // `Option<infer U>` is `U | null`: the empty value matches with nothing for U, anything else is U.
    if (p.kind === "ref" && p.name === "Option" && p.args.length === 1) {
      if (t === "null") return matches(p.args[0]!, "never", found);
      return matches(p.args[0]!, withoutNull(t), found);
    }
    if (p.kind === "ref" && (p.name === "Ref" || p.name === "Mut") && p.args.length === 1) {
      return typeof t !== "string" && t.kind === "ref" && t.mutable === (p.name === "Mut") && matches(p.args[0]!, t.to, found);
    }
    if (p.kind === "ref") {
      const args = typeof t !== "string" && t.kind === "class" && t.generic?.name === p.name ? t.generic.args : undefined;
      return args !== undefined && args.length === p.args.length && p.args.every((a, i) => matches(a, args[i]!, found));
    }
    if (p.kind === "function") {
      const [rest] = p.params;
      const any = p.params.length === 1 && rest!.rest && rest!.type?.kind === "array" && rest!.type.element.kind === "ref" && ["any", "unknown"].includes(rest!.type.element.name);
      const spread = p.params.find((q) => q.rest);
      if (!any && spread) throw unsupported("rest parameters other than '...args: any[]' in an 'infer' pattern, which need tuple types,", spread);
      if (typeof t === "string" || (t.kind !== "function" && t.kind !== "closure")) return false;
      if (!any && p.params.length !== t.params.length) return false;
      // A parameter fits the other way round: the function must take what the pattern passes.
      const params = any || p.params.every((q, i) => (q.type && inferNames(q.type).size > 0 ? matches(q.type, t.params[i]!, found) : fits(comparable(paramType(q), q), t.params[i]!)));
      return params && matches(p.returns, t.returns, found);
    }
    if (p.kind === "object") {
      for (const m of p.members) if (m.kind !== "property" || typeof m.name !== "string" || !m.type) throw unsupported("members other than properties in an 'infer' pattern", m);
      if (typeof t === "string" || (t.kind !== "object" && t.kind !== "class")) return false;
      return p.members.every((m) => {
        const member = m as Extract<TypeMember, { kind: "property" }>;
        const f = field(t, member.name as string);
        if (!f || (f.access ?? "public") !== "public") return member.optional === true;
        return matches(member.type!, f.type, found);
      });
    }
    if (p.kind === "template" && typeof t !== "string" && t.kind === "pattern") throw unsupported("'infer' patterns matched against template literal pattern types", p);
    // A template takes a string literal's text apart; each `infer` hole is its piece of text, as
    // a literal of the type its bound asks for.
    if (p.kind === "template") {
      if (typeof t === "string" || t.kind !== "literal" || typeof t.value !== "string" || t.owner) return false;
      const parts = splitTemplate(t.value, p.quasis);
      return parts !== undefined && p.types.every((hole, i) => {
        const text = parts[i]!;
        if (hole.kind !== "infer") {
          if (inferNames(hole).size > 0) throw unsupported("template literal holes holding 'infer' inside other types", hole);
          return textFits(text, comparable(resolveType(hole), hole));
        }
        const bound = hole.constraint ? comparable(resolveType(hole.constraint), hole.constraint) : "string";
        const value = inferredText(text, bound);
        if (value === undefined) return false;
        const prior = found.get(hole.name);
        found.set(hole.name, prior ? unionType([prior, value]) : value);
        return true;
      });
    }
    throw unsupported(p.kind === "union" ? "unions holding 'infer'" : `${TYPE_FORMS[p.kind as keyof typeof TYPE_FORMS] ?? "these types"} holding 'infer'`, p);
  }

  function member(m: TypeMember): Field {
    if (m.kind !== "property") throw unsupported(MEMBER_FORMS[m.kind], m);
    if (typeof m.name !== "string") throw unsupported("computed property names", m.name);
    if (!m.type) throw new CompileError(`property '${m.name}' implicitly has an 'any' type; add a type annotation`, m.start, m.end);
    // An object may leave out an optional property, which is then empty.
    const f = m.optional ? optionalField(m.name, unionMember(m.type)) : { name: m.name, type: resolveType(m.type) };
    return { ...f, type: storable(f.type, m), ...(m.readonly && { readonly: true }) };
  }
}

// Thrown inside a conditional whose extends side holds a placeholder of the generic alias being
// checked, and caught by that conditional, which then can't pick a branch.
class Open {
  readonly param: ParamType;
  constructor(param: ParamType) {
    this.param = param;
  }
}

// The literal an `infer` hole's text stands for under its bound: an i64 literal or another
// integer type for an integer's text, a boolean literal, a float type, or the text itself, the
// first of these the bound takes; or nothing when the bound takes none.
function inferredText(text: string, bound: Type): Type | undefined {
  const members = typeof bound !== "string" && bound.kind === "union" ? bound.members : [bound];
  // A bound taking any string keeps the text as written, as TypeScript does.
  if (members.includes("string")) return literalType(text);
  const candidates: Type[] = [];
  for (const m of members) {
    if (m === "i64" && textFits(text, m)) candidates.push(literalType(BigInt(text)));
    else if ((isInteger(m) || isFloat(m)) && textFits(text, m)) candidates.push(m);
    else if (m === "boolean" && textFits(text, m)) candidates.push(literalType(text === "true"));
  }
  candidates.push(literalType(text));
  return candidates.find((c) => fits(c, bound));
}

// The names a type pattern declares with `infer`.
function inferNames(n: unknown, names = new Set<string>()): Set<string> {
  if (!n || typeof n !== "object") return names;
  if (Array.isArray(n)) n.forEach((m) => inferNames(m, names));
  else if ((n as { kind?: string }).kind === "infer") names.add((n as { name: string }).name);
  else Object.values(n).forEach((m) => inferNames(m, names));
  return names;
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
    // A side where the field is optional gives way to one where it's required, as in
    // `Partial<T> & Pick<T, "id">`.
    const required = g.optional && !f.optional ? f : f.optional && !g.optional ? g : undefined;
    const other = required === f ? g : f;
    if (required && fits(required.type, other.type)) {
      const { readonly: _, ...kept } = required;
      fields[i] = { ...kept, ...(g.readonly && f.readonly && { readonly: true }) };
      continue;
    }
    if (g.type !== f.type && !both) {
      throw new CompileError(`property '${f.name}' has type '${show(g.type)}' on one side of '&' and '${show(f.type)}' on the other`, from.start, to.end);
    }
    const type = both ? merged(g.type as ObjectType, f.type as ObjectType, from, to) : f.type;
    fields[i] = { name: f.name, type, ...(g.readonly && f.readonly && { readonly: true }), ...(g.optional && f.optional && { optional: f.optional }) };
  }
  return objectType(fields);
}

// What each other kind of type is called when it can't be a side of `&`.
const SIDE_FORMS = { pattern: "template literal types", class: "classes", param: "type parameters", union: "unions", ref: "references", closure: "functions", function: "function types", array: "arrays", variant: "enum members", generator: "generators", pointer: "raw pointers", future: "promises", handle: "join handles", interior: "atomics, locks and cells", shared: "shared values", block: "semaphores and channels", dyn: "Dyn values" };

const I64_MAX = (1n << 63n) - 1n;

// An `Atomic<T>`, `Lock<T>` or `Cell<T>` holding a T it can hold: an Atomic, an integer or a
// boolean, which the processor changes in one step.
export function interior(which: InteriorType["which"], of: Type, at: Span): InteriorType {
  const held = lower(of);
  if (which === "Atomic" && held !== "boolean" && !isInteger(held) && !(typeof held !== "string" && held.kind === "param")) {
    throw new CompileError(`'Atomic' holds an integer or a boolean, not '${show(of)}'; use a 'Lock' for other values`, at.start, at.end);
  }
  if (holdsRef(of)) throw new CompileError(`'${which}' can't hold a reference yet ('${show(of)}')`, at.start, at.end);
  // Its methods take and give its value as lowered, which would let a plain string in.
  if (holdsPattern(of)) throw unsupported(`template literal pattern types in '${which}' values`, at);
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
  if (holdsPattern(of)) throw unsupported("template literal pattern types in channels", at);
  let blocker: Type | undefined;
  holdsPart(lower(of), (u) => {
    if (typeof u === "string" || !(u.kind === "ref" || u.kind === "pointer" || (u.kind === "interior" && u.which === "Cell"))) return false;
    blocker = u;
    return true;
  });
  if (blocker) throw new CompileError(`a 'Channel' carries values to other tasks, so it can't carry a '${show(blocker)}', which ${typeof blocker !== "string" && blocker.kind === "interior" ? "changes without a lock" : typeof blocker !== "string" && blocker.kind === "pointer" ? "is a raw pointer no thread can vouch for" : "borrows from where it was made"}`, at.start, at.end);
  return blockType("Channel", of);
}

const BUILT_IN_TYPES = new Set([...Object.keys(INTEGERS), "f32", "f64", "boolean", "void", "number", "string", "Ref", "Mut", "Lifetime", "Option", "Generator", "Promise", "JoinHandle", "Ptr", "MutPtr", "Atomic", "Lock", "Cell", "shared", "Semaphore", "Permit", "Channel", "AbortController", "AbortSignal", "TcpListener", "TcpStream", "Dyn", "null", "undefined"]);

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

