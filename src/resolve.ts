import type { Tables } from "./compilation.ts";
import { CompileError } from "./diag.ts";
import { didYouMean } from "./suggest.ts";
import { holdsNull } from "./defaults.ts";
import type { Expr, Interface, Param, Span, Stmt, TypeAlias, TypeMember, TypeNode } from "./parser.ts";
import { nextId, NodeMap, walk } from "./nodes.ts";
import type { DataEnum, EnumInfo, EnumInstance } from "./enums.ts";
import { placeholders } from "./generics.ts";
import { type RecursiveMaker, type UnionType, type InteriorRecord, TypeMap, ANY_REGEX, familyHeld, type RecursiveType, isFloat, splitTemplate, type BlockType, isInteger, type MapType, INTEGERS, type Integer, type ClassType, type Field, type InteriorType, type SharedType, type InterfaceType, type Method, type ObjectType, type ParamType, type Type, type Typing } from "./typing.ts";
import { TYPE_FORMS, unsupported } from "./unsupported.ts";
import { byteSize } from "./layout.ts";
import { openParam, standIn, TypeFunctions, UTILITIES, type TypeFunctionsHost } from "./typefns.ts";
import { mutates, owns, withoutUndefined } from "./classes.ts";

// Type annotations and the top-level type aliases they name, resolved to the checker's types.

// Aliases, classes and interfaces share one namespace of type names.
export function addAlias(aliases: Map<string, TypeAlias>, s: TypeAlias, ...others: Map<string, unknown>[]) {
  typeName(s.name, s, aliases, ...others);
  aliases.set(s.name, s);
}

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
export function storable(typing: Typing, written: Type, at: Span): Type {
  const w = typeof written === "string" ? undefined : typing.rec(written);
  if (w?.kind === "function" && w.generic) throw new CompileError(familyHeld("a field"), at.start, at.end);
  const type = typing.stored(written);
  const r = typeof type === "string" ? undefined : typing.rec(type);
  if (r?.kind === "interface") {
    throw new CompileError(`a field can't have the interface type '${r.name}'; use a type parameter instead`, at.start, at.end);
  }
  if (r?.kind === "closure") throw unsupported("functions stored in fields", at);
  // A reference or nothing is only a variable's, a parameter's or a result's.
  if (typing.holdsPart(type, (t) => typing.optionRef(t) !== undefined)) throw unsupported("unions holding references", at);
  return type;
}

// What resolving asks of the checker: the class a name and type arguments refer to, a generic
// one instantiated on first use; a class laid out, saying whether its fields are known yet; the
// type of a value `typeof` names; whether a type fits another as `extends` asks; and the type
// names in sight at an offset, for suggestions.
export interface ResolverHost {
  classNamed(this: Mut<this>, name: string, args: Type[], at: Span): ClassType | undefined;
  fieldsLaid(this: Mut<this>, c: ClassType): boolean;
  valueType(this: Mut<this>, name: string, at: Span, shadowed: boolean): Type;
  conforms(this: Mut<this>, from: Type, to: Type, at: Span): boolean;
  typeNames(at: usize): string[];
}

// Whether a name is a local or parameter where a type written at `at` sits.
export interface Sight {
  inSight(name: string, at: Span): boolean;
}

// Resolves type annotations and aliases. A generic alias is checked with placeholders for its
// type parameters, and resolved again per set of type arguments.
export class Resolver implements TypeFunctionsHost, RecursiveMaker {
  tables: Tables;
  aliases: Map<string, TypeAlias>;
  interfaces: Map<string, Interface>;
  enums: Map<string, EnumInfo>;
  slots: Map<string, boolean[]>;
  host: ResolverHost;

  constructor(tables: Tables, aliases: Map<string, TypeAlias>, interfaces: Map<string, Interface>, enums: Map<string, EnumInfo>, slots: Map<string, boolean[]>, host: ResolverHost) {
    this.tables = tables;
    this.aliases = aliases;
    this.interfaces = interfaces;
    this.enums = enums;
    this.slots = slots;
    this.host = host;
    this.declaredTypes = this.tables.declaredTypes;
    this.defaulted = this.tables.defaulted;
    this.presetTypes = this.tables.presetTypes;
    this.ids = this.tables.ids;
    this.typing = this.tables.typing;
    this.typing.lowersRecursive(this);
  }
  private declaredTypes: Tables["declaredTypes"];
  private defaulted: Tables["defaulted"];
  private presetTypes: Tables["presetTypes"];
  private ids: Tables["ids"];
  private typing: Typing;
  private recOf<T extends Type>(t: T | undefined) {
    return t === undefined || typeof t === "string" ? undefined : this.typing.rec(t as Exclude<T, string>);
  }
  // What was being resolved as each class layout under way began: an alias met again inside one
  // reads the fields of a class whose own field types need it.
  private layouts: Set<string>[] = [];
  // A class laid out for a type-level function, with no names in sight.
  fieldsKnown(this: Mut<this>, c: ClassType): boolean {
    this.layouts.push(new Set(this.resolving));
    try {
      return this.withSight(undefined, () => this.host.fieldsLaid(c));
    } finally {
      this.layouts.pop();
    }
  }
  isDeferring(): boolean {
    return this.deferring > 0;
  }
  conforms(from: Type, to: Type, at: Span): boolean {
    return this.host.conforms(from, to, at);
  }
  private typeFns(): TypeFunctions {
    return new TypeFunctions(this.typing, this);
  }
  private resolved = new Map<string, Type>();
  private resolving = new Set<string>();
  // Where an alias instance leads back to itself, by its key, and the alias each is made from.
  private recursives = new Map<string, RecursiveType>();
  private recursiveAliases = new TypeMap<RecursiveType, TypeAlias>();
  private traits = new NodeMap<Stmt, Map<string, InterfaceType>>();
  // Each combined interface `A & B`, by its sides.
  private combined = new Map<string, InterfaceType>();
  // The type parameters in scope, bound to what they stand for in the body being checked.
  private scope = new Map<string, Type>();
  // Above zero while a generic alias is checked with placeholders, before any use.
  private deferring = 0;
  // How many alias instances computing the outermost type has needed, against the budget.
  private computed = 0;
  // Whether a name is a local or parameter where a type written at `at` sits, which `typeof`
  // can't name yet; unset where only top-level names are in sight.
  private sight: Sight | undefined;
  setSight(this: Mut<this>, names: Sight | undefined) {
    this.sight = names;
  }
  withSight<T>(this: Mut<this>, names: Sight | undefined, f: () => T): T {
    const outer = this.sight;
    this.sight = names;
    try {
      return f();
    } finally {
      this.sight = outer;
    }
  }
  // The data-carrying enums being made, to catch one that holds itself.
  private making = new NodeMap<DataEnum, string>();
  // Where a data-carrying enum instance holds itself, by enum and type arguments.
  private enumBlocks = new Map<string, RecursiveType>();
  // The instance of a generic interface for other type arguments.
  interfaceInstance(this: Mut<this>, t: InterfaceType, args: Type[]) {
    return this.interfaceOf(this.interfaces.get(this.typing.rec(t).generic!.name)!, args);
  }
  // A recursive alias's type made again with other type arguments.
  remakeRecursive(this: Mut<this>, t: RecursiveType, args: Type[]): RecursiveType {
    const a = this.recursiveAliases.get(t);
    if (!a) return t;
    const key = `${a.name}<${args.map((t) => this.typing.keyOf(t)).join(",")}>`;
    const of = this.aliasType(a, args, a);
    let back = this.recursives.get(key);
    if (!back) {
      this.recursives.set(key, back = this.typing.recursiveType(`${a.name}<${args.map((t) => this.typing.show(t)).join(", ")}>`, args));
      this.typing.standsFor(back, of);
      this.recursiveAliases.set(back, a);
    }
    return back;
  }

  // Resolves every alias and interface once, so a mistake in one is reported even when nothing
  // uses it. Run once classes are linked, since an alias may read a class's fields.
  validate(this: Mut<this>) {
    this.aliases.forEach((a) => {
      const scope = placeholders(this.typing, a.typeParams, (t, s) => this.withScope(s, () => this.resolveType(t)));
      if (a.typeParams.length > 0) this.deferring++;
      try {
        this.aliasType(a, [...scope.values()], a);
      } finally {
        if (a.typeParams.length > 0) this.deferring--;
      }
    });
    // A generic interface is checked once with placeholders for its parameters.
    this.interfaces.forEach((i) => this.interfaceOf(i, [...placeholders(this.typing, i.typeParams, (t, s) => this.withScope(s, () => this.resolveType(t))).values()]));
  }

  // A data-carrying enum made with these type arguments: a variant per member, its payload
  // types resolved with the type parameters bound, and the enum as their union. An enum
  // holding itself would be infinitely large.
  enumInstance(this: Mut<this>, info: EnumInfo, given: Type[], at: Span): EnumInstance {
    given.forEach((a) => unboxedClosure(this.typing, a, at));
    const args = given.map((t) => this.typing.heldArgument(t));
    const data = info.data!;
    if (args.length !== data.params.length) {
      const n = data.params.length;
      throw new CompileError(`enum '${data.name}' takes ${n} type argument${n === 1 ? "" : "s"}`, at.start, at.end);
    }
    const key = args.map((t) => this.typing.keyOf(t)).join(",");
    const made = data.instances.get(key);
    if (made) return made;
    const shown = args.length > 0 ? `${data.name}<${args.map((t) => this.typing.show(t)).join(", ")}>` : data.name;
    // Met again while its members are made, it holds itself there, in a block.
    if (this.making.get(data) === key) {
      let back = this.enumBlocks.get(`${data.id} ${key}`);
      if (!back) this.enumBlocks.set(`${data.id} ${key}`, back = this.typing.recursiveType(shown, args));
      return { type: back, variants: new Map() };
    }
    if (this.making.has(data)) throw new CompileError(`enum '${data.name}' holds itself with other type arguments, which would make it infinitely large`, at.start, at.end);
    this.making.set(data, key);
    try {
      const bindings = new Map(data.params.map((p, i) => [p, args[i]!]));
      const variants = new Map(data.members.map((m) => {
        const payload = this.withScope(bindings, () => (m.payload ?? []).map((t) => {
          const type = storable(this.typing, this.resolveType(t), t);
          // A held reference would need its enum tracked as a borrower.
          // Said where the enum is used when its type argument brought the reference.
          if (this.typing.holdsRef(type)) throw unsupported("enum members holding references", args.some((a) => this.typing.holdsRef(a)) ? at : t);
          // An enum is laid out as written; one made from a pattern type argument is remade from its lowered argument.
          if (this.typing.holdsPattern(type) && !args.some((t) => this.typing.holdsPattern(t))) throw unsupported("template literal pattern types in enum members", t);
          return type;
        }));
        return [m.name, this.typing.variantType(data.name, data.id, m.name, args, payload)];
      }));
      const type = this.typing.unionType([...variants.values()], shown);
      for (const v of variants.values()) this.typing.rec(v).of = type;
      const back = this.enumBlocks.get(`${data.id} ${key}`);
      const union = this.recOf(type);
      if (back && union?.kind === "union") {
        this.typing.standsFor(back, type);
        this.typing.holdsBlock(type as UnionType, back);
      }
      const instance = { type, variants };
      data.instances.set(key, instance);
      return instance;
    } finally {
      this.making.delete(data);
    }
  }

  withScope<T>(this: Mut<this>, bindings: Map<string, Type>, f: () => T): T {
    const outer = this.scope;
    this.scope = bindings;
    try {
      return f();
    } finally {
      this.scope = outer;
    }
  }

  // TypeScript's strict mode has no implicit `any`, and Fish has no `any` at all. Only a
  // constructor's parameters may carry modifiers, which make them parameter properties.
  paramType(this: Mut<this>, p: Param, property = false): Type {
    const name = paramName(p);
    if (p.decorators.length > 0) throw unsupported("decorators", p);
    if (p.modifiers.length > 0 && !property) throw unsupported("parameter properties", p);
    if (name === "this") throw unsupported("'this' parameters", p);
    if (p.default) throw unsupported("default parameter values", p);
    if (!p.type) throw new CompileError(`parameter '${name}' implicitly has an 'any' type; add a type annotation`, p.start, p.end);
    // A parameter with a default is optional to callers, and holds its declared type in the body.
    const lowered = this.defaulted.get(p);
    if (lowered) {
      const declared = this.resolveType(p.type);
      const low = this.typing.lower(declared);
      const kind = this.recOf(low)?.kind;
      if (kind && ["function", "closure", "dyn", "interface", "param", "ref", "future", "generator", "handle"].includes(kind)) {
        throw new CompileError(`defaults on parameters of type '${this.typing.show(declared)}' are not supported yet`, p.start, p.end);
      }
      if (holdsNull(this.typing, declared) && !lowered.empty) throw new CompileError(`a parameter that may be null can have only 'null' as its default so far, since a passed null and a missing argument would look the same; write '${lowered.name}?: ...' and give the default in the body`, p.start, p.end);
      this.declaredTypes.set(p, declared);
    }
    // A call may leave out an optional parameter, which is then empty.
    const type = p.optional ? this.typing.unionType([this.unionMember(p.type), "null"]) : this.resolveType(p.type);
    const r = this.recOf(type);
    if (p.rest && r?.kind !== "array") throw new CompileError(`a rest parameter takes an array of the values, as in '...${name}: ${this.typing.show(type)}[]'`, p.type.start, p.type.end);
    // A comptime parameter makes an instance per value, so its type is one whose values compare.
    const keyed = (t: Type): boolean => {
      const k = this.recOf(t);
      return isInteger(t) || t === "boolean" || t === "string" || k?.kind === "literal" || (k?.kind === "union" && k.members.every(keyed));
    };
    // A tag's strings, `TemplateStringsArray`, are an array of strings.
    const strings = r?.kind === "array" && r.element === "string";
    if (p.comptime && (p.optional || !(keyed(type) || strings))) throw new CompileError(`a comptime parameter takes an integer, a boolean, a string, an enum member or a string array, not '${this.typing.show(type)}'`, p.type.start, p.type.end);
    return type;
  }

  // A function value is one compiled function, so a function it is given is a stored callable,
  // as in `(resolve: (value: T) => void) => void`.
  private callbackParam(this: Mut<this>, p: Param): Type {
    const t = this.paramType(p);
    const r = this.recOf(t);
    return r?.kind === "function" && !r.generic ? this.typing.stored(t) : t;
  }

  // What a function type's `throws` clause names, as a declared function's may name.
  private thrownBy(this: Mut<this>, t: Extract<TypeNode, { kind: "function" }>, returns: Type): Type | undefined {
    if (!t.throws) return undefined;
    // An async function's error comes at the `await`, with its future, not from the call.
    if (this.typing.promiseElement(returns) !== undefined) throw unsupported("function types giving a Promise that throw", t.throws);
    const error = this.resolveType(t.throws);
    if (error === "void") throw new CompileError("a function can't throw 'void'; throw a value", t.throws.start, t.throws.end);
    if (this.typing.holdsRef(error)) throw unsupported("errors holding references", t.throws);
    return error;
  }

  // An array of an element type. Arrays of references, and of functions, which would need their
  // calls boxed, aren't supported yet.
  private array(element: Type, at: TypeNode): Type {
    if (this.typing.holdsRef(element)) throw unsupported("arrays of references", at);
    const e = this.recOf(element);
    if (e?.kind === "closure") throw unsupported("arrays of functions", at);
    if (e?.kind === "function" && e.generic) throw new CompileError(familyHeld("an array"), at.start, at.end);
    if (e?.kind === "function") return this.typing.arrayType(this.typing.stored(element));
    if (e?.kind === "interface" && this.typing.stored(element) !== element) return this.typing.arrayType(this.typing.stored(element));
    // An interface describes values of many types, each laid out its own way, so an array of
    // them has no one element size.
    if (e?.kind === "interface") {
      throw new CompileError(`an array can't hold the interface type '${e.name}' directly, since its values may each be a different type; use 'Dyn<${e.name}>[]' to hold any of them`, at.start, at.end);
    }
    return this.typing.arrayType(element);
  }

  // `FixedArray<T, N>`: N elements of T held inline, N a number written in place.
  private fixedArray(this: Mut<this>, t: Extract<TypeNode, { kind: "ref" }>): Type {
    if (t.args.length !== 2) throw new CompileError("'FixedArray' takes an element type and a length, like 'FixedArray<i64, 4>'", t.start, t.end);
    const [of, n] = t.args as [TypeNode, TypeNode];
    if (n.kind === "literal" && n.value.kind === "unary" && n.value.op === "-") throw new CompileError("a FixedArray's length can't be negative", n.start, n.end);
    const size = n.kind === "literal" && n.value.kind === "int" ? n.value.value : undefined;
    if (size === undefined) throw new CompileError("a FixedArray's length is a number written in place, like 'FixedArray<i64, 4>'", n.start, n.end);
    const element = storable(this.typing, this.resolveType(of), of);
    if (this.typing.holdsRef(element)) throw unsupported("fixed arrays of references", of);
    // Its elements live where it does, often the stack, so all of them together are limited.
    if (size * BigInt(byteSize(this.typing, element)) > 65536n) throw new CompileError("a FixedArray holds at most 64 KiB inline, whatever its elements hold inline counted; use an array, 'T[]', for more", n.start, n.end);
    const e = this.recOf(element);
    if (e?.kind === "interface") throw new CompileError(`a FixedArray can't hold the interface type '${e.name}' directly; use 'Dyn<${e.name}>'`, of.start, of.end);
    return this.typing.fixedType(element, Number(size));
  }

  resolveType(this: Mut<this>, t: TypeNode): Type {
    const preset = this.presetTypes.get(t);
    if (preset !== undefined) {
      const swap = new TypeMap<Type, Type>();
      this.typing.holdsPart(preset, (u) => {
        const r = this.recOf(u);
        const bound = r?.kind === "param" ? this.scope.get(r.name) : undefined;
        if (bound !== undefined && bound !== u) swap.set(u, bound);
        return false;
      }, true);
      return swap.size > 0 ? this.typing.replaced(preset, swap) : preset;
    }
    // `readonly T[]` is a shared borrow of an array.
    if (t.kind === "operator" && t.op === "readonly" && t.type.kind === "array") return this.typing.refType(this.typing.arrayType(this.resolveType(t.type.element)), false);
    if (t.kind === "operator" && t.op === "keyof") return this.typeFns().keyofType(this.resolveType(t.type), t);
    if (t.kind === "operator") throw unsupported(`'${t.op}' types`, t);
    if (t.kind === "indexed") return this.typeFns().indexedType(this.resolveType(t.object), this.resolveType(t.index), t, t.index);
    if (t.kind === "conditional") return this.conditional(t);
    if (t.kind === "mapped") return this.mapped(t);
    if (t.kind === "template") {
      const holes = t.types.map((t) => this.resolveType(t));
      return standIn(this.typing, holes, "a template literal type", t, false, () => this.deferring > 0) ?? this.typeFns().templateType(t.quasis, holes, t, t.types);
    }
    if (t.kind === "infer") throw new CompileError(`'infer ${t.name}' declares a type only inside a conditional type's 'extends' clause, like 'T extends (infer U)[] ? U : never'`, t.start, t.end);
    if (t.kind === "function") {
      if (t.construct) throw unsupported("constructor types", t);
      const rest = t.params.find((p) => p.rest);
      if (rest) throw unsupported("rest parameters in function types", rest);
      // A generic one is shown and compared with its own parameters standing for themselves.
      if (t.typeParams.length > 0) {
        if (t.throws) throw unsupported("generic function types that throw", t.throws);
        const around = new Map(this.scope);
        const own = placeholders(this.typing, t.typeParams, (n, s) => this.withScope(new Map([...around, ...s]), () => this.resolveType(n)));
        const fn = this.withScope(new Map([...around, ...own]), () => this.typing.functionType(t.params.map(paramName), t.params.map((p) => this.callbackParam(p)), this.resolveType(t.returns)));
        this.typing.rec(fn).name = `<${t.typeParams.map((p) => p.name).join(", ")}>${this.typing.rec(fn).name}`;
        this.typing.rec(fn).generic = { names: t.typeParams.map((p) => p.name), node: t, scope: around, own: [...own.values()] };
        return fn;
      }
      const returns = this.resolveType(t.returns);
      const fn = this.typing.functionType(t.params.map(paramName), t.params.map((p) => this.callbackParam(p)), returns, this.thrownBy(t, returns));
      if ([this.typing.rec(fn).returns, ...this.typing.rec(fn).params].some((t) => this.typing.holdsPattern(t))) throw unsupported("template literal pattern types in function types", t);
      return fn;
    }
    if (t.kind === "object") return this.typing.objectType(fields(t.members.map((m) => this.member(m)), t.members));
    if (t.kind === "literal") return this.literal(t.value);
    if (t.kind === "union") return this.union(t.types);
    if (t.kind === "intersection") return this.intersection(t.types);
    if (t.kind === "array") return this.array(this.resolveType(t.element), t);
    if (t.kind === "tuple") {
      const rest = t.elements.findIndex((e) => e.rest);
      if (rest >= 0 && rest < t.elements.length - 1) throw unsupported("rest elements before the end of a tuple type", t.elements[rest]!);
      const fixed = rest < 0 ? t.elements : t.elements.slice(0, rest);
      const required = fixed.findIndex((e) => e.optional);
      const late = required < 0 ? undefined : fixed.slice(required).find((e) => !e.optional);
      if (late) throw new CompileError("a required element can't follow an optional one; move it before the optional elements", late.start, late.end);
      if (rest >= 0 && required >= 0) throw unsupported("tuple types with both optional and rest elements", t.elements[rest]!);
      const many = rest < 0 ? undefined : this.resolveType(t.elements[rest]!.type);
      const m = this.recOf(many);
      if (many !== undefined && m?.kind !== "array") throw new CompileError(`a tuple's rest element is an array type, like '...${this.typing.show(many)}[]'`, t.elements[rest]!.start, t.elements[rest]!.end);
      return this.typing.tupleType(fixed.map((e) => (e.optional ? this.typing.unionType([storable(this.typing, this.resolveType(e.type), e), "null"]) : storable(this.typing, this.resolveType(e.type), e))), required < 0 ? undefined : required, m?.kind === "array" ? m.element : undefined);
    }
    // `typeof f` or `typeof X`: a top-level function's or const's type.
    if (t.kind === "query") {
      if (t.target.kind !== "ref" || t.target.args.length > 0 || t.target.name.includes(".")) throw unsupported("'typeof' types other than of a top-level function or const", t);
      return this.host.valueType(t.target.name, t, this.sight?.inSight(t.target.name, t) === true);
    }
    if (t.kind !== "ref") throw unsupported(TYPE_FORMS[t.kind], t);
    const bound = this.scope.get(t.name);
    if (bound && t.args.length === 0) return bound;
    if (Object.hasOwn(INTEGERS, t.name) || ["boolean", "void", "number", "f32", "f64", "string", "bigint"].includes(t.name)) {
      if (t.args.length > 0) throw new CompileError(`type '${t.name}' is not generic`, t.start, t.end);
      // `number` is JavaScript's 64-bit float.
      return t.name === "number" ? "f64" : (t.name as Integer | "f32" | "f64" | "boolean" | "void" | "string" | "bigint");
    }
    if (t.name === "Array" && t.args.length === 1) return this.array(this.resolveType(t.args[0]!), t);
    if (t.name === "FixedArray") return this.fixedArray(t);
    if (t.name === "Array" || t.name === "ReadonlyArray") throw unsupported(t.name === "Array" ? "'Array' without one type argument" : "'ReadonlyArray' types", t);
    if (t.name === "Ref" || t.name === "Mut") return this.reference(t);
    if (t.name === "never" && t.args.length === 0) return "never";
    if (t.name === "null" || t.name === "undefined") {
      if (t.args.length > 0) throw new CompileError(`type '${t.name}' is not generic`, t.start, t.end);
      return "null";
    }
    if (t.name === "Ptr" || t.name === "MutPtr") {
      if (t.args.length !== 1) throw new CompileError(`'${t.name}' takes the type it points to, like '${t.name}<u8>'`, t.start, t.end);
      return this.typing.pointerType(this.resolveType(t.args[0]!), t.name === "MutPtr");
    }
    if (t.name === "Atomic" || t.name === "Lock" || t.name === "Cell") {
      if (t.args.length !== 1) throw new CompileError(`'${t.name}' takes the type it holds, like '${t.name}<i64>'`, t.start, t.end);
      return interior(this.typing, t.name, this.resolveType(t.args[0]!), t);
    }
    if (t.name === "Dyn") {
      const of = t.args.length === 1 ? this.resolveType(t.args[0]!) : undefined;
      const o = this.recOf(of);
      if (o?.kind !== "interface" || this.typing.promiseElement(of!) !== undefined || this.typing.generatorElement(of!) !== undefined) {
        throw new CompileError("'Dyn' takes the interface its values implement, like 'Dyn<Handler>'", t.start, t.end);
      }
      return this.typing.dynType(of as InterfaceType);
    }
    if (t.name === "RegExp") {
      if (t.args.length !== 0) throw new CompileError("'RegExp' takes no type arguments", t.start, t.end);
      return ANY_REGEX;
    }
    if (t.name === "Semaphore" || t.name === "Permit" || t.name === "AbortController" || t.name === "AbortSignal" || t.name === "TcpListener" || t.name === "TcpStream" || t.name === "JsValue") {
      if (t.args.length !== 0) throw new CompileError(`'${t.name}' takes no type arguments`, t.start, t.end);
      return this.typing.blockType(t.name);
    }
    if (t.name === "Channel") {
      if (t.args.length !== 1) throw new CompileError("'Channel' takes the type it carries, like 'Channel<string>'", t.start, t.end);
      return channel(this.typing, this.resolveType(t.args[0]!), t);
    }
    if (t.name === "Map" || t.name === "Set") {
      const set = t.name === "Set";
      if (t.args.length !== (set ? 1 : 2)) throw new CompileError(set ? "'Set' takes the type of its members, like 'Set<string>'" : "'Map' takes its key and value types, like 'Map<string, i64>'", t.start, t.end);
      return collection(this.typing, this.resolveType(t.args[0]!), set ? "void" : this.resolveType(t.args[1]!), set, t);
    }
    if (t.name === "shared") {
      if (t.args.length !== 1) throw new CompileError("'shared' takes the type it holds, like 'shared<State>'", t.start, t.end);
      return shareable(this.typing, this.resolveType(t.args[0]!), t);
    }
    // A `JoinHandle<T>` written out is one whose task can't throw.
    if (t.name === "JoinHandle") {
      if (t.args.length !== 1) throw new CompileError("'JoinHandle' takes the type its task gives, like 'JoinHandle<i64>'", t.start, t.end);
      return this.typing.handleType(this.typing.heldArgument(this.resolveType(t.args[0]!)), undefined);
    }
    if (t.name === "Promise") {
      if (t.args.length !== 1) throw new CompileError("'Promise' takes the type it gives once awaited, like 'Promise<i64>'", t.start, t.end);
      const gives = this.typing.heldArgument(this.resolveType(t.args[0]!));
      if (this.typing.holdsPattern(gives)) throw unsupported("template literal pattern types in promises", t);
      return this.typing.promiseInterface(gives);
    }
    if (t.name === "Generator") {
      if (t.args.length !== 1) throw new CompileError("'Generator' takes the type it yields, like 'Generator<i64>'", t.start, t.end);
      return this.typing.generatorInterface(this.resolveType(t.args[0]!));
    }
    if (t.name === "AsyncGenerator") {
      if (t.args.length !== 1) throw new CompileError("'AsyncGenerator' takes the type it yields, like 'AsyncGenerator<i64>'", t.start, t.end);
      return this.typing.asyncGeneratorInterface(this.resolveType(t.args[0]!));
    }
    if (t.name === "Option") {
      if (t.args.length !== 1) throw new CompileError("'Option' takes the type it may hold, like 'Option<i64>'", t.start, t.end);
      return this.typing.unionType([this.unionMember(t.args[0]!, true), "null"]);
    }
    // A class's lifetimes, written or left out, are no type arguments.
    const lifetime = this.slots.get(t.name);
    const args = (lifetime && t.args.length === lifetime.length ? t.args.filter((_, i) => !lifetime[i]) : t.args).map((t) => this.resolveType(t));
    const alias = this.aliases.get(t.name);
    // A package's object type is a JS handle of that shape; its other aliases are what they say.
    if (alias?.js) {
      const aliased = this.aliasType(alias, args, t);
      const r = this.recOf(aliased);
      return r?.kind === "object" && !r.tuple ? this.typing.blockType("JsValue", aliased) : aliased;
    }
    if (alias) return this.aliasType(alias, args, t);
    const named = this.host.classNamed(t.name, args, t);
    if (named !== undefined && this.typing.rec(named).abstract) throw new CompileError(`'${t.name}' is an abstract class, which only exists embedded in its subclasses, so it can't be a value's type; describe what they share with an interface instead`, t.start, t.end);
    if (named) return named;
    const [owner, name] = t.name.split(".");
    const e = this.enums.get(owner!);
    if (e?.data) {
      const instance = this.enumInstance(e, args, t);
      if (name === undefined) return instance.type;
      const variant = instance.variants.get(name);
      if (variant) return variant;
    }
    if (e && name === undefined) return e.type;
    if (e && e.members.has(name!)) return e.members.get(name!)!;
    const trait = this.interfaces.get(t.name);
    // A package's interface or class is a JS handle of its shape.
    if (trait?.js) return this.typing.blockType("JsValue", this.interfaceOf(trait, args, t));
    if (trait) return this.interfaceOf(trait, args.map((t) => this.typing.heldArgument(t)), t);
    // TypeScript's utility types, unless the program declares its own of the name.
    const utility = UTILITIES.get(t.name);
    if (utility) {
      const [count, example] = utility;
      const apply = (given: Type[], at: Span, argAt: Span[]) => this.typeFns().utility(t.name, given, at, argAt);
      if (args.length !== count) throw new CompileError(`'${t.name}' takes ${count === 1 ? "one type argument" : "two type arguments"}, like '${example}'`, t.start, t.end);
      // Over a JS handle, a utility type remakes its shape's fields, and gives a handle again.
      const shapes = args.map((t) => this.typing.jsShape(t));
      if (shapes.some((x) => x !== undefined)) {
        const made = apply(args.map((a, k) => (shapes[k] ? this.typing.objectType(this.typing.rec(shapes[k]!).fields) : a)), t, t.args);
        const r = this.recOf(made);
        return r?.kind === "object" && !r.tuple ? this.typing.blockType("JsValue", made) : made;
      }
      return apply(args, t, t.args);
    }
    throw new CompileError(`cannot find type '${t.name}'${didYouMean(t.name, [...this.scope.keys(), ...BUILT_IN_TYPES, "Array", "FixedArray", "never", ...UTILITIES.keys(), ...this.host.typeNames(t.start)])}`, t.start, t.end);
  }

  // `Ref<T>` borrows a T, and `Mut<T>` borrows it mutably.
  // `Ref<T, A>` also names the lifetime parameter it lives for, checked by the function.
  private reference(this: Mut<this>, t: Extract<TypeNode, { kind: "ref" }>): Type {
    if (t.args.length !== 1 && t.args.length !== 2) {
      throw new CompileError(`type '${t.name}' takes the type it borrows, and optionally a lifetime`, t.start, t.end);
    }
    const to = this.resolveType(t.args[0]!);
    if (to === "void") throw new CompileError("there is no 'void' value to borrow", t.start, t.end);
    if (this.recOf(to)?.kind === "function") throw unsupported("references to functions", t);
    // A type parameter standing for a reference makes one too.
    if (this.recOf(this.typing.lower(to))?.kind === "ref") throw unsupported("references to references", t);
    const life = t.args[1];
    if (life && (life.kind !== "ref" || life.args.length > 0)) throw new CompileError("a lifetime is a name declared as '<A extends Lifetime>'", life.start, life.end);
    return this.typing.refType(to, t.name === "Mut", life?.name);
  }

  // The one union holding a reference is a reference or nothing, `Ref<T> | null`, as Rust's
  // `Option<&T>` is.
  private union(this: Mut<this>, nodes: TypeNode[]): Type {
    const option = nodes.filter((n) => !(n.kind === "ref" && n.name === "null" && n.args.length === 0)).length === 1;
    return this.typing.unionType(nodes.map((n) => this.unionMember(n, option)));
  }

  // A union holds values, so an interface, which describes values without being one, can't be
  // a member, and neither can `void`.
  private unionMember(this: Mut<this>, node: TypeNode, option = false): Type {
    const t = this.resolveType(node);
    if (t === "void") throw new CompileError("'void' can't be a union member", node.start, node.end);
    const r = this.recOf(t);
    if (r?.kind === "interface") throw new CompileError(`an interface can't be a union member; '${r.name}' describes values without being one`, node.start, node.end);
    // A union holds a value, so a function type in one is a stored callable.
    if (r?.kind === "function" && r.generic) throw new CompileError(familyHeld("a union"), node.start, node.end);
    if (r?.kind === "function") return this.typing.stored(t);
    if (this.typing.holdsRef(t) && !(option && r?.kind === "ref")) throw unsupported("unions holding references", node);
    return t;
  }

  private literal(e: Expr): Type {
    if (e.kind === "string" || e.kind === "bool") return this.typing.literalType(e.value);
    const negative = e.kind === "unary" && e.op === "-";
    const digits = negative ? e.operand : e;
    if (digits.kind !== "int") throw unsupported("literal types of this kind", e);
    const value = negative ? -digits.value : digits.value;
    if (value > I64_MAX || value < -I64_MAX - 1n) throw new CompileError("integer literal does not fit in i64", e.start, e.end);
    return this.typing.literalType(value);
  }

  // `A & B` of object types is one object type with the fields of both. With an interface it
  // is a combined bound: an interface with every side's fields and methods. A union of object
  // types as a side distributes, as in TypeScript: `A & (B | C)` is `(A & B) | (A & C)`.
  private intersection(this: Mut<this>, nodes: TypeNode[]): Type {
    const sides = nodes.map((node): ObjectType | InterfaceType | UnionType => {
      const s = this.resolveType(node);
      const t = this.recOf(s);
      if (t?.kind === "object" || t?.kind === "interface") return s as ObjectType | InterfaceType;
      if (t?.kind === "union" && t.members.every((m) => this.recOf(m)?.kind === "object")) return s as UnionType;
      throw unsupported(`intersections with ${t === undefined || t.kind === "literal" ? "primitive types" : t.kind === "union" ? "unions of other than object types" : SIDE_FORMS[t.kind]}`, node);
    });
    const [from, to] = [nodes[0]!, nodes.at(-1)!];
    if (sides.some((s) => this.typing.rec(s).kind === "union")) {
      const at = nodes[sides.findIndex((s) => this.typing.rec(s).kind === "interface")];
      if (at) throw unsupported("intersections of interfaces with unions", at);
      const choices = sides.map((s) => { const r = this.typing.rec(s); return (r.kind === "union" ? r.members : [s]) as ObjectType[]; });
      const combos = choices.reduce<ObjectType[][]>((acc, ms) => acc.flatMap((c) => ms.map((m) => [...c, m])), [[]]);
      return this.typing.unionType(combos.map((c) => c.reduce((a, b) => merged(this.typing, a, b, from, to))));
    }
    const fields = sides.map((s) => this.typing.objectType(this.typing.rec(s).fields)).reduce((a, b) => merged(this.typing, a, b, from, to));
    if (sides.every((s) => this.typing.rec(s).kind === "object")) return fields;
    const key = sides.map((t) => this.typing.keyOf(t)).join(" & ");
    let found = this.combined.get(key);
    if (found) return found;
    this.combined.set(key, found = this.typing.interfaceType(sides.map((t) => this.typing.show(t)).join(" & ")));
    this.typing.rec(found).fields.push(...this.typing.rec(fields).fields.map((f) => ({ ...f })));
    for (const m of sides.flatMap((s) => { const r = this.typing.rec(s); return r.kind === "interface" ? r.methods : []; })) {
      const same = this.typing.rec(found).methods.find((x) => x.name === m.name);
      if (!same) this.typing.rec(found).methods.push(m);
      else if (this.typing.shapeKey(same.returns) !== this.typing.shapeKey(m.returns) || same.params.length !== m.params.length || same.params.some((p, i) => this.typing.shapeKey(p) !== this.typing.shapeKey(m.params[i]!))) {
        throw new CompileError(`method '${m.name}' has different types on each side of '&'`, from.start, to.end);
      }
    }
    return found;
  }

  // The interface is registered before its members resolve, so a member may name it. A generic
  // interface is one interface per list of type arguments, its members seeing them.
  private interfaceOf(this: Mut<this>, i: Interface, args: Type[] = [], at: Span = i): InterfaceType {
    if (args.length !== i.typeParams.length) {
      throw new CompileError(`interface '${i.name}' expects ${i.typeParams.length} type argument${i.typeParams.length === 1 ? "" : "s"}, but got ${args.length}`, at.start, at.end);
    }
    // Every copy of a package's interface, one per import of it, is one type.
    const owner = i.jsSource ?? i;
    let byArgs = this.traits.get(owner);
    if (!byArgs) this.traits.set(owner, byArgs = new Map());
    const key = args.map((t) => this.typing.keyOf(t)).join(",");
    const found = byArgs.get(key);
    if (found) return found;
    if (byArgs.size > 64) throw new CompileError(`instantiating interface '${i.name}' never ends: each instance needs another with larger type arguments`, at.start, at.end);
    const t = this.typing.interfaceType(args.length > 0 ? `${i.name}<${args.map((t) => this.typing.show(t)).join(", ")}>` : i.name);
    if (args.length > 0) this.typing.rec(t).generic = { name: i.name, args };
    byArgs.set(key, t);
    // Its members are written where it is declared, with its parameters standing for the arguments.
    return this.withSight(undefined, () => this.withScope(new Map(i.typeParams.map((p, k) => [p.name, args[k]!])), () => this.members(i, t)));
  }

  private members(this: Mut<this>, i: Interface, t: InterfaceType): InterfaceType {
    // A package's interface or class may declare again what it inherits, narrowing it, as
    // TypeScript lets a derived member replace its base's.
    const inherited = new Set<string>();
    const add = (name: string, at: Span) => {
      if (i.js && inherited.delete(name)) {
        this.typing.rec(t).fields = this.typing.rec(t).fields.filter((f) => f.name !== name);
        this.typing.rec(t).methods = this.typing.rec(t).methods.filter((m) => m.name !== name);
        return;
      }
      if (this.typing.rec(t).fields.some((f) => f.name === name) || this.typing.rec(t).methods.some((m) => m.name === name)) {
        if ((at as { kind?: string }).kind === "method" && this.typing.rec(t).methods.some((m) => m.name === name)) throw new CompileError(`'${name}' is declared twice in interface '${i.name}'; method overloads in interfaces aren't supported yet, so give each signature its own name`, at.start, at.end);
        throw new CompileError(`duplicate member '${name}' in interface '${i.name}'`, at.start, at.end);
      }
    };
    for (const node of i.extends) {
      // A package's interface or class extends another's shape, which a JS handle holds.
      const resolved = this.resolveType(node);
      const base = this.typing.jsShape(resolved) ?? resolved;
      const b = this.recOf(base);
      if (b === undefined || (b.kind !== "interface" && !(i.js && b.kind === "object"))) throw new CompileError("an interface can only extend interfaces", node.start, node.end);
      for (const f of b.fields) add(f.name, node), this.typing.rec(t).fields.push({ ...f }), inherited.add(f.name);
      if (b.kind === "interface") for (const m of b.methods) add(m.name, node), this.typing.rec(t).methods.push(m), inherited.add(m.name);
    }
    const member1 = this.memberOf(i, t, add);
    for (const m of i.members) {
      // A package's member Fish can't type is refused only where a program uses it.
      if (i.js) {
        try {
          member1(m);
        } catch (e) {
          if (!(e instanceof CompileError)) throw e;
          // A member without a name, as an index or call signature, is never reached by one, but
          // still comes only with a value JS made.
          const key = "name" in m && typeof m.name === "string" ? m.name : `[${m.kind}]`;
          if (!this.typing.jsUntyped.has(t)) this.typing.jsUntyped.set(t, new Map());
          this.typing.jsUntyped.get(t)!.set(key, e);
          if ("optional" in m && m.optional) this.typing.jsOptional.add(e);
        }
        continue;
      }
      member1(m);
    }
    return t;
  }

  private memberOf(this: Mut<this>, i: Interface, t: InterfaceType, add: (name: string, at: Span) => void) {
    return (m: TypeMember) => {
      if (m.kind === "method") {
        if (typeof m.name !== "string") throw unsupported("computed property names", m.name);
        if (m.optional) throw unsupported("optional methods", m);
        if (!m.returns) throw new CompileError(`method '${m.name}' implicitly returns 'any'; add a return type`, m.start, m.end);
        add(m.name, m);
        const first = m.params[0];
        const self = first?.pattern.kind === "ident" && first.pattern.name === "this" ? first : undefined;
        const rest = m.params.find((p) => p.rest);
        if (rest) throw unsupported("rest parameters in interface methods", rest);
        // A generic method's own type parameters stand for themselves in its signature.
        const around = new Map(this.scope);
        const own = m.typeParams.length > 0 ? placeholders(this.typing, m.typeParams, (n, s) => this.withScope(new Map([...around, ...s]), () => this.resolveType(n))) : new Map<string, Type>();
        const returns = m.returns;
        const [params, result] = this.withScope(new Map([...around, ...own]), () => [(self ? m.params.slice(1) : m.params).map((p) => this.paramType(p)), this.resolveType(returns)] as const);
        const method: Method = { name: m.name, params, returns: result, mutable: self ? mutates(self) : false, owned: self ? owns(self) : false };
        if (i.js) method.optional = (self ? m.params.slice(1) : m.params).map((p) => p.optional);
        if (m.typeParams.length > 0) method.generic = { names: m.typeParams.map((p) => p.name), node: { ...m, id: nextId(this.ids), params: self ? m.params.slice(1) : m.params }, scope: around, own: [...own.values()] };
        if ([method.returns, ...method.params].some((t) => this.typing.holdsPattern(t))) throw unsupported("template literal pattern types in interface methods", m);
        this.typing.rec(t).methods.push(method);
      } else {
        const f = this.member(m);
        if (this.typing.holdsPattern(f.type)) throw unsupported("template literal pattern types in interface fields", m);
        add(f.name, m);
        this.typing.rec(t).fields.push(f);
      }
    };
  }

  // An alias met again while its own type is made leads back to itself: that is where the
  // compiler puts a pointer, a recursive type standing for the alias's type.
  private aliasType(this: Mut<this>, a: TypeAlias, args: Type[], at: Span): Type {
    if (args.length !== a.typeParams.length) {
      throw new CompileError(`type '${a.name}' expects ${a.typeParams.length} type argument${a.typeParams.length === 1 ? "" : "s"}, but got ${args.length}`, at.start, at.end);
    }
    const key = `${a.name}<${args.map((t) => this.typing.keyOf(t)).join(",")}>`;
    const done = this.resolved.get(key);
    if (done) return done;
    // Inside a generic alias checked before any use, another alias given its placeholders is only
    // checked for its arguments: following it could recurse without end.
    const open = this.deferring > 0 && this.resolving.size > 0 ? args.map((t) => openParam(this.typing, t, true)).find((t) => t) : undefined;
    if (open) return open;
    if (this.layouts.some((s) => s.has(key))) {
      throw new CompileError(`type '${a.name}' reads a class's fields while that class's own field types are being worked out from it, so it can't be computed yet`, at.start, at.end);
    }
    if (this.resolving.has(key)) {
      let back = this.recursives.get(key);
      // A std alias may be shown by another name than the one it is linked under.
      const name = (a as { shown?: string }).shown ?? a.name;
      if (!back) this.recursives.set(key, back = this.typing.recursiveType(args.length > 0 ? `${name}<${args.map((t) => this.typing.show(t)).join(", ")}>` : name, args));
      return back;
    }
    // A type that branches as it recurses grows exponentially, so the whole program's type
    // evaluation has a budget, as TypeScript caps instantiations.
    if (this.resolving.size === 0) this.computed = 0;
    if (++this.computed > 20_000) throw new CompileError(`computing type '${a.name}' needed more than 20000 alias instances; a type that branches as it recurses grows exponentially`, at.start, at.end);
    if (this.resolving.size > 64) throw new CompileError(`type '${a.name}' is nested more than 64 alias instances deep while being computed; a type that uses itself must reach a branch that stops sooner`, at.start, at.end);
    this.resolving.add(key);
    let type: Type;
    try {
      // An alias's body sees the names where it is declared, not where it is used.
      type = this.withSight(undefined, () => this.withScope(new Map(a.typeParams.map((p, i) => [p.name, args[i]!])), () => this.resolveType(a.type)));
    } finally {
      this.resolving.delete(key);
    }
    const back = this.recursives.get(key);
    // Only a structure can hold a type again: `type A = B | null` with `type B = A` would be a
    // name for nothing but itself.
    const r = this.recOf(type);
    if (back && (type === back || (r?.kind === "union" && r.members.includes(back)))) {
      throw new CompileError(`type '${a.name}' circularly references itself; a type can hold itself only inside an object, a tuple or an array`, a.start, a.end);
    }
    if (back) {
      this.typing.standsFor(back, type);
      this.recursiveAliases.set(back, a);
    }
    this.resolved.set(key, type);
    return type;
  }

  // `{ [K in C as N]: X }`: a field for each key C names, its type X with K bound to the key. Over
  // `keyof T` it keeps T's optional and readonly fields unless a modifier says otherwise, and
  // `as` renames each key, or drops one renamed to `never`.
  private mapped(this: Mut<this>, t: Extract<TypeNode, { kind: "mapped" }>): Type {
    const homomorphic = t.constraint.kind === "operator" && t.constraint.op === "keyof" ? this.resolveType(t.constraint.type) : undefined;
    const keys = this.resolveType(t.constraint);
    if (!t.type) throw new CompileError(`a mapped type needs the type of its fields, like '{ [${t.name} in keyof T]: i64 }'`, t.start, t.end);
    const held = standIn(this.typing, homomorphic ? [homomorphic, keys] : [keys], "a mapped type", t.constraint, false, () => this.deferring > 0);
    if (held) {
      this.withScope(new Map([...this.scope, [t.name, held]]), () => (t.as && this.resolveType(t.as), this.resolveType(t.type!)));
      return held;
    }
    const source = homomorphic ? this.typeFns().fieldsOf(homomorphic, "a mapped type", t.constraint) : [];
    const fields: Field[] = [];
    for (const key of keys === "never" ? [] : this.typeFns().keysOf(keys, "a mapped type", t.constraint)) {
      const bound = new Map([...this.scope, [t.name, this.typing.literalType(key)]]);
      const renamed = t.as ? this.withScope(bound, () => this.resolveType(t.as!)) : this.typing.literalType(key);
      const names = renamed === "never" ? [] : this.typeFns().keysOf(renamed, "a mapped type's 'as' clause", t.as ?? t);
      const value = storable(this.typing, this.withScope(bound, () => this.resolveType(t.type!)), t.type);
      const from = source.find((f) => f.name === key);
      const readonly = t.readonly ? t.readonly === "+" : from?.readonly === true;
      for (const name of names) {
        if (fields.some((f) => f.name === name)) throw new CompileError(`two keys of this mapped type are both renamed '${name}', and an object type has each field once`, (t.as ?? t).start, (t.as ?? t).end);
        const field = t.optional === "+" ? this.typing.optionalField(name, value)
          : t.optional === "-" ? { name, type: from?.optional === "added" ? this.typing.withoutNull(value) : value }
          : from?.optional && from.optional !== "undefined" ? this.kept(name, value, from.optional)
          : { name, type: value };
        fields.push({ ...field, ...(readonly && { readonly: true }) });
      }
    }
    return this.typing.objectType(fields);
  }

  // A field a homomorphic mapped type keeps optional: its null is the one `?` added unless the
  // new type held one of its own as the old did.
  private kept(name: string, value: Type, was: "added" | "held"): Field {
    const r = this.recOf(value);
    const own = value === "null" || (r?.kind === "union" && r.members.includes("null"));
    return { name, type: own ? value : this.typing.unionType([value, "null"]), optional: was === "held" && own ? "held" : "added" };
  }

  // `T extends U ? X : Y`: X when every value of T fits U. A check type that is a bare type
  // parameter distributes over the union it stands for, each member checked on its own, as in
  // TypeScript.
  private conditional(this: Mut<this>, t: Extract<TypeNode, { kind: "conditional" }>): Type {
    const naked = t.check.kind === "ref" && t.check.args.length === 0 && this.scope.has(t.check.name) ? t.check.name : undefined;
    let check = this.resolveType(t.check);
    const c = this.recOf(check);
    if (c?.kind === "param" && c.concrete) check = c.concrete;
    const held = standIn(this.typing, [check], "a conditional type", t.check, true, () => this.deferring > 0);
    if (held) return this.branches(t, held);
    try {
      if (naked && check === "never") return "never";
      const r = this.recOf(check);
      if (naked && r?.kind === "union") {
        return this.typing.unionType(r.members.map((m) => this.withScope(new Map([...this.scope, [naked, m]]), () => this.decide(t, m))));
      }
      return this.decide(t, check);
    } catch (e) {
      if (e instanceof Open) return this.branches(t, e.param);
      throw e;
    }
  }

  // A conditional a generic alias's placeholder decides, while the alias is checked before any
  // use: both branches are still checked, each `infer` name standing for an unknown type, and the
  // placeholder stands in for the result.
  private branches(this: Mut<this>, t: Extract<TypeNode, { kind: "conditional" }>, held: Type): Type {
    const names = new Map([...inferNames(t.extends)].map((n): [string, Type] => [n, this.typing.typeParameter(n, undefined)]));
    this.withScope(new Map([...this.scope, ...names]), () => this.resolveType(t.then));
    this.resolveType(t.else);
    return held;
  }

  // One check type's branch: the true one, with what each `infer` matched in scope, when the
  // check type fits the extends type.
  private decide(this: Mut<this>, t: Extract<TypeNode, { kind: "conditional" }>, check: Type): Type {
    const names = inferNames(t.extends);
    if (names.size === 0) return this.resolveType(this.conforms(check, this.comparable(this.resolveType(t.extends), t.extends), t.extends) ? t.then : t.else);
    const found = new Map<string, Type>();
    if (!this.matches(t.extends, check, found)) return this.resolveType(t.else);
    for (const name of names) {
      if (!found.has(name)) throw new CompileError(`'infer ${name}' matched nothing in '${this.typing.show(check)}', since the optional field holding it is missing; TypeScript would give 'unknown', which Fish doesn't have`, t.extends.start, t.extends.end);
    }
    return this.withScope(new Map([...this.scope, ...found]), () => this.resolveType(t.then));
  }

  // A type a conditional compares against, which can't hold a type parameter of generic code,
  // since fitting it would be decided once for every instance.
  private comparable(type: Type, at: Span): Type {
    const open = openParam(this.typing, type, true);
    if (open && this.deferring > 0) throw new Open(open);
    standIn(this.typing, [type], "a conditional type", at, true, () => false);
    return type;
  }

  // Whether `t` fits the pattern `p`, recording in `found` the type each `infer` in it stands
  // for; a name inferred twice stands for the union of both. The pattern's form is checked
  // before the type it is matched against, so a refused form is refused for every type.
  private matches(this: Mut<this>, p: TypeNode, t: Type, found: Map<string, Type>): boolean {
    if (inferNames(p).size === 0) return this.conforms(t, this.comparable(this.resolveType(p), p), p);
    const r = this.recOf(t);
    if (r?.kind === "param" && r.concrete) return this.matches(p, r.concrete, found);
    if (p.kind === "infer") {
      if (p.constraint && !this.conforms(t, this.comparable(this.resolveType(p.constraint), p.constraint), p.constraint)) return false;
      const prior = found.get(p.name);
      found.set(p.name, prior ? this.typing.unionType([prior, t]) : t);
      return true;
    }
    if (p.kind === "array" || (p.kind === "ref" && p.name === "Array" && p.args.length === 1)) {
      return r?.kind === "array" && this.matches(p.kind === "array" ? p.element : p.args[0]!, r.element, found);
    }
    if (p.kind === "ref" && p.name === "Promise" && p.args.length === 1) {
      const gives = this.typing.promiseElement(t) ?? (r?.kind === "future" ? r.gives : undefined);
      return gives !== undefined && this.matches(p.args[0]!, gives, found);
    }
    // `Option<infer U>` is `U | null`: the empty value matches with nothing for U, anything else is U.
    if (p.kind === "ref" && p.name === "Option" && p.args.length === 1) {
      if (t === "null") return this.matches(p.args[0]!, "never", found);
      return this.matches(p.args[0]!, this.typing.withoutNull(t), found);
    }
    if (p.kind === "ref" && (p.name === "Ref" || p.name === "Mut") && p.args.length === 1) {
      return r?.kind === "ref" && r.mutable === (p.name === "Mut") && this.matches(p.args[0]!, r.to, found);
    }
    if (p.kind === "ref") {
      const args = r?.kind === "class" && r.generic?.name === p.name ? r.generic.args : undefined;
      return args !== undefined && args.length === p.args.length && p.args.every((a, i) => this.matches(a, args[i]!, found));
    }
    if (p.kind === "function") {
      const [rest] = p.params;
      const any = p.params.length === 1 && rest!.rest && rest!.type?.kind === "array" && rest!.type.element.kind === "ref" && ["any", "unknown"].includes(rest!.type.element.name);
      const spread = p.params.find((q) => q.rest);
      if (!any && spread) throw unsupported("rest parameters other than '...args: any[]' in an 'infer' pattern, which need tuple types,", spread);
      if (r?.kind !== "function" && r?.kind !== "closure") return false;
      if (!any && p.params.length !== r.params.length) return false;
      // A parameter fits the other way round: the function must take what the pattern passes.
      const params = any || p.params.every((q, i) => (q.type && inferNames(q.type).size > 0 ? this.matches(q.type, r.params[i]!, found) : this.typing.fits(this.comparable(this.paramType(q), q), r.params[i]!)));
      return params && this.matches(p.returns, r.returns, found);
    }
    if (p.kind === "object") {
      for (const m of p.members) if (m.kind !== "property" || typeof m.name !== "string" || !m.type) throw unsupported("members other than properties in an 'infer' pattern", m);
      if (r?.kind !== "object" && r?.kind !== "class") return false;
      return p.members.every((m) => {
        const member = m as Extract<TypeMember, { kind: "property" }>;
        const f = this.typing.field(t as ClassType | ObjectType, member.name as string);
        if (!f || (f.access ?? "public") !== "public") return member.optional === true;
        return this.matches(member.type!, f.type, found);
      });
    }
    if (p.kind === "template" && r?.kind === "pattern") throw unsupported("'infer' patterns matched against template literal pattern types", p);
    // A template takes a string literal's text apart; each `infer` hole is its piece of text, as
    // a literal of the type its bound asks for.
    if (p.kind === "template") {
      if (r?.kind !== "literal" || typeof r.value !== "string" || r.owner) return false;
      const parts = splitTemplate(r.value, p.quasis);
      return parts !== undefined && p.types.every((hole, i) => {
        const text = parts[i]!;
        if (hole.kind !== "infer") {
          if (inferNames(hole).size > 0) throw unsupported("template literal holes holding 'infer' inside other types", hole);
          return this.typing.textFits(text, this.comparable(this.resolveType(hole), hole));
        }
        const bound = hole.constraint ? this.comparable(this.resolveType(hole.constraint), hole.constraint) : "string";
        const value = inferredText(this.typing, text, bound);
        if (value === undefined) return false;
        const prior = found.get(hole.name);
        found.set(hole.name, prior ? this.typing.unionType([prior, value]) : value);
        return true;
      });
    }
    throw unsupported(p.kind === "union" ? "unions holding 'infer'" : `${TYPE_FORMS[p.kind as keyof typeof TYPE_FORMS] ?? "these types"} holding 'infer'`, p);
  }

  private member(this: Mut<this>, m: TypeMember): Field {
    if (m.kind !== "property") throw unsupported(MEMBER_FORMS[m.kind], m);
    if (typeof m.name !== "string") throw unsupported("computed property names", m.name);
    if (!m.type) throw new CompileError(`property '${m.name}' implicitly has an 'any' type; add a type annotation`, m.start, m.end);
    // An object may leave out an optional property, which is then empty; one spelled
    // `T | undefined` may be left out too, and printing and JSON leave it out while empty.
    const f: Field = m.optional ? this.typing.optionalField(m.name, this.unionMember(m.type)) : withoutUndefined(this.ids, m.type) ? { name: m.name, type: this.resolveType(m.type), optional: "undefined" } : { name: m.name, type: this.resolveType(m.type) };
    return { ...f, type: storable(this.typing, f.type, m), ...(m.readonly && { readonly: true }) };
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
function inferredText(typing: Typing, text: string, bound: Type): Type | undefined {
  const b = typeof bound === "string" ? undefined : typing.rec(bound);
  const members = b?.kind === "union" ? b.members : [bound];
  // A bound taking any string keeps the text as written, as TypeScript does.
  if (members.includes("string")) return typing.literalType(text);
  const candidates: Type[] = [];
  for (const m of members) {
    if (m === "i64" && typing.textFits(text, m)) candidates.push(typing.literalType(BigInt(text)));
    else if ((isInteger(m) || isFloat(m)) && typing.textFits(text, m)) candidates.push(m);
    else if (m === "boolean" && typing.textFits(text, m)) candidates.push(typing.literalType(text === "true"));
  }
  candidates.push(typing.literalType(text));
  return candidates.find((c) => typing.fits(c, bound));
}

// The names a type pattern declares with `infer`.
function inferNames(t: TypeNode): Set<string> {
  const names = new Set<string>();
  walk("typeNode", t, ({ of, node }) => {
    if (of !== "typeNode" || node.kind !== "infer") return;
    names.add(node.name);
    return false;
  });
  return names;
}

// A field both sides of `&` declare keeps its type, merging nested object types; other types
// conflict, since no value could have both. It is readonly only when both sides say so, as in
// TypeScript.
function merged(typing: Typing, a: ObjectType, b: ObjectType, from: Span, to: Span): ObjectType {
  const object = (t: Type) => {
    const r = typeof t === "string" ? undefined : typing.rec(t);
    return r?.kind === "object" ? (t as ObjectType) : undefined;
  };
  const fields = [...typing.rec(a).fields];
  for (const f of typing.rec(b).fields) {
    const i = fields.findIndex((g) => g.name === f.name);
    const g = fields[i];
    if (!g) {
      fields.push(f);
      continue;
    }
    const [x, y] = [object(g.type), object(f.type)];
    // A side where the field is optional gives way to one where it's required, as in
    // `Partial<T> & Pick<T, "id">`.
    const required = g.optional && !f.optional ? f : f.optional && !g.optional ? g : undefined;
    const other = required === f ? g : f;
    if (required && typing.fits(required.type, other.type)) {
      const { readonly: _, ...kept } = required;
      fields[i] = { ...kept, ...(g.readonly && f.readonly && { readonly: true }) };
      continue;
    }
    if (g.type !== f.type && !(x && y)) {
      throw new CompileError(`property '${f.name}' has type '${typing.show(g.type)}' on one side of '&' and '${typing.show(f.type)}' on the other`, from.start, to.end);
    }
    const type = x && y ? merged(typing, x, y, from, to) : f.type;
    fields[i] = { name: f.name, type, ...(g.readonly && f.readonly && { readonly: true }), ...(g.optional && f.optional && { optional: f.optional }) };
  }
  return typing.objectType(fields);
}

// What each other kind of type is called when it can't be a side of `&`.
const SIDE_FORMS = { pattern: "template literal types", class: "classes", param: "type parameters", union: "unions", ref: "references", closure: "functions", function: "function types", array: "arrays", fixed: "fixed arrays", map: "maps and sets", variant: "enum members", generator: "generators", pointer: "raw pointers", future: "promises", handle: "join handles", interior: "atomics, locks and cells", shared: "shared values", block: "semaphores and channels", dyn: "Dyn values", regex: "regexes", recursive: "types that hold themselves" };

const I64_MAX = (1n << 63n) - 1n;

// A closure inferred for a type parameter is compiled as its own type, so where the body holds
// that parameter in a type argument it would need boxing the caller never did; refused there.
export function unboxedClosure(typing: Typing, t: Type, at: Span) {
  if (typeof t === "string") return;
  const p = typing.rec(t);
  if (p.kind !== "param" || p.concrete === undefined) return;
  const lowered = typing.lower(t);
  if (typeof lowered === "string") return;
  const c = typing.rec(lowered);
  if ((c.kind !== "closure" && c.kind !== "function") || c.generic) return;
  throw new CompileError(`'${p.name}' is a closure's own type here, which a type argument can't hold; write '${p.name}' where it is called, as in '<${c.name}>', or name it in a type argument of the signature, as in 'Box<${p.name}>'`, at.start, at.end);
}

// An `Atomic<T>`, `Lock<T>` or `Cell<T>` holding a T it can hold: an Atomic, an integer or a
// boolean, which the processor changes in one step.
export function interior(typing: Typing, which: InteriorRecord["which"], given: Type, at: Span): InteriorType {
  unboxedClosure(typing, given, at);
  const of = typing.heldArgument(given);
  const held = typing.lower(of);
  if (which === "Atomic" && isInteger(held) && INTEGERS[held].bits === 128) {
    throw new CompileError(`'Atomic' holds integers of up to 64 bits, not '${typing.show(of)}', which not every processor changes in one step; use a 'Lock'`, at.start, at.end);
  }
  if (which === "Atomic" && held !== "boolean" && !isInteger(held) && !(typeof held !== "string" && typing.rec(held).kind === "param")) {
    throw new CompileError(`'Atomic' holds an integer or a boolean, not '${typing.show(of)}'; use a 'Lock' for other values`, at.start, at.end);
  }
  if (typing.holdsRef(of)) throw new CompileError(`'${which}' can't hold a reference yet ('${typing.show(of)}')`, at.start, at.end);
  // Its methods take and give its value as lowered, which would let a plain string in.
  if (typing.holdsPattern(of)) throw unsupported(`template literal pattern types in '${which}' values`, at);
  abstractless(typing, of, `'${which}'`, at);
  return typing.interiorType(which, of);
}

// What only describes values, an interface (a written `Promise<T>` or `Generator<T>` is one) or a
// function type, can't be held where its value is laid out once for every use, as a channel, a
// shared value and a lock hold theirs.
function abstractless(typing: Typing, of: Type, holder: string, at: Span) {
  let found: Type | undefined;
  typing.holdsPart(typing.lower(of), (u) => typeof u !== "string" && ["interface", "function"].includes(typing.rec(u).kind) && (found = u) !== undefined);
  if (found) throw new CompileError(`${holder} can't hold a '${typing.show(found)}' yet: name a concrete type`, at.start, at.end);
}

// A `shared<T>` holding a T every thread may use at once: nothing in it borrows, points
// unchecked, or changes without a lock.
export function shareable(typing: Typing, given: Type, at: Span): SharedType {
  const kindOf = (t: Type | undefined) => (t === undefined || typeof t === "string" ? undefined : typing.rec(t).kind);
  unboxedClosure(typing, given, at);
  const of = typing.heldArgument(given);
  const held = typing.lower(of);
  abstractless(typing, of, "a 'shared' value", at);
  let blocker: Type | undefined;
  typing.holdsPart(held, (u) => {
    if (!unlocked(typing, u)) return false;
    blocker = u;
    return true;
  });
  if (typing.holdsHandle(held)) throw new CompileError("a 'shared' value can't hold a JoinHandle: every clone could await it, and a task's result can be awaited in one place only", at.start, at.end);
  if (blocker) {
    const why = kindOf(blocker) === "interior" ? "changes without a lock; use an 'Atomic' or a 'Lock' instead" : kindOf(blocker) === "pointer" ? "is a raw pointer no thread can vouch for" : "borrows from one place, which other threads can't keep alive";
    throw new CompileError(`a 'shared' value is used from many threads at once, so it can't hold a '${typing.show(blocker)}', which ${why}`, at.start, at.end);
  }
  return typing.sharedType(of);
}

// A `Channel<T>` carrying values from one task to another: nothing in them borrows, points
// unchecked, or changes without a lock.
export function channel(typing: Typing, given: Type, at: Span): BlockType {
  const kindOf = (t: Type | undefined) => (t === undefined || typeof t === "string" ? undefined : typing.rec(t).kind);
  unboxedClosure(typing, given, at);
  const of = typing.heldArgument(given);
  const held = typing.lower(of);
  const h = typeof held === "string" ? undefined : typing.rec(held);
  if (h?.kind === "union" && h.members.includes("null") || held === "null") {
    throw new CompileError(`a 'Channel' can't carry '${typing.show(held)}': 'receive' gives null once the channel is closed, so a null sent through it would look the same; wrap it, as in 'Channel<{ value: ${typing.show(held)} }>'`, at.start, at.end);
  }
  abstractless(typing, of, "a 'Channel'", at);
  if (typing.holdsPattern(of)) throw unsupported("template literal pattern types in channels", at);
  let blocker: Type | undefined;
  typing.holdsPart(typing.lower(of), (u) => {
    if (!unlocked(typing, u)) return false;
    blocker = u;
    return true;
  });
  if (blocker) throw new CompileError(`a 'Channel' carries values to other tasks, so it can't carry a '${typing.show(blocker)}', which ${kindOf(blocker) === "interior" ? "changes without a lock" : kindOf(blocker) === "pointer" ? "is a raw pointer no thread can vouch for" : "borrows from where it was made"}`, at.start, at.end);
  return typing.blockType("Channel", of);
}

// Whether a part of a value can't cross to another thread: a reference, a raw pointer or a Cell.
function unlocked(typing: Typing, u: Type): boolean {
  if (typeof u === "string") return false;
  const r = typing.rec(u);
  return r.kind === "ref" || r.kind === "pointer" || (r.kind === "interior" && r.which === "Cell");
}

// A key a Map or a Set hashes: a string or a sized integer, or a union of literals of one of
// them, such as an enum's members. A type parameter is checked again in each instance.
function keyable(typing: Typing, t: Type): boolean {
  const lowered = typing.lower(t);
  // A key is hashed as 64 bits, which a 128-bit integer doesn't fit.
  if (lowered === "string" || (isInteger(lowered) && INTEGERS[lowered].bits <= 64)) return true;
  if (typeof lowered === "string") return false;
  const k = typing.rec(lowered);
  if (k.kind === "param") return !k.concrete;
  if (k.kind === "literal") return typeof k.value !== "boolean";
  if (k.kind !== "union") return false;
  const bases = new Set(k.members.map((m) => {
    const r = typeof m === "string" ? undefined : typing.rec(m);
    return r?.kind === "literal" ? typeof r.value : "";
  }));
  return bases.size === 1 && !bases.has("") && !bases.has("boolean");
}

// A `Map<K, V>`, or a `Set<K>` when `set`: keys it can hash, and values it can own.
export function collection(typing: Typing, key: Type, value: Type, set: boolean, at: Span): MapType {
  const what = set ? "a 'Set'" : "a 'Map'";
  if (!keyable(typing, key)) throw new CompileError(`${what} ${set ? "holds" : "is keyed by"} strings or integers, or unions of their literals, not '${typing.show(key)}'; objects as keys aren't supported yet`, at.start, at.end);
  if (typing.holdsRef(value)) throw unsupported("maps of references", at);
  const lowered = typing.lower(value);
  const v = typeof lowered === "string" ? undefined : typing.rec(lowered);
  if ((v?.kind === "closure" || v?.kind === "function") && v.generic) throw unsupported("maps of generic functions", at);
  if (v?.kind === "interface") throw new CompileError(`a 'Map' can't hold the interface type '${v.name}' directly, since its values may each be a different type; use 'Dyn<${v.name}>'`, at.start, at.end);
  unboxedClosure(typing, value, at);
  return typing.mapType(key, typing.stored(typing.heldArgument(value)), set);
}

const BUILT_IN_TYPES = new Set(["Map", "Set", ...Object.keys(INTEGERS), "f32", "f64", "boolean", "void", "number", "string", "bigint", "Ref", "Mut", "Lifetime", "Option", "Generator", "AsyncGenerator", "Promise", "JoinHandle", "Ptr", "MutPtr", "Atomic", "Lock", "Cell", "shared", "Semaphore", "Permit", "Channel", "AbortController", "AbortSignal", "TcpListener", "TcpStream", "JsValue", "Dyn", "RegExp", "null", "undefined"]);

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

