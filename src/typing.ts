import type { CompileError } from "./diag.ts";
import type { Expr, Param, TypeNode, TypeParam } from "./parser.ts";
import { NodeMap, type Id } from "./nodes.ts";
import type { RustClass } from "./rust.ts";

// The checker's types: a primitive's name, or the id of a record in its program's arena, read
// through `rec`. Object types are interned, so two types are structurally identical, the same
// fields with the same types in any order, exactly when they are the same id.

// A class member that isn't public is reachable only from inside its class, and never
// counts toward a structural fit, as in TypeScript.
export type Access = "public" | "private" | "protected";

/** @throws {CompileError} */
export type TypePred = (t: ClassType | VariantType) => boolean;

// A readonly field can't be written after construction, at any depth.
// `optional` marks a field written `name?: T`, whose type holds `null` for the value left out:
// "added" when `?` added it, "held" when T already held it, so `Required` removes only the first.
// "undefined" marks a field spelled `T | undefined`, which may be left out like an optional one,
// and which printing and JSON leave out while it is empty.
export type Field = { name: string; type: Type; access?: Access; readonly?: boolean; optional?: "added" | "held" | "undefined" };

export function copyField(f: Ref<Field>): Field {
  let out: Field = { name: f.name, type: f.type };
  if (f.access !== undefined) out.access = f.access;
  if (f.readonly !== undefined) out.readonly = f.readonly;
  if (f.optional !== undefined) out.optional = f.optional;
  return out;
}

// Fields are sorted by name, which is also their order in memory.
// A tuple is an object whose fields are its positions, `0`, `1` and on, marked `tuple`.
// A regex match is a tuple of its captures with `index`, `input` and `groups` beside them.
// A tuple with optional elements has `required`, the count before them; each optional one holds
// `T | null`. A tuple ending in `...T[]` has `rest`, T, and holds those elements as an array in
// its field `...`.
// A tuple and a match also link `shape`, the object of their fields, and hold copies of its fields.
export type ObjectRecord = { kind: "object"; fields: Field[]; tuple?: true; match?: true; required?: usize; rest?: Type; shape?: ObjectType };
export type ObjectType = Brand<usize, "object">;

// A class is nominal: one per declaration, so `===` is identity. Its own fields are in
// declaration order, filled in once resolved, and follow the base it embeds in memory.
// An instance of a generic class also records the class it came from and its type arguments.
// `rust`: the Rust type a class a Rust module declares stands for. An abstract class only ever
// exists embedded in a concrete one, so it is never a value's type.
export type ClassRecord = { kind: "class"; name: string; fields: Field[]; base?: ClassType; generic?: { name: string; args: Type[] }; rust?: RustClass; abstract?: true };
export type ClassType = Brand<usize, "class">;

// An interface is a trait: fields and method signatures that any value with those members
// satisfies. It describes values but is never one, so it never reaches codegen. Its members
// are filled in once resolved.
// An interface's method; `mutable` and `owned` when it declares `this: Mut<this>` or
// `this: Own<this>`, which a call through a Dyn must allow for.
// A generic method, `map<U>(f: (x: T) => U): U`, keeps its type parameters' names and the node it
// was written as, as a generic function type does, each call resolving it.
// `optional`: which parameters are written with `?`, kept for JS, which tells left out from null.
// `throws`: what a stored callable's call may throw.
// `omittable`: declared `m?()`, so a type satisfying the interface may leave it out.
export type Method = { name: string; params: Type[]; returns: Type; throws?: Type; mutable?: boolean; owned?: boolean; generic?: Family; optional?: boolean[]; omittable?: true };
// A generic interface's instance knows the interface and the type arguments it was made from.
export type InterfaceRecord = { kind: "interface"; name: string; fields: Field[]; methods: Method[]; generic?: { name: string; args: Type[] } };
export type InterfaceType = Brand<usize, "interface">;

// A type parameter: it stands for any type satisfying its bound, and offers only the bound's
// fields. At the definition it stands for nothing in particular. In an instance it also holds
// the concrete type it stands for, so the instance checks exactly as the definition did while
// codegen lays the value out as its concrete type; `lower` removes it before codegen. A
// parameter bounded by a union, primitive, literal or brand stands at its definition for that
// whole bound, so the definition checks as TypeScript's does against the constraint, and each
// instance again with its own argument.
export type ParamRecord = { kind: "param"; name: string; bound: Bound | undefined; fields: Field[]; concrete?: Type; within?: true };
export type ParamType = Brand<usize, "param">;

// A literal type has one value, known at compile time, so on its own it takes no space: it
// has no fields. An integer or boolean literal fits its base type; a string literal has none yet.
// An enum's member is a literal that knows its enum, so a plain literal is never one.
export type LiteralRecord = {
  kind: "literal"; value: string | bigint | boolean; fields: Field[];
  // For an enum's member: the enum, unique to its declaration, and the enum's own type.
  owner?: { enum: string; member: string; id: usize; of?: Type };
};
export type LiteralType = Brand<usize, "literal">;

// A union holds a value of one of its members: a tag naming which, then that member's value.
// It has no fields; reaching into one takes narrowing to a member first.
export type UnionRecord = { kind: "union"; members: Type[]; fields: Field[]; name?: string; unknown?: true };
export type UnionType = Brand<usize, "union">;

// `unknown`: a value of any type the program stores in one. While checking, nothing can be done
// with it but narrow it; once every body is checked, `closeUnknown` makes it a union over every
// type that went in, marked `unknown`, so narrowing it is a check of its tag. It moves, whatever
// it holds, since what it holds isn't known where it is checked.
export type UnknownRecord = { kind: "unknown"; name: string; fields: Field[] };
export type UnknownType = Brand<usize, "unknown">;

// A borrow of a value that lives elsewhere: `Ref<T>` shared, `Mut<T>` mutable. It is a pointer
// to the value, reads through to it, and copies like a pointer. A written lifetime names the
// function's lifetime parameter it lives for; it is checked, then erased.
export type RefRecord = { kind: "ref"; to: Type; mutable: boolean; fields: Field[]; life?: string };
export type RefType = Brand<usize, "ref">;

// A member of a data-carrying enum: a nominal value holding positional fields named `0`, `1`,
// ..., laid out as an object's. One per enum instance and member, so `===` is identity. A
// generic enum's variant knows the enum's type arguments, to be made again from lowered ones.
export type VariantRecord = {
  kind: "variant"; name: string; member: string; enum: string; fields: Field[]; args: Type[];
  // The enum it belongs to, a union of its variants, once the enum is made.
  of?: Type;
};
export type VariantType = Brand<usize, "variant">;

// An owned array of elements of one type, growable like Rust's Vec. One per element type, so
// `===` is identity. It has no fields; its length and elements are reached by name and index.
// A typed array, such as `Uint8Array`, is one of its sized element tagged with its name, which
// lowering drops, so it is laid out as the plain array and the two fit each other.
export type ArrayRecord = { kind: "array"; element: Type; fields: Field[]; typed?: TypedName };
export type ArrayType = Brand<usize, "array">;

// `FixedArray<T, N>`: exactly `size` elements stored inline, laid out as `[size x T]`; interned,
// so `===` is identity.
export type FixedRecord = { kind: "fixed"; element: Type; size: usize; fields: Field[] };
export type FixedType = Brand<usize, "fixed">;
// `Map<K, V>` and `Set<T>` (a Set's value is `void`): a pointer to an owned hash table in the
// runtime, its entries kept in insertion order. A dictionary, `{ [k: string]: V }`, is a Map with
// string keys that the program sees as an object: no methods, its keys read as properties.
export type MapRecord = { kind: "map"; key: Type; value: Type; set: boolean; dict?: true; fields: Field[] };
export type MapType = Brand<usize, "map">;

// A closure: an arrow function and what it captures. Each arrow, in each instance of the body
// it is written in, is its own type, so `===` is identity. Its value is its captures, laid out
// as its fields, which are never read by name.
// A closure that moves a captured value out of itself can run only once; `once` names one. A
// closure made in a generic body's definition check is never compiled, so it isn't concrete.
// A generic function used as a value, `generic` naming it, is a closure capturing nothing whose
// calls each instantiate that function, as calls of it by name do.
// `throws` is what a call of it may throw; an async arrow's error is its future's instead.
export type ClosureRecord = { kind: "closure"; name: string; params: Type[]; returns: Type; throws?: Type; fields: Field[]; once?: string; concrete: boolean; generic?: string };
export type ClosureType = Brand<usize, "closure">;

// A function type: the signature a closure must have to be passed where it is declared. Like an
// interface, it describes values without being one, so it never reaches codegen.
// A generic one, `<T>(x: T) => T`, is a family: `generic` holds its type parameters' names and
// the node it was written as, each call resolving it for that call's types.
// The type parameters around it, `scope`, are those it was written among; `own` are its type
// parameters' placeholders, in order, for comparing it with another.
export type FamilyNode = { typeParams: TypeParam[]; params: Param[]; returns: TypeNode; throws?: TypeNode };
export type Family = { names: string[]; node: FamilyNode; scope: Map<string, Type>; own: Type[] };
export type FunctionRecord = { kind: "function"; name: string; names: string[]; params: Type[]; returns: Type; throws?: Type; fields: Field[]; generic?: Family };
export type FunctionType = Brand<usize, "function">;

// What a type parameter may be bounded by.
export type Bound = ObjectType | InterfaceType | FunctionType | RegexType;

// The sized numbers. `isize` and `usize` are 64 bits on every target Fish supports.
export type Integer = "i8" | "i16" | "i32" | "i64" | "i128" | "isize" | "u8" | "u16" | "u32" | "u64" | "u128" | "usize";
export type Numeric = Integer | "f32" | "f64";

export const INTEGERS: Record<Integer, { bits: usize; signed: boolean }> = {
  i8: { bits: 8, signed: true }, i16: { bits: 16, signed: true }, i32: { bits: 32, signed: true },
  i64: { bits: 64, signed: true }, i128: { bits: 128, signed: true }, isize: { bits: 64, signed: true },
  u8: { bits: 8, signed: false }, u16: { bits: 16, signed: false }, u32: { bits: 32, signed: false },
  u64: { bits: 64, signed: false }, u128: { bits: 128, signed: false }, usize: { bits: 64, signed: false },
};
const INTEGER_MAP = new Map<string, { bits: usize; signed: boolean }>([
  ["i8", { bits: 8, signed: true }], ["i16", { bits: 16, signed: true }], ["i32", { bits: 32, signed: true }],
  ["i64", { bits: 64, signed: true }], ["i128", { bits: 128, signed: true }], ["isize", { bits: 64, signed: true }],
  ["u8", { bits: 8, signed: false }], ["u16", { bits: 16, signed: false }], ["u32", { bits: 32, signed: false }],
  ["u64", { bits: 64, signed: false }], ["u128", { bits: 128, signed: false }], ["usize", { bits: 64, signed: false }],
]);
export const integerInfo = (t: Integer): { bits: usize; signed: boolean } => INTEGER_MAP.get(t)!;

// JavaScript's typed arrays, by the element each holds; an ArrayBuffer is its bytes.
export const TYPED_ARRAYS = { Uint8Array: "u8", Int8Array: "i8", Uint16Array: "u16", Int16Array: "i16", Uint32Array: "u32", Int32Array: "i32", Float32Array: "f32", Float64Array: "f64", ArrayBuffer: "u8" } as const;
// TYPED_ARRAYS' names, written out since reading an object's keys needs a value to read them from.
const TYPED_ARRAY_KEYS: (keyof typeof TYPED_ARRAYS)[] = ["Uint8Array", "Int8Array", "Uint16Array", "Int16Array", "Uint32Array", "Int32Array", "Float32Array", "Float64Array", "ArrayBuffer"];
export const TYPED_ARRAY_NAMES = new Set<string>([...TYPED_ARRAY_KEYS]);
const TYPED_ARRAY_MAP = new Map<string, Numeric>([
  ["Uint8Array", "u8"], ["Int8Array", "i8"], ["Uint16Array", "u16"], ["Int16Array", "i16"],
  ["Uint32Array", "u32"], ["Int32Array", "i32"], ["Float32Array", "f32"], ["Float64Array", "f64"], ["ArrayBuffer", "u8"],
]);
export const typedElement = (name: TypedName): Numeric => TYPED_ARRAY_MAP.get(name)!;
// Written out rather than read from TYPED_ARRAYS, since a class's fields name it before Fish has
// worked out the constant's type.
export type TypedName = "Uint8Array" | "Int8Array" | "Uint16Array" | "Int16Array" | "Uint32Array" | "Int32Array" | "Float32Array" | "Float64Array" | "ArrayBuffer";
export const isTypedName = (name: string): name is TypedName => TYPED_ARRAY_MAP.has(name);
// The bytes each element of a typed array takes, its BYTES_PER_ELEMENT.
export const typedSize = (name: TypedName): usize => {
  const e = typedElement(name);
  return e === "f32" ? 4 : e === "f64" ? 8 : integerInfo(e).bits / 8;
};

export const isInteger = (t: Type): t is Integer => typeof t === "string" && INTEGER_MAP.has(t);

// A template literal type with open holes, like `${number}px`: the strings that match it. Its
// values are strings, so it is a checker type only, which `lower` makes `string`.
export type PatternRecord = { kind: "pattern"; quasis: string[]; holes: Hole[]; fields: Field[] };
export type PatternType = Brand<usize, "pattern">;
export type Hole = "string" | Numeric;

// The powers of each base unit a unit's text writes, as `"kg*m/s^2"` does: names with integer
// powers, multiplied with `*`, over at most one `/`. Undefined for text of another form.
export function unitPowers(text: string): Record<string, i64> | undefined {
  const parts = text.split("/");
  if (parts.length > 2) return undefined;
  const top = parts[0]!;
  let powers: Record<string, i64> = {};
  const add = (part: string, sign: i64): boolean => {
    if (part.trim() === "1") return true;
    for (const factor of part.split("*")) {
      const m = /^\s*([A-Za-z_]\w*)\s*(?:\^\s*(-?\d+))?\s*$/.exec(factor);
      if (m === null) return false;
      powers[m[1]!] = (powers[m[1]!] ?? 0) + sign * (Number(m[2] ?? "1")! as i64);
    }
    return true;
  };
  return add(top, 1) && (parts.length < 2 || add(parts[1]!, -1)) ? powers : undefined;
}

// A unit's text in one form for each unit: names in order, positive powers over negative ones.
export function unitText(powers: Ref<Record<string, i64>>): string {
  let names = Object.keys(powers);
  names.sort();
  const part = (ns: string[]) => ns.map((n) => (Math.abs(powers[n]!) === 1 ? n : `${n}^${Math.abs(powers[n]!)}`)).join("*");
  const top = names.filter((n) => powers[n]! > 0);
  const bottom = names.filter((n) => powers[n]! < 0);
  return `${top.length > 0 ? part(top) : "1"}${bottom.length > 0 ? `/${part(bottom)}` : ""}`;
}

// A brand: the values of a primitive `base` under a `tag`, as `Brand<usize, "UserId">` writes
// it, laid out as its base, which `lower` makes it. A brand fits its base and a family brand
// whose tag its tag fits; its base fits it only through `as`, unless it is `loose`, as
// TypeScript's `B & { readonly f?: "X" }` is. `field` is that idiom's property, kept for display.
// A unit is a numeric brand whose `unit` maps each base unit to its power, which `*` and `/`
// combine.
export type BrandRecord = { kind: "brand"; base: Type; tag: Type; loose?: true; field?: string; unit?: Record<string, i64>; fields: Field[] };
export type BrandType = Brand<usize, "brand">;

// The texts a template's holes take in `s`, as TypeScript matches: each hole but the last takes
// text up to the next piece's first occurrence (one character before another hole), the last
// takes what is left before the final piece.
export function splitTemplate(s: string, quasis: Ref<string[]>): string[] | undefined {
  const last = (quasis.length - 1) as i64;
  const head = quasis[0]!;
  const tail = quasis[last as usize]!;
  if (!s.startsWith(head) || !s.endsWith(tail) || s.length < head.length + tail.length) return undefined;
  const end = (s.length - tail.length) as i64;
  let parts: string[] = [];
  let pos = head.length as i64;
  for (let i: i64 = 1; i < last; i++) {
    const next = quasis[i as usize]!;
    const at = next === "" ? (pos < end ? pos + 1 : -1) : s.indexOf(next, pos);
    if (at < 0 || at + (next.length as i64) > end) return undefined;
    parts.push(s.slice(pos, at));
    pos = at + (next.length as i64);
  }
  parts.push(s.slice(pos, end));
  return parts;
}

export const isFloat = (t: Type): t is "f32" | "f64" => t === "f32" || t === "f64";
export const isNumeric = (t: Type): t is Numeric => isInteger(t) || isFloat(t);

// A `!` on a value that can't be empty is that value itself in every stage. The checker marks
// it where it first types the `!`, which for a generic body is its definition, so every
// instance agrees: as in TypeScript, `x!` on a `T` never unwraps, whatever `T` stands for.
export type Bang = { redundant?: boolean };

export function redundantBang(e: Ref<Expr>): boolean {
  return e.kind === "nonNull" && e.redundant === true;
}

// An expression with its redundant `!`s taken off.
export function bare(e: Expr): Expr {
  if (e.kind === "nonNull" && redundantBang(e)) return bare(e.expr);
  return e;
}

// A tuple's element types, in order, from its fields.
export function tupleElements(fields: Field[]): Type[] {
  return fields.filter((f) => /^\d+$/.test(f.name)).toSorted((a, b) => Number(a.name)! - Number(b.name)!).map((f) => f.type);
}

// The values an integer type holds.
export function range(t: Integer): [bigint, bigint] {
  const { bits, signed } = integerInfo(t);
  return signed ? [-(1n << BigInt(bits - 1)), (1n << BigInt(bits - 1)) - 1n] : [0n, (1n << BigInt(bits)) - 1n];
}

// `null` is the empty Option: `T | null`, `T | undefined` and `x?: T` are all a union holding
// it, which flattening keeps from nesting.
// `never` is the type of an expression that never finishes, like a throw expression; it fits
// anywhere, and a union drops it.
export type Type = Numeric | "boolean" | "void" | "null" | "never" | "string" | "bigint" | ObjectType | ClassType | InterfaceType | ParamType | LiteralType | PatternType | BrandType | UnionType | RefType | ClosureType | FunctionType | ArrayType | FixedType | MapType | VariantType | GeneratorType | PointerType | FutureType | HandleType | InteriorType | SharedType | BlockType | DynType | RegexType | RecursiveType | UnknownType;

// What a type's record holds.
export type TypeRecord = ObjectRecord | ClassRecord | InterfaceRecord | ParamRecord | LiteralRecord | PatternRecord | BrandRecord | UnionRecord | RefRecord | ClosureRecord | FunctionRecord | ArrayRecord | FixedRecord | MapRecord | VariantRecord | GeneratorRecord | PointerRecord | FutureRecord | HandleRecord | InteriorRecord | SharedRecord | BlockRecord | DynRecord | RegexRecord | RecursiveRecord | UnknownRecord;

// The record a type of `T` has, from its brand's tag: a type that isn't a primitive is its
// record's index in its program's arena, from 21 up, since 1 to 20 are the primitives' ids.
export type RecordOf<T> = T extends ObjectType ? ObjectRecord
  : T extends ClassType ? ClassRecord
  : T extends InterfaceType ? InterfaceRecord
  : T extends ParamType ? ParamRecord
  : T extends LiteralType ? LiteralRecord
  : T extends PatternType ? PatternRecord
  : T extends BrandType ? BrandRecord
  : T extends UnionType ? UnionRecord
  : T extends RefType ? RefRecord
  : T extends ClosureType ? ClosureRecord
  : T extends FunctionType ? FunctionRecord
  : T extends ArrayType ? ArrayRecord
  : T extends FixedType ? FixedRecord
  : T extends MapType ? MapRecord
  : T extends VariantType ? VariantRecord
  : T extends GeneratorType ? GeneratorRecord
  : T extends PointerType ? PointerRecord
  : T extends FutureType ? FutureRecord
  : T extends HandleType ? HandleRecord
  : T extends InteriorType ? InteriorRecord
  : T extends SharedType ? SharedRecord
  : T extends BlockType ? BlockRecord
  : T extends DynType ? DynRecord
  : T extends RegexType ? RegexRecord
  : T extends RecursiveType ? RecursiveRecord
  : T extends UnknownType ? UnknownRecord
  : never;

// The name a `[Symbol.iterator]` method takes, which no identifier or member read can spell.
export const ITERATOR = "[Symbol.iterator]";

// The field a class extending Map or Set holds its collection in: a private name no source can
// spell, so printing and JSON leave it out.
export const EMBEDDED = "#embedded base";

// A Map's and a Set's methods.
export const MAP_METHODS = new Set(["set", "get", "has", "delete", "clear", "update", "keys", "values", "entries", "forEach"]);
export const SET_METHODS = new Set(["add", "has", "delete", "clear", "keys", "values", "entries", "forEach"]);

// The ids the primitives key tables by, below every type record's.
const PRIMITIVES: Extract<Type, string>[] = ["i8", "i16", "i32", "i64", "i128", "isize", "u8", "u16", "u32", "u64", "u128", "usize", "f32", "f64", "boolean", "void", "null", "never", "string", "bigint"];
const PRIMITIVE_IDS = new Map(PRIMITIVES.map((p, i): [string, usize] => [p, (i + 1) as usize]));

// The id a type keys a table by: a primitive's reserved one, or the type itself.
export function idOf(t: usize | string): usize {
  return typeof t === "string" ? PRIMITIVE_IDS.get(t)! : t;
}

const literalText = (v: string | bigint | boolean): string => (typeof v === "string" ? v : typeof v === "bigint" ? `${v}` : `${v}`);

// The type an id keys.
const typeAt = (id: usize): Type => (id <= PRIMITIVES.length ? PRIMITIVES[id - 1]! : (id as Exclude<Type, string>));

// A `Map` from types, keyed by their ids.
export class TypeMap<K extends Type, V> {
  private table = new Map<usize, V>();

  constructor(entries?: (readonly [K, V])[]) {
    if (entries !== undefined) {
      let a = entries!;
      while (a.length > 0) {
        const [type, value] = a.shift()!;
        this.set(type, value);
      }
    }
  }

  get size(): usize {
    return this.table.size;
  }

  get(type: K): V | undefined {
    return this.table.get(idOf(type));
  }

  has(type: K): boolean {
    return this.table.has(idOf(type));
  }

  set(this: Mut<this>, type: K, value: V): Mut<this> {
    this.table.set(idOf(type), value);
    return this;
  }

  delete(this: Mut<this>, type: K): boolean {
    return this.table.delete(idOf(type));
  }

  clear(this: Mut<this>): void {
    this.table.clear();
  }

  *keys(): IterableIterator<K> {
    for (const id of this.table.keys()) yield typeAt(id) as K;
  }

  *values(): IterableIterator<V> {
    for (const id of this.table.keys()) yield this.table.get(id)!;
  }

  *entries(): IterableIterator<[K, V]> {
    for (const id of this.table.keys()) yield [typeAt(id) as K, this.table.get(id)!];
  }

  [Symbol.iterator](): IterableIterator<[K, V]> {
    return this.entries();
  }

  forEach(each: (value: V, type: K) => void): void {
    for (const id of this.table.keys()) each(this.table.get(id)!, typeAt(id) as K);
  }
}

// A `Set` of types, keyed by their ids.
export class TypeSet<K extends Type> {
  private table = new Set<usize>();

  constructor(types?: K[]) {
    if (types !== undefined) {
      let a = types!;
      while (a.length > 0) this.add(a.shift()!);
    }
  }

  get size(): usize {
    return this.table.size;
  }

  has(type: K): boolean {
    return this.table.has(idOf(type));
  }

  add(this: Mut<this>, type: K): Mut<this> {
    this.table.add(idOf(type));
    return this;
  }

  delete(this: Mut<this>, type: K): boolean {
    return this.table.delete(idOf(type));
  }

  clear(this: Mut<this>): void {
    this.table.clear();
  }

  *values(): IterableIterator<K> {
    for (const id of this.table) yield typeAt(id) as K;
  }

  [Symbol.iterator](): IterableIterator<K> {
    return this.values();
  }

  forEach(each: (type: K) => void): void {
    for (const id of this.table) each(typeAt(id) as K);
  }
}

// `Atomic<T>`, `Lock<T>`, `RwLock<T>` and `Cell<T>`: a value changed through a shared reference,
// so a `const` or a `Ref` can still change what it holds. An Atomic and a Cell are laid out as
// what they hold, a Lock and an RwLock as a lock word, then what they hold.
export type InteriorRecord = { kind: "interior"; which: "Atomic" | "Lock" | "RwLock" | "Cell"; of: Type; fields: Field[] };
export type InteriorType = Brand<usize, "interior">;

// Whether an interior type is laid out as a lock word, then what it holds.
export const isLock = (r: Ref<InteriorRecord>) => r.which === "Lock" || r.which === "RwLock";

// `shared<T>`: a counted pointer to a block holding the count, a lock word and the value, so
// every clone is the same value, read and changed from any thread.
// `shared<T>` counts its owners atomically for every thread; `Rc<T>` counts them for one, and
// `Weak<T>` reaches an Rc's value without keeping it alive.
export type SharedRecord = { kind: "shared"; which: "shared" | "Rc" | "Weak"; of: Type; fields: Field[] };
export type SharedType = Brand<usize, "shared">;

// `Dyn<I>`: a value of any type implementing interface I, owned in a heap block, with a vtable
// of what that type does: drop it, clone it, and each of I's members.
// A stored callable written with other parameter names is its own DynType, `shown` as written,
// for the same interface and key, which `lower` gives.
export type DynRecord = { kind: "dyn"; of: InterfaceType; fields: Field[]; shown?: string };
export type DynType = Brand<usize, "dyn">;

// `Semaphore`, its `Permit` and `Channel<T>`: each a pointer to a counted block in the runtime,
// which tasks wait on without holding a thread. A Permit holds a count on its Semaphore. An
// `AbortController` and its `AbortSignal`s are handles to one block.
// A FileJob is a file read or write handed to the runtime's blocking pool.
// A JsValue is a value of the JS engine, which Fish holds without knowing its type.
// A FileDescriptor is an open file's descriptor, closed when its last count goes.
export type BlockRecord = { kind: "block"; which: "Semaphore" | "Permit" | "Channel" | "AbortController" | "AbortSignal" | "TcpListener" | "TcpStream" | "UnixListener" | "UnixStream" | "UdpSocket" | "FileJob" | "JsValue" | "FileDescriptor"; of: Type; fields: Field[] };
export type BlockType = Brand<usize, "block">;

// The futures a Semaphore's and a Channel's methods give, and a `sleep` given a signal, polled by
// the runtime: each frame holds its state, a count on the block (or a sleep's deadline), and for
// `send` the value going in. One given an AbortSignal ends with a count on it and whether it is
// waiting on it, and throws the `AbortError` it is given. `leafOf` names each one's method and
// what it carries.
export type Leaf = "acquire" | "send" | "receive" | "sleep" | "bind" | "connect" | "accept" | "read" | "write" | "sendTo" | "receiveFrom" | "udpConnect" | "readFile" | "writeFile" | "timerNext" | "jsAwait" | "next";

// A spawned task's `JoinHandle<T>`: what its future gives and may throw, awaited like it. A
// counted pointer to the task; dropping it detaches the task.
// `joined` marks what `handle.join()` gives: the same task, awaited so that its panic is thrown as
// the TaskPanic `panic` rather than panicking its awaiter.
export type HandleRecord = { kind: "handle"; gives: Type; throws?: Type; fields: Field[]; joined?: { base: HandleType; panic: Type } };
export type HandleType = Brand<usize, "handle">;

// An async function's future, a `Promise<T>`: what it gives once awaited, what it may throw,
// its parameters, which say what it borrows, and the frame its state lives in, as a
// generator's. Polled where it lives and never moved after its first poll. One per async
// instance, so `===` is nominal identity; it has no properties.
export type FutureRecord = { kind: "future"; name: string; gives: Type; throws?: Type; fields: Field[]; params: Field[]; frame: Field[]; concrete: boolean };
export type FutureType = Brand<usize, "future">;

// `sleep(ms)`'s future: its state, then the delay, then the deadline the runtime sets.
export const SLEEP = 21 as FutureType;

// A future awaiting several at once in its task, made for one `Promise.all` or `Promise.race`
// call: `all` gives each one's value as a tuple, `race` the first to settle's. Its frame is its
// state, then for each future the future, its value, and how far it got: 0 not yet polled, 1
// waiting, 2 done. A future giving nothing gives null here.
// Over an array of `Promise<T>` values, `array` is its type, and the frame holds the array, the
// values and a flag per future instead. `aggregate` is the AggregateError an `any` throws when
// every future fails.
export type Combined = { kind: "all" | "race" | "allSettled" | "any"; futures: (FutureType | HandleType | DynType)[]; array?: ArrayType; aggregate?: ClassType; at: { start: usize; end: usize } };

// `yieldNow()`'s future, which is pending once, then done.
export const YIELD_NOW = 22 as FutureType;

// A raw pointer, `Ptr<T>` or `MutPtr<T>`: an address the borrow checker doesn't follow, used
// only inside `unsafe`. It copies like a number and owns nothing.
export type PointerRecord = { kind: "pointer"; to: Type; mutable: boolean; fields: Field[] };
export type PointerType = Brand<usize, "pointer">;

// A regex: its pattern and flags, which fix what each capture may hold. Its value points at a
// compiled program that never changes, so it copies freely and needs no drop.
// `source` is how JavaScript shows the pattern; `pattern` what is matched, which differ only for
// a `new RegExp` whose string held a `/` or a line terminator.
export type RegexRecord = { kind: "regex"; source: string; pattern: string; flags: string; captures: { name: string | undefined; optional: boolean }[]; fields: Field[]; any?: true };
export type RegexType = Brand<usize, "regex">;

// The `RegExp` annotation: any regex. A parameter of it is an implicit type parameter, so each
// instance knows its regex; elsewhere it holds one whose pattern isn't known there.
export const ANY_REGEX = 23 as RegexType;

// Where a type leads back to itself, as `next` does in `type Node = { next: Node | null }`: a
// pointer to a block holding `of`, the type it stands for, which is set once that is made. It
// is that type everywhere but in its layout, and every walk over types stops at it.
// `args` are the alias's type arguments, so one made from type parameters is remade for what
// they stand for.
export type RecursiveRecord = { kind: "recursive"; name: string; args: Type[]; of: Type; fields: Field[] };
export type RecursiveType = Brand<usize, "recursive">;

// A generator: what it yields, its parameters, which say what it borrows, and the frame its
// state lives in, filled once the body is checked. It has no properties, so `fields` stays
// empty. One per generator instance, so `===` is nominal identity. An async one's `next()` gives
// a future, and its body may await between yields. `throws` is what advancing it may throw, and
// `sends` what `next(x)` gives the `yield` it resumes at.
export type GeneratorRecord = { kind: "generator"; name: string; yields: Type; fields: Field[]; params: Field[]; frame: Field[]; concrete: boolean; async?: boolean; throws?: Type; sends?: Type };
export type GeneratorType = Brand<usize, "generator">;

export const INTERIORS = new Set(["Atomic", "Lock", "RwLock", "Cell"]);

// A short name for what `description` describes, the same in every program that has it: six
// base-36 digits of its 64-bit FNV-1a hash over UTF-8. The hash is written here rather than taken
// from Bun so that a compiler built by Fish names instances exactly as this one does.
export function digest(description: string): string {
  let h = 0xcbf29ce484222325n;
  for (const b of new TextEncoder().encode(description)) h = ((h ^ BigInt(b)) * 0x100000001b3n) & 0xffffffffffffffffn;
  return h.toString(36).slice(-6);
}

// Why a generic function type can't be held where it is: as `where` it would be boxed, and a box
// holds one function, where a generic one is a family made one per call.
export function familyHeld(where: string): string {
  return `${where} can't hold a generic function type: that would box it in a Dyn, whose table holds one function, and a generic function is a family made one per call; give it one type, as '(x: i64) => i64', or take it as a parameter`;
}

// One program's types: the tables its types are interned in, so `===` is identity within it, and
// the operations over them. Each compilation makes its own, so no type of one meets another's.
export class Typing {
  // Every record of this program, keyed by its type id from 21 up: the module constants' first,
  // then those this program makes.
  private arena: Map<usize, TypeRecord> = new Map<usize, TypeRecord>([
    [21, { kind: "future", name: "sleep", gives: "void", fields: [], params: [], frame: [{ name: "state", type: "i32" }, { name: "deadline", type: "i64" }], concrete: true }],
    [22, { kind: "future", name: "yieldNow", gives: "void", fields: [], params: [], frame: [{ name: "state", type: "i32" }], concrete: true }],
    [23, { kind: "regex", source: "", pattern: "", flags: "", captures: [], fields: [], any: true }],
  ]);

  // The record a type that isn't a primitive stands for, which its changes are made through.
  rec<T extends Exclude<Type, string>>(t: T): RecordOf<T> {
    return this.arena.get(t as usize)! as RecordOf<T>;
  }

  // Updates the record of a type that isn't a primitive.
  setRec<T extends Exclude<Type, string>>(this: Mut<this>, t: T, record: RecordOf<T>): void {
    this.arena.set(t as usize, record);
    this.settled.clear();
  }

  // The record of a type that isn't a primitive, or undefined for a primitive or no type.
  recOf<T extends Type>(t: T | undefined): RecordOf<T> | undefined {
    return t === undefined || typeof t === "string" ? undefined : this.rec(t as Exclude<T, string>);
  }

  // Whether a hole of type `t` takes `text`: any text for a string, the text a number of that type
  // prints as for a number type, a literal's own text, or for a union, what any member takes.
  textFits(text: string, t: Type): boolean {
    if (t === "string") return true;
    if (t === "boolean") return text === "true" || text === "false";
    // A number's text must be what that number prints as, so `-0` and `01` aren't integers.
    if (isInteger(t)) {
      if (!/^-?(0|[1-9]\d*)$/.test(text) || text === "-0") return false;
      const { bits, signed } = integerInfo(t);
      const neg = text.startsWith("-");
      let n = 0n;
      for (let i: usize = neg ? 1 : 0; i < text.length; i++) n = n * 10n + BigInt(text.charCodeAt(i) - 48);
      if (neg) n = -n;
      return signed ? n >= -(1n << BigInt(bits - 1)) && n < 1n << BigInt(bits - 1) : n >= 0n && n < 1n << BigInt(bits);
    }
    // As TypeScript's `${number}`: any text JavaScript reads as a finite number.
    if (isFloat(t)) {
      if (text.trim() === "") return false;
      const num = Number(text);
      return num !== null && num - num === 0;
    }
    if (typeof t === "string") return false;
    const r = this.rec(t);
    if (r.kind === "literal") return r.owner === undefined && literalText(r.value) === text;
    if (r.kind === "union") return r.members.some((m) => this.textFits(text, m));
    if (r.kind === "pattern") {
      const parts = splitTemplate(text, r.quasis);
      return parts !== undefined && parts.every((p, i) => this.textFits(p, r.holes[i as usize]!));
    }
    return false;
  }

  // Whether a type is an Option: a union one of whose members is the empty value.
  isOption(t: Type): t is UnionType {
    const r = this.recOf(t);
    return r?.kind === "union" && r.members.includes("null");
  }

  // The reference a `Ref<T> | null` holds when it isn't empty.
  optionRef(t: Type | undefined): RefType | undefined {
    if (t === undefined || !this.isOption(t) || this.rec(t).members.length !== 2) return undefined;
    const ref = this.rec(t).members.find((m) => m !== "null")!;
    return this.recOf(ref)?.kind === "ref" ? (ref as RefType) : undefined;
  }

  // The shape a JS handle's declaration gives it, when it has one.
  jsShape(t: Type): InterfaceType | ObjectType | undefined {
    const r = this.recOf(t);
    if (r?.kind !== "block" || r.which !== "JsValue" || typeof r.of === "string") return undefined;
    const kind = this.rec(r.of).kind;
    return kind === "interface" || kind === "object" ? (r.of as InterfaceType | ObjectType) : undefined;
  }

  // A JsValue a program holds without knowing its type, not a package's handle of a known shape.
  isPlainJs(t: Type) {
    const r = this.recOf(t);
    return r?.kind === "block" && r.which === "JsValue" && r.of === "void";
  }

  // The same, or a reference to one.
  holdsPlainJs(t: Type) {
    const r = this.recOf(t);
    return this.isPlainJs(r?.kind === "ref" ? r.to : t);
  }

  private thrownBy(f: FutureType | HandleType | DynType): Type | undefined {
    const r = this.rec(f);
    return r.kind === "dyn" ? undefined : r.throws;
  }

  // The part of a type that keeps `===` from comparing its values, or undefined when every part
  // compares: primitives, strings and literals, and objects, tuples, arrays and unions of them. A
  // class compares through its `equals`, and a data enum when it derives Eq; `eq` says which do.
  /** @throws {CompileError} */
  unequal(t: Type, eq: TypePred): Type | undefined {
    let seen = new TypeSet<Type>();
    return this.unequalIn(t, eq, seen);
  }

  // Walked with a stack, in the order a recursive walk would take, so `eq` is called rather than
  // handed on, which would make another instance of this method for each closure handed on.
  /** @throws {CompileError} */
  private unequalIn(start: Type, eq: TypePred, seen: Mut<TypeSet<Type>>): Type | undefined {
    let stack: Type[] = [start];
    while (stack.length > 0) {
      const t = stack.pop()!;
      if (typeof t === "string" || seen.has(t)) continue;
      seen.add(t);
      const r = this.rec(t);
      let parts: Type[] = [];
      switch (r.kind) {
        case "brand":
        case "literal":
        case "pattern":
        case "pointer":
        // An unknown is compared only with primitives, which the comparison itself checks.
        case "unknown":
          break;
        case "ref":
          parts = [r.to];
          break;
        case "recursive":
          parts = [r.of];
          break;
        // An open type parameter is judged in each instance, where it is concrete.
        case "param":
          if (r.concrete !== undefined) parts = [r.concrete];
          break;
        case "union":
          parts = r.members.slice();
          break;
        case "array":
        case "fixed":
          parts = [r.element];
          break;
        case "object":
          if (r.match === true) return t;
          parts = r.fields.map((f) => f.type);
          break;
        case "class":
          if (!eq(t as ClassType)) return t;
          break;
        case "variant": {
          if (!eq(t as VariantType)) return t;
          const of = this.recOf(this.rec(t as VariantType).of);
          const members: Type[] = of?.kind === "union" ? of.members : [t];
          for (const v of members) {
            const w = this.recOf(v);
            if (w?.kind === "variant") for (const f of w.fields) parts.push(f.type);
          }
          break;
        }
        default:
          return t;
      }
      for (let i = parts.length; i > 0; i--) stack.push(parts[i - 1]!);
    }
    return undefined;
  }

  // The part of a type that `console.log` can't print as Node's util.inspect would, or undefined:
  // every value but functions, handles and other runtime objects prints, a type parameter in each
  // instance once it is concrete.
  uninspectable(t: Type): Type | undefined {
    let seen = new TypeSet<Type>();
    return this.uninspectableIn(t, seen);
  }

  private uninspectableIn(t: Type, seen: Mut<TypeSet<Type>>): Type | undefined {
    if (typeof t === "string") return t === "void" ? t : undefined;
    if (seen.has(t)) return undefined;
    seen.add(t);
    const r = this.rec(t);
    switch (r.kind) {
      case "brand":
        return undefined;
      case "literal":
      case "pattern":
        return undefined;
      case "ref":
        return this.uninspectableIn(r.to, seen);
      case "recursive":
        return this.uninspectableIn(r.of, seen);
      case "param":
        return r.concrete !== undefined ? this.uninspectableIn(r.concrete, seen) : undefined;
      case "union": {
        for (const m of r.members) {
          const p = this.uninspectableIn(m, seen);
          if (p !== undefined) return p;
        }
        return undefined;
      }
      // What an unknown holds prints, as nothing that doesn't goes in.
      case "unknown":
        return undefined;
      case "array":
      case "fixed":
        return this.uninspectableIn(r.element, seen);
      case "map": {
        const parts: Type[] = r.set ? [r.key] : [r.key, r.value];
        for (const p of parts) {
          const found = this.uninspectableIn(p, seen);
          if (found !== undefined) return found;
        }
        return undefined;
      }
      case "object": {
        if (r.match === true) return t;
        for (const f of r.fields) {
          const found = this.uninspectableIn(f.type, seen);
          if (found !== undefined) return found;
        }
        return undefined;
      }
      case "class": {
        // The prelude's Error prints its cause through what ErrorLike gives.
        if ((r.name === "Error" && r.generic === undefined) || r.generic?.name === "AggregateError") return r.generic !== undefined ? this.uninspectableIn(r.generic.args[0]!, seen) : undefined;
        // A JsError prints as an Error, the JS value it keeps left out.
        if (r.name === "JsError" && r.generic === undefined) return undefined;
        const base: Type[] = r.base !== undefined ? [r.base] : [];
        for (const p of [...base, ...r.fields.filter((f) => !f.name.startsWith("#")).map((f) => f.type)]) {
          const found = this.uninspectableIn(p, seen);
          if (found !== undefined) return found;
        }
        return undefined;
      }
      case "variant": {
        const of = this.recOf(r.of);
        const members: Type[] = of?.kind === "union" ? of.members : [t];
        for (const v of members) {
          const w = this.recOf(v);
          if (w?.kind !== "variant") continue;
          for (const f of w.fields) {
            const found = this.uninspectableIn(f.type, seen);
            if (found !== undefined) return found;
          }
        }
        return undefined;
      }
      default:
        return t;
    }
  }

  // The type a recursive type stands for, or the type itself.
  unfold(t: Type): Type {
    const r = this.recOf(t);
    return r?.kind === "recursive" ? r.of : t;
  }

  // An enum's member widens to its enum where TypeScript widens it: a `let`, a field, a type
  // argument or a property, since the place may later hold another member.
  widenEnum(t: Type): Type {
    const r = this.recOf(t);
    if (r?.kind === "variant" && r.of !== undefined) return r.of;
    return r?.kind === "literal" && r.owner !== undefined && r.owner.of !== undefined ? r.owner.of : t;
  }

  // A `let` holds its literal's whole type too, as in TypeScript: `let s = "a"` is a string.
  widenLet(t: Type): Type {
    const r = this.recOf(t);
    if (r?.kind === "literal" && r.owner === undefined && typeof r.value === "string") return "string";
    // A `let` may later hold another regex, so it holds any.
    if (r?.kind === "regex") return ANY_REGEX;
    return this.widenEnum(t);
  }

  // The type a literal's value belongs to, if Fish has it yet.
  baseOf(t: LiteralType): "i64" | "boolean" | "string" {
    const { value } = this.rec(t);
    return typeof value === "bigint" ? "i64" : typeof value === "boolean" ? "boolean" : "string";
  }

  // Primitives, literals, references, and unions of nothing else are copied; objects,
  // instances, interface values and type parameters move. A closure copies like what it holds. A mutable reference passed on is
  // lent again rather than moved, so it copies too.
  // Whether a type is the class `c`, or a class extending it: what `instanceof c` tests.
  isSubclass(t: Type, c: Type): boolean {
    let x: ClassType | undefined = this.recOf(t)?.kind === "class" ? (t as ClassType) : undefined;
    while (x !== undefined) {
      if (x === c) return true;
      x = this.rec(x).base;
    }
    return false;
  }

  isCopy(t: Type): boolean {
    if (typeof t === "string") return true;
    const r = this.rec(t);
    if (r.kind === "literal" || r.kind === "pattern" || r.kind === "brand" || r.kind === "ref" || r.kind === "pointer" || r.kind === "regex") return true;
    // A closure copies when what it captures does, and it changes nothing through it.
    if (r.kind === "closure") return r.fields.every((f) => this.isCopy(f.type) && !this.holdsMut(f.type));
    // A parameter of a generic function type holds a generic function value, which captures nothing.
    if (r.kind === "param" && r.bound !== undefined) {
      const bound = this.rec(r.bound);
      if (bound.kind === "function" && bound.generic !== undefined) return true;
    }
    // One bounded by a union or primitive copies when every value of its bound does, and in an
    // instance as its argument does.
    if (r.kind === "param" && r.concrete !== undefined && this.isCopy(r.concrete)) return true;
    // A fixed array copies when its elements do, as Rust's `[T; N]` does.
    if (r.kind === "fixed") return this.isCopy(r.element) && !this.holdsMut(r.element);
    // A tuple copies when everything in it does, as a union does.
    // A copy of a mutable reference would be a second one, so a tuple holding one moves.
    if (r.kind === "object" && r.tuple === true) return r.fields.every((f) => this.isCopy(f.type) && !this.holdsMut(f.type));
    return r.kind === "union" && r.unknown !== true && r.members.every((t) => this.isCopy(t));
  }

  // Whether a value of `t` holds a mutable reference anywhere, which a copy would alias.
  holdsMut(t: Type): boolean {
    let seen = new TypeSet<Type>();
    return this.holdsMutIn(t, seen);
  }

  private holdsMutIn(t: Type, seen: Mut<TypeSet<Type>>): boolean {
    if (typeof t === "string" || seen.has(t)) return false;
    seen.add(t);
    const r = this.rec(t);
    if (r.kind === "ref") return r.mutable;
    if (r.kind === "recursive") return this.holdsPart(r.of, (u) => { const v = this.recOf(u); return v?.kind === "ref" && v.mutable; });
    if (r.kind === "param") return r.concrete !== undefined ? this.holdsMutIn(r.concrete, seen) : r.bound !== undefined && this.holdsMutIn(r.bound, seen);
    if (r.kind === "union") {
      for (const m of r.members) if (this.holdsMutIn(m, seen)) return true;
      return false;
    }
    if (r.kind === "array" || r.kind === "fixed") return this.holdsMutIn(r.element, seen);
    if (r.kind === "map") return this.holdsMutIn(r.value, seen);
    if (r.kind === "variant") {
      for (const f of r.fields) if (this.holdsMutIn(f.type, seen)) return true;
      return false;
    }
    if (r.kind === "class") {
      for (const f of r.fields) if (this.holdsMutIn(f.type, seen)) return true;
      return r.base !== undefined && this.holdsMutIn(r.base, seen);
    }
    if (r.kind === "generator" || r.kind === "future") {
      for (const f of r.params) if (this.holdsMutIn(f.type, seen)) return true;
      return false;
    }
    if (r.kind === "object" || r.kind === "closure") {
      for (const f of r.fields) if (this.holdsMutIn(f.type, seen)) return true;
    }
    return false;
  }

  // Whether a value has a part `found` picks anywhere in it, or with `throughRefs` also behind a
  // reference it holds. What a `shared` holds isn't its own part: copies of it are the same value.
  holdsPart(t: Type, found: (t: Type) => boolean, throughRefs = false): boolean {
    let seen = new TypeSet<Type>();
    return this.holdsPartIn(t, found, throughRefs, seen);
  }

  // Walked with a stack, in the order a recursive walk would take, so `found` is called rather than
  // handed on, which would make another instance of this method for each closure handed on.
  private holdsPartIn(start: Type, found: (t: Type) => boolean, throughRefs: boolean, seen: Mut<TypeSet<Type>>): boolean {
    let stack: Type[] = [start];
    while (stack.length > 0) {
      const t = stack.pop()!;
      if (found(t)) return true;
      if (typeof t === "string") continue;
      // A type that holds itself, through an array of itself, is looked into once.
      if (seen.has(t)) continue;
      seen.add(t);
      const r = this.rec(t);
      let parts: Type[] = [];
      if (r.kind === "ref") parts = throughRefs ? [r.to] : [];
      else if (r.kind === "param") parts = r.concrete !== undefined ? [r.concrete] : [];
      else if (r.kind === "union") parts = r.members.slice();
      else if (r.kind === "array" || r.kind === "fixed") parts = [r.element];
      else if (r.kind === "map") parts = [r.key, r.value];
      else if (r.kind === "interior" || r.kind === "recursive") parts = [r.of];
      else if (r.kind === "class") {
        parts = r.fields.map((f) => f.type);
        if (r.base !== undefined) parts.push(r.base);
      }
      else if (r.kind === "generator" || r.kind === "future") parts = [...r.params, ...r.frame].map((f) => f.type);
      else if (r.kind === "object" || r.kind === "closure" || r.kind === "variant") parts = r.fields.map((f) => f.type);
      for (let i = parts.length; i > 0; i--) stack.push(parts[i - 1]!);
    }
    return false;
  }

  // Whether a value owns a JoinHandle, or with `throughRefs` borrows one: only one place may
  // await a task's result.
  holdsHandle(t: Type, throughRefs = false) {
    return this.holdsPart(t, (u) => this.recOf(u)?.kind === "handle", throughRefs);
  }

  // Whether a value changes in place behind a shared reference: it holds an Atomic, a Lock, a
  // Cell, a shared value, or a Dyn, whose hidden value may hold them. Readers of a shared value
  // or an Rc borrow such fields without its lock. An Rc or a Weak is copied out instead, its
  // copy one more count, so an `update` may replace it.
  interiorMutable(t: Type) {
    return this.holdsPart(t, (u) => {
    const r = this.recOf(u);
    return r !== undefined && ((r.kind === "shared" && r.which === "shared") || r.kind === "dyn" || r.kind === "interior" || (r.kind === "block" && r.which !== "Permit"));
  });
  }

  // The first Atomic, Lock or Cell a value holds, if any.
  holdsInterior(t: Type): InteriorType | undefined {
    let found: InteriorType | undefined = undefined;
    this.holdsPart(t, (u) => {
      if (this.recOf(u)?.kind !== "interior") return false;
      found = u as InteriorType;
      return true;
    });
    return found;
  }

  // A tuple's element types, in order.
  elementsOf(t: ObjectType): Type[] {
    return tupleElements(this.rec(t).fields);
  }

  isTuple(t: Type): boolean {
    const r = this.recOf(t);
    return r?.kind === "object" && r.tuple === true;
  }

  // A type's own fields; a type parameter offers its bound's, and holds none of its own.
  fieldsOf(t: Exclude<Type, string>): Field[] {
    const r = this.rec(t);
    return r.kind === "param" ? (r.bound !== undefined ? this.rec(r.bound).fields : []) : r.fields;
  }

  // Every type a type's record names directly, its fields' types included.
  links(t: Type): Type[] {
    if (typeof t === "string") return [];
    const r = this.rec(t);
    const fields = r.fields.map((f) => f.type);
    const maybe = (u: Type | undefined): Type[] => (u === undefined ? [] : [u]);
    const methods = (ms: Method[]): Type[] => {
      let out: Type[] = [];
      for (const m of ms) {
        for (const p of m.params) out.push(p);
        out.push(m.returns);
        if (m.throws !== undefined) out.push(m.throws);
      }
      return out;
    };
    switch (r.kind) {
      case "object": return [...fields, ...maybe(r.rest)];
      case "class": {
        const args: Type[] = r.generic !== undefined ? r.generic.args : [];
        return [...fields, ...maybe(r.base), ...args];
      }
      case "interface": {
        const args: Type[] = r.generic !== undefined ? r.generic.args : [];
        return [...fields, ...methods(r.methods), ...args];
      }
      case "param": return [...maybe(r.bound), ...maybe(r.concrete)];
      case "literal": return maybe(r.owner?.of);
      case "union": return r.members;
      case "ref":
      case "pointer": return [r.to];
      case "closure": return [...r.params, r.returns, ...maybe(r.throws), ...fields];
      case "function": {
        const own: Type[] = r.generic !== undefined ? r.generic.own : [];
        return [...r.params, r.returns, ...maybe(r.throws), ...own];
      }
      case "array":
      case "fixed": return [r.element];
      case "map": return [r.key, r.value];
      case "variant": return [...fields, ...r.args, ...maybe(r.of)];
      case "generator": return [r.yields, ...r.params.map((f) => f.type), ...r.frame.map((f) => f.type)];
      case "future": return [r.gives, ...maybe(r.throws), ...r.params.map((f) => f.type), ...r.frame.map((f) => f.type)];
      case "handle": return [r.gives, ...maybe(r.throws), ...maybe(r.joined?.base), ...maybe(r.joined?.panic)];
      case "interior":
      case "shared":
      case "block":
      case "dyn": return [r.of];
      case "recursive": return [...r.args, r.of];
      case "brand": return [r.base, r.tag];
      case "pattern":
      case "regex":
      case "unknown":
      default: return [];
    }
  }

  // A field of an object, or of an instance or the bases it embeds.
  field(t: Exclude<Type, string>, name: string): Field | undefined {
    const r = this.rec(t);
    const own = this.fieldsOf(t).find((f) => f.name === name);
    return own ?? (r.kind === "class" && r.base !== undefined ? this.field(r.base, name) : undefined);
  }

  // The indices that reach a field inside a value of `t`, through any embedded bases.
  fieldPath(t: ObjectType | ClassType, name: string): usize[] {
    const r = this.rec(t);
    const embeds = r.kind === "class" && r.base !== undefined;
    const i = r.fields.findIndex((f) => f.name === name);
    if (i >= 0) return [(i as usize) + (embeds ? 1 : 0)];
    return [0, ...this.fieldPath(this.rec(t as ClassType).base!, name)];
  }

  // Every field of an instance: its bases' first, then its own.
  allFields(t: ClassType): Field[] {
    const r = this.rec(t);
    const base: Field[] = r.base !== undefined ? this.allFields(r.base) : [];
    return [...base, ...r.fields];
  }

  // Whether `t` embeds `base`, directly or through another base.
  derives(t: ClassType, base: ClassType): boolean {
    const r = this.rec(t);
    return r.base !== undefined && (r.base === base || this.derives(r.base, base));

  }

  // Function types whose error is a type parameter the call hasn't decided: an arrow given as one
  // infers what it throws, which then decides that parameter.
  openThrows = new TypeSet<FunctionType>();

  private patterns = new Map<string, PatternType>();
  patternType(this: Mut<this>, quasis: string[], holes: Hole[]): Type {
    // `${string}` alone is every string.
    if (holes.length === 1 && holes[0] === "string" && quasis.every((q) => q === "")) return "string";
    const key = JSON.stringify([[...quasis], [...holes]]);
    let t = this.patterns.get(key);
    if (t === undefined) {
      t = this.made<PatternType>({ kind: "pattern", quasis, holes, fields: [] }, `pattern ${key}`);
      this.patterns.set(key, t);
    }
    return t;
  }

  // A unit over a numeric base, or the base alone when no unit is left, as `m / m` leaves none.
  unitType(this: Mut<this>, base: Type, powers: Record<string, i64>): Type {
    let names = Object.keys(powers).filter((n) => powers[n] !== 0);
    names.sort();
    if (names.length === 0) return base;
    let unit: Record<string, i64> = {};
    for (const n of names) unit[n] = powers[n]!;
    const tag = this.literalType(unitText(unit));
    return this.brandType(base, tag, { unit });
  }

  // A brand's base, or the type itself.
  unbranded(t: Type): Type {
    const r = this.recOf(t);
    if (r?.kind === "union") return this.brandsBase(r.members) ?? t;
    return r?.kind === "brand" ? r.base : t;
  }

  // The base every one of a union's plain brands shares, as a union of kinds of id has, when
  // they share one: it works as that base, as each member would.
  private brandsBase(members: Type[]): Type | undefined {
    const bases = members.map((m) => {
      const b = this.recOf(m);
      return b?.kind === "brand" && b.unit === undefined ? b.base : undefined;
    });
    return bases.every((b) => b !== undefined && b === bases[0]) ? bases[0] : undefined;
  }

  private brands = new Map<string, BrandType>();
  brandType(this: Mut<this>, base: Type, tag: Type, how: { loose?: true; field?: string; unit?: Record<string, i64> } = {}): BrandType {
    const key = `brand ${this.keyOf(base)} ${this.keyOf(tag)} ${how.loose !== undefined ? "?" : ""}${how.field ?? ""} ${how.unit !== undefined ? JSON.stringify(how.unit) : ""}`;
    let t = this.brands.get(key);
    if (t === undefined) {
      t = this.made<BrandType>({ kind: "brand", base, tag, ...how, fields: [] }, key);
      this.brands.set(key, t);
    }
    return t;
  }

  // Whether a pattern is anywhere in `t`, where lowering it to `string` would lose what it asks.
  holdsPattern(this: Mut<this>, t: Type): boolean {
    return this.holdsKind(t, "pattern");
  }

  // Whether a brand is anywhere in `t`, which lowering would make its base.
  holdsBrand(this: Mut<this>, t: Type): boolean {
    return this.holdsKind(t, "brand");
  }
  private branded = new TypeMap<Exclude<Type, string>, boolean>();

  private holdsKind(this: Mut<this>, t: Type, kind: "pattern" | "brand"): boolean {
    if (typeof t === "string") return false;
    let found = kind === "pattern" ? this.patterned.get(t) : this.branded.get(t);
    if (found === undefined) {
      if (kind === "pattern") this.patterned.set(t, false);
      else this.branded.set(t, false);
      const r = this.rec(t);
      const throwsList: Type[] = r.kind === "handle" && r.throws !== undefined ? [r.throws] : [];
      const classArgs: Type[] = r.kind === "class" && r.generic !== undefined ? r.generic.args : [];
      let dynParts: Type[] = [];
      if (r.kind === "dyn") {
        const iface = this.rec(r.of);
        for (const m of iface.methods) {
          for (const p of m.params) dynParts.push(p);
          dynParts.push(m.returns);
        }
      }
      const parts: Type[] = r.kind === "union" ? r.members : r.kind === "array" || r.kind === "fixed" ? [r.element] : r.kind === "map" ? [r.key, r.value] : r.kind === "ref" || r.kind === "pointer" ? [r.to]
        : r.kind === "object" ? r.fields.map((f) => f.type) : r.kind === "class" ? classArgs : r.kind === "param" && r.concrete !== undefined ? [r.concrete]
        : r.kind === "interior" || r.kind === "shared" || r.kind === "block" ? [r.of] : r.kind === "handle" ? [r.gives, ...throwsList]
        : r.kind === "variant" ? [...r.args, ...r.fields.map((f) => f.type)] : r.kind === "function" || r.kind === "closure" ? [...r.params, r.returns]
        : r.kind === "future" ? [r.gives] : r.kind === "generator" ? [r.yields] : r.kind === "dyn" ? dynParts : [];
      found = r.kind === kind || parts.some((p) => this.holdsKind(p, kind));
      if (kind === "pattern") this.patterned.set(t, found);
      else this.branded.set(t, found);
    }
    return found;
  }
  private patterned = new TypeMap<Exclude<Type, string>, boolean>();

  // Whether two types are one once lowered, except where `to` holds a pattern that lowering
  // would make a plain string: then fitting decides, part by part.
  sameLowered(this: Mut<this>, from: Type, to: Type): boolean {
    if (this.lower(from) !== this.lower(to)) return false;
    if (this.holdsPattern(to)) return this.holdsPattern(from) && this.shapeKey(from) === this.shapeKey(to);
    if (!this.holdsBrand(to)) return true;
    // Brands compare once type parameters stand for what they are, where that keeps them.
    const target = this.lowerKeepingBrands(to);
    if (this.holdsBrand(target)) return this.lowerKeepingBrands(from) === target;
    return this.holdsBrand(from) && this.shapeKey(from) === this.shapeKey(to);
  }

  private interiors = new Map<string, InteriorType>();

  interiorType(this: Mut<this>, which: InteriorRecord["which"], of: Type): InteriorType {
    const key = `${which} ${this.keyOf(of)}`;
    let t = this.interiors.get(key);
    if (t === undefined) {
      t = this.made<InteriorType>({ kind: "interior", which, of, fields: [] }, key);
      this.interiors.set(key, t);
    }
    return t;
  }

  private shareds = new Map<string, SharedType>();

  sharedType(this: Mut<this>, of: Type, which: SharedRecord["which"] = "shared"): SharedType {
    const key = `${which} ${this.keyOf(of)}`;
    let t = this.shareds.get(key);
    if (t === undefined) {
      t = this.made<SharedType>({ kind: "shared", which, of, fields: [] }, key);
      this.shareds.set(key, t);
    }
    return t;
  }

  private dyns = new TypeMap<InterfaceType, DynType>();

  dynType(this: Mut<this>, of: InterfaceType): DynType {
    let t = this.dyns.get(of);
    if (t === undefined) {
      const key = `dyn ${this.keyOf(of)}`;
      t = this.made<DynType>({ kind: "dyn", of, fields: [] }, key);
      this.dyns.set(of, t);
    }
    return t;
  }

  // A stored callable: a written function type in a field, an element, an annotated variable or
  // a return is a Dyn of an interface with one method, `call`, which a closure satisfies by its
  // signature. One per signature, parameter names aside; each spelling is shown as written.
  private callables = new Map<string, InterfaceType>();
  private spellings = new Map<string, DynType>();
  callableOf = new TypeMap<InterfaceType, FunctionType>();

  // Why a type can't cross between Fish and JS yet, when it can't: what crosses is strings,
  // booleans, numbers, null, literals, unions and Options of them, arrays and tuples of them,
  // copied across, and opaque JS values.
  uncrossable(t: Type): string | undefined {
    let within = new TypeSet<Type>();
    return this.uncrossableIn(t, within);
  }

  private uncrossableIn(t: Type, within: Mut<TypeSet<Type>>): string | undefined {
    // An empty array's element type, `never`, holds no value to cross.
    if (t === "string" || t === "boolean" || t === "null" || t === "never" || isNumeric(t)) return undefined;
    if (typeof t === "string") return t === "void" ? "'void' gives no value" : "Fish has no JS form for it";
    // A type holding itself has no JS form yet, as converting it would never end.
    if (within.has(t)) return "a type holding itself has no JS form yet";
    within.add(t);
    const why = this.crossing(t, within);
    within.delete(t);
    return why;
  }

  private crossing(t: Exclude<Type, string>, within: Mut<TypeSet<Type>>): string | undefined {
    // A callback or a stored Promise crosses on its own, as JS keeps it, not inside another value.
    const kept = (u: Type) => this.recOf(u)?.kind === "dyn" && this.keptByJs(u as DynType);
    const r = this.rec(t);
    switch (r.kind) {
      case "brand":
        return this.uncrossableIn(r.base, within);
      case "literal":
        return undefined;
      case "param":
        if (r.bound !== undefined && this.rec(r.bound).kind === "function") return "functions crossing between Fish and JS aren't supported yet";
        return r.concrete === undefined ? "a type parameter's value isn't known here" : this.uncrossableIn(r.concrete, within);
      case "union": {
        if (r.members.some((m) => kept(m))) return "a callback or a Promise in a union, as an optional parameter holds one, isn't supported yet";
        for (const m of r.members) {
          const w = this.uncrossableIn(m, within);
          if (w !== undefined) return w;
        }
        return undefined;
      }
      case "array":
      case "fixed":
        if (this.holdsPart(r.element, (u) => kept(u))) return "a callback or a Promise inside an array isn't supported yet; give it on its own";
        return this.uncrossableIn(r.element, within);
      case "object": {
        const parts = r.tuple === true ? this.elementsOf(t as ObjectType) : r.fields.map((f) => f.type);
        if (parts.some((u) => this.holdsPart(u, (v) => kept(v)))) return "a callback or a Promise inside an object isn't supported yet; give it on its own";
        for (const p of parts) {
          const w = this.uncrossableIn(p, within);
          if (w !== undefined) return w;
        }
        return undefined;
      }
      case "block":
        return r.which === "JsValue" ? undefined : `a '${r.which}' is Fish's own`;
      case "function":
      case "closure":
        return "functions crossing between Fish and JS aren't supported yet";
      case "future":
      case "handle":
        if (r.kind === "future" && this.leafOf.get(t as FutureType)?.method === "jsAwait") return r.gives === "void" ? undefined : this.uncrossableIn(r.gives, within);
        return "Promises crossing between Fish and JS aren't supported yet";
      case "interface":
      case "dyn":
        // A callback crosses as a JS function when what it takes and gives do.
        if (r.kind === "dyn" && this.callableOf.has(r.of)) {
          const fn = this.rec(this.callableOf.get(r.of)!);
          // What JS gives a callback is read into Fish, which has no reading of a JS function or
          // promise as a Fish one.
          if (fn.params.some((p) => this.holdsPart(p, (u) => {
            const v = this.recOf(u);
            return kept(u) || (v !== undefined && (v.kind === "function" || (v.kind === "interface" && this.promiseElement(u as InterfaceType) !== undefined)));
          }))) {
            return "a callback that is given a function or a Promise isn't supported yet";
          }
          if (fn.throws !== undefined) return "a callback that throws isn't supported yet; catch inside it";
          const ret: Type[] = fn.returns === "void" ? [] : [fn.returns];
          for (const p of [...fn.params, ...ret]) {
            const w = this.uncrossableIn(p, within);
            if (w !== undefined) return w;
          }
          return undefined;
        }
        {
          // A Fish future given to JS is a promise of what it gives.
          const promised = this.promiseElement(r.kind === "dyn" ? r.of : t);
          if (promised === undefined) return "Fish has no JS form for it";
          return r.kind === "dyn" ? (promised === "void" ? undefined : this.uncrossableIn(promised, within)) : "Promises crossing between Fish and JS aren't supported yet";
        }
      default:
        return "Fish has no JS form for it";
    }
  }

  // The members of a package's shapes Fish can't type, each with why: refused only where used.
  jsUntyped = new TypeMap<InterfaceType, Map<string, CompileError>>();
  // The members held aside that are optional, which a value may leave out, by shape.
  jsOptional = new TypeMap<InterfaceType, Set<string>>();
  // The same for a package's function a program imports but doesn't call.
  jsUncalled = new NodeMap<Id, CompileError>();

  // The prelude's JsError, what awaiting a JS promise that rejects throws, once the prelude is read.
  private jsError: Type | undefined = undefined;
  setJsError(this: Mut<this>, t: Type | undefined) {
    this.jsError = t;
  }

  // What a declared type is when JS gives it: an object, as a handle of its shape, inside unions,
  // arrays and tuples too, and a promise as a Fish future of what it fulfills with.
  jsView(this: Mut<this>, t: Type): Type {
    if (typeof t === "string") return t;
    const r = this.rec(t);
    const promised = this.promiseElement(r.kind === "dyn" ? r.of : t);
    if (promised !== undefined && this.jsError !== undefined) {
      const gives = promised === "void" ? "void" : this.jsView(promised);
      return this.leafFuture("jsAwait", gives, this.jsError);
    }
    if (r.kind === "object" && r.tuple !== true) return this.blockType("JsValue", t);
    if (r.kind === "object") {
      const elements = this.elementsOf(t as ObjectType).map((u) => this.jsView(u));
      const rest = r.rest === undefined ? undefined : this.jsView(r.rest);
      return this.retuple(t as ObjectType, elements, rest);
    }
    if (r.kind === "union") {
      const members = r.members.map((u) => this.jsView(u));
      return this.unionType(members);
    }
    if (r.kind === "array") {
      const element = this.jsView(r.element);
      return this.arrayType(element);
    }
    return t;
  }

  // What the timer task runs: each timer's callback, wrapped as an async function.
  timerCallback(this: Mut<this>): DynType {
    const returns = this.promiseInterface("void");
    const fn = this.functionType([], [], returns);
    return this.callableType(fn);
  }

  callableType(this: Mut<this>, fn: FunctionType): DynType {
    return this.callableFrom(this.rec(fn));
  }

  // The stored callable of a signature, which may be one no type has, spelled as a closure was.
  callableFrom(this: Mut<this>, f: FunctionRecord): DynType {
    // In an instance, what its type parameters stand for decides the layout; brands stay, for
    // checking what is passed and given.
    const params = f.params.map((t) => this.lowerKeepingBrands(t));
    const returns = this.lowerKeepingBrands(f.returns);
    const throws = f.throws !== undefined ? this.lower(f.throws) : undefined;
    // Keyed by types alone, as parameter names don't make another function type, so
    // `Box<(n: i64) => i64>` and `Box<(m: i64) => i64>` are one class; the first spelling met is shown.
    const key = `${params.map((t) => this.keyOf(t)).join(", ")} => ${this.keyOf(returns)}${throws !== undefined ? ` throws ${this.keyOf(throws)}` : ""}`;
    let i = this.callables.get(key);
    if (i === undefined) {
      i = this.interfaceType(f.name);
      let ir = this.rec(i);
      const method: Method = throws !== undefined ? { name: "call", params: [...params], returns, throws } : { name: "call", params: [...params], returns };
      ir.methods.push(method);
      this.setRec(i, ir);
      this.callables.set(key, i);
      const madeFn = this.made<FunctionType>({ ...f, params, returns, throws, fields: [] });
      this.callableOf.set(i, madeFn);
    }
    if (f.name === this.rec(i).name) return this.dynType(i);
    let spelled = this.spellings.get(`${key} ${f.name}`);
    if (spelled === undefined) {
      const dyn = this.dynType(i);
      const dynKey = this.keys.get(dyn)!;
      spelled = this.made<DynType>({ kind: "dyn", of: i, fields: [], shown: f.name }, dynKey);
      this.spellings.set(`${key} ${f.name}`, spelled);
    }
    return spelled;
  }

  // Whether two types are one once lowered, with the brands either holds the same.
  private sameKept(this: Mut<this>, a: Type, b: Type): boolean {
    return this.sameLowered(a, b) && this.sameLowered(b, a);
  }

  // Whether two stored callables take and give the same types, so either holds the other's value.
  sameCallable(this: Mut<this>, a: Type, b: Type): boolean {
    const fnOf = (t: Type): FunctionRecord | undefined => {
      const r = this.recOf(t);
      const fn = r?.kind === "dyn" ? this.callableOf.get(r.of) : undefined;
      return fn !== undefined ? this.rec(fn) : undefined;
    };
    const f = fnOf(a);
    const g = fnOf(b);
    return f !== undefined && g !== undefined && f.params.length === g.params.length && f.params.every((p, i) => this.sameKept(p, g.params[i as usize]!)) && this.sameKept(f.returns, g.returns)
      && (f.throws !== undefined ? this.lower(f.throws) : undefined) === (g.throws !== undefined ? this.lower(g.throws) : undefined);
  }

  // A function type, or a `Promise<T>`, where a value is stored becomes its boxed form, inside
  // arrays too.
  stored(this: Mut<this>, t: Type): Type {
    if (typeof t === "string") return t;
    const r = this.rec(t);
    // A generic function type, like an interface, describes a value without being one.
    if (r.kind === "function" && r.generic !== undefined) return t;
    if (r.kind === "function") return this.callableType(t as FunctionType);
    // A `Promise<T>` stored holds a future, boxed.
    if (r.kind === "interface" && this.promised.has(t as InterfaceType)) return this.dynType(t as InterfaceType);
    if (r.kind === "array") {
      const element = this.stored(r.element);
      return this.arrayType(element, r.typed);
    }
    if (r.kind === "fixed") {
      const element = this.stored(r.element);
      return this.fixedType(element, r.size);
    }
    if (r.kind === "map") {
      const value = this.stored(r.value);
      return this.mapType(r.key, value, r.set, r.dict);
    }
    return t;
  }

  // A type argument holds its values, so a function type or a closure's type given as one is a
  // stored callable, as Rust's `Box<dyn Fn>` is.
  heldArgument(this: Mut<this>, t: Type): Type {
    if (typeof t === "string") return t;
    const r = this.rec(t);
    if ((r.kind !== "function" && r.kind !== "closure") || r.generic !== undefined) return t;
    if (r.kind === "function") return this.callableType(t as FunctionType);
    // An async closure gives a Promise, as a written `() => Promise<T>` does. One whose future
    // throws has no written form yet, so it stays as it is, for its holder to refuse.
    const gives = this.recOf(r.returns);
    const future = gives?.kind === "future" ? gives : undefined;
    if (future?.throws !== undefined) return t;
    // What it gives widens as a `let` would, so `() => "a"` and `() => "b"` meet as `() => string`.
    const returns = future !== undefined ? this.promiseInterface(future.gives) : this.widenLet(r.returns);
    const fn = this.functionType(r.params.map((_, i) => `p${i}`), r.params, returns, r.throws);
    // Shown as the closure was written, with its own parameter names, when that is still its type.
    return returns === r.returns ? this.callableFrom({ ...this.rec(fn), name: r.name }) : this.callableType(fn);
  }

  private blocks = new Map<string, BlockType>();

  // Whether a value crosses between Fish and JS converted on the way: a string, a number, a
  // boolean, empty, a literal, a JS value or handle, and unions, arrays, tuples and objects of them.
  // A Fish type holding itself has no JS form yet, as converting it would never end: `within` is
  // the types the walk is inside.
  jsConverts(t: Type): boolean {
    let within = new TypeSet<Type>();
    return this.jsConvertsIn(t, within);
  }

  private jsConvertsIn(t: Type, within: Mut<TypeSet<Type>>): boolean {
    // An empty array's element type, `never`, holds no value to convert.
    if (t === "string" || t === "boolean" || t === "null" || t === "never" || isNumeric(t)) return true;
    if (typeof t === "string" || within.has(t)) return false;
    const r = this.rec(t);
    if (r.kind === "block") return r.which === "JsValue";
    if (r.kind === "dyn" && this.callableOf.has(r.of)) {
      const fn = this.rec(this.callableOf.get(r.of)!);
      if (fn.throws !== undefined) return false;
      const ret: Type[] = fn.returns === "void" ? [] : [fn.returns];
      for (const u of [...fn.params, ...ret]) if (!this.jsConvertsIn(u, within)) return false;
      return true;
    }
    if (r.kind === "dyn" && this.promiseElement(r.of) !== undefined) return this.promiseElement(r.of) === "void" || this.jsConvertsIn(this.promiseElement(r.of)!, within);
    if (r.kind === "future") return this.leafOf.get(t as FutureType)?.method === "jsAwait" && (r.gives === "void" || this.jsConvertsIn(r.gives, within));
    const parts: Type[] | undefined = r.kind === "ref" ? [r.to] : r.kind === "param" ? (r.concrete === undefined ? undefined : [r.concrete])
      : r.kind === "union" ? r.members : r.kind === "array" || r.kind === "fixed" ? [r.element] : r.kind === "object" ? r.fields.map((f) => f.type) : r.kind === "literal" ? [] : undefined;
    if (parts === undefined) return false;
    within.add(t);
    let all = true;
    for (const u of parts) if (!this.jsConvertsIn(u, within)) { all = false; break; }
    within.delete(t);
    return all;
  }

  // A value JS keeps once it is given: a stored callable or a stored Promise, or what is stored as
  // one, a closure, a function or a future. Given to JS, it is handed over.
  keptByJs(t: Type): boolean {
    if (typeof t === "string") return false;
    const r = this.rec(t);
    if (r.kind === "dyn") return this.callableOf.has(r.of) || this.promiseElement(r.of) !== undefined;
    return r.kind === "closure" || r.kind === "function" || r.kind === "future" || r.kind === "handle";
  }

  // What a package's parameter takes: a function type is a callback that JS may keep, so a stored
  // callable, owning what it uses; a `Promise<T>` is a stored one, as the task settling the JS
  // promise owns it; an object type is a handle of that shape, which a Fish value of it meets by
  // being made a new JS object.
  jsTakes(this: Mut<this>, t: Type): Type {
    if (typeof t === "string") return t;
    const r = this.rec(t);
    if (r.kind === "union") {
      const members = r.members.map((u) => this.jsTakes(u));
      return this.unionType(members);
    }
    if (r.kind === "function" || (r.kind === "interface" && this.promiseElement(t as InterfaceType) !== undefined)) return this.stored(t);
    return this.jsView(t);
  }

  // What a variable of type `declared` holding a JsValue reads as where `typeof` narrowed it to
  // `read`: one kind of value, read out of JS, or several, which leave it the JsValue.
  jsRead(declared: Type, read: Type | undefined): "one" | "several" | undefined {
    if (read === undefined) return undefined;
    const ref = this.recOf(declared);
    const held = ref?.kind === "ref" ? ref.to : declared;
    const union = this.recOf(held);
    const members = union?.kind === "union" ? union.members : [held];
    if (!members.some((t) => this.isPlainJs(t))) return undefined;
    const kinds = (u: Type) => (u === "string" || u === "f64" || u === "boolean") && !members.includes(u);
    const readRec = this.recOf(read);
    const reads = (readRec?.kind === "union" ? readRec.members : [read]).filter((u) => kinds(u));
    if (reads.length === 0) return undefined;
    return reads.length === 1 && kinds(read) ? "one" : "several";
  }

  blockType(this: Mut<this>, which: BlockRecord["which"], of: Type = "void"): BlockType {
    const key = `${which} ${this.keyOf(of)}`;
    let t = this.blocks.get(key);
    if (t === undefined) {
      t = this.made<BlockType>({ kind: "block", which, of, fields: [] }, key);
      this.blocks.set(key, t);
    }
    return t;
  }
  private leaves = new Map<string, FutureType>();
  leafOf = new TypeMap<FutureType, { method: Leaf; of: Type; signal: boolean }>();

  // Each leaf's frame after its state: what it waits on, then what it carries.
  private leafFrame(this: Mut<this>, method: Leaf, of: Type): Field[] {
    switch (method) {
      case "sleep": return [{ name: "deadline", type: "i64" }];
      case "acquire": return [{ name: "block", type: this.blockType("Semaphore") }];
      case "send": return [{ name: "block", type: this.blockType("Channel", of) }, { name: "value", type: of }];
      case "receive": return [{ name: "block", type: this.blockType("Channel", of) }];
      case "bind": return [{ name: "host", type: "string" }, { name: "port", type: "i64" }];
      case "connect": return [{ name: "socket", type: this.blockType("TcpStream") }, { name: "host", type: "string" }, { name: "port", type: "i64" }];
      case "accept": return [{ name: "block", type: this.blockType("TcpListener") }];
      case "read": return [{ name: "block", type: this.blockType("TcpStream") }, { name: "max", type: "i64" }];
      case "write": return [{ name: "block", type: this.blockType("TcpStream") }, { name: "bytes", type: this.arrayType("u8") }, { name: "written", type: "i64" }];
      // A UDP socket's waits; a send with no host goes to the connected peer.
      case "sendTo": return [{ name: "block", type: this.blockType("UdpSocket") }, { name: "bytes", type: this.arrayType("u8") }, { name: "host", type: "string" }, { name: "port", type: "i64" }];
      case "receiveFrom": return [{ name: "block", type: this.blockType("UdpSocket") }];
      case "udpConnect": return [{ name: "block", type: this.blockType("UdpSocket") }, { name: "host", type: "string" }, { name: "port", type: "i64" }];
      case "readFile": return [{ name: "path", type: "string" }, { name: "job", type: this.blockType("FileJob") }];
      case "writeFile": return [{ name: "path", type: "string" }, { name: "bytes", type: this.arrayType("u8") }, { name: "job", type: this.blockType("FileJob") }];
      case "timerNext": return [];
      // A JS promise, and whether the task already waits for it to settle.
      case "jsAwait": return [{ name: "promise", type: this.blockType("JsValue") }, { name: "waiting", type: "i32" }];
      // An async generator's `next()`, which runs the generator where it lives, in the awaiting task.
      default: return [{ name: "generator", type: this.refType(of, true) }];
    }
  }

  // A leaf future: what it gives, what it may throw, and whether it was given an AbortSignal, whose
  // count and waiting flag end its frame.
  leafFuture(this: Mut<this>, method: Leaf, of: Type, given?: Type, signal = false): FutureType {
    // An async generator's `next()` throws what the generator does.
    const generator = method === "next" ? this.recOf(of) : undefined;
    const throws = given ?? (generator?.kind === "generator" ? generator.throws : undefined);
    const key = `${method} ${this.keyOf(of)} ${throws !== undefined ? this.keyOf(throws) : ""} ${signal}`;
    let t = this.leaves.get(key);
    if (t === undefined) {
      let frame: Field[] = [{ name: "state", type: "i32" }, ...this.leafFrame(method, of)];
      if (signal) {
        frame.push({ name: "signal", type: this.blockType("AbortSignal") });
        frame.push({ name: "waiting", type: "i32" });
      }
      const gives: Type = method === "acquire" ? this.blockType("Permit") : method === "receive" || method === "timerNext" ? this.unionType([of, "null"]) : method === "bind" ? (of === "void" ? this.blockType("TcpListener") : of)
        : method === "connect" || method === "accept" ? (of === "void" ? this.blockType("TcpStream") : of) : method === "read" || method === "readFile" ? this.arrayType("u8") : method === "jsAwait" ? of
        : method === "next" ? this.nextResult(this.rec(of as GeneratorType).yields) : method === "receiveFrom" ? (of === "void" ? this.datagram() : this.arrayType("u8")) : "void";
      t = this.made<FutureType>({ kind: "future", name: method, gives, throws, fields: [], params: [], frame, concrete: true }, `leaf ${key}`);
      this.leaves.set(key, t);
      this.leafOf.set(t, { method, of, signal });
    }
    return t;
  }

  private handles = new Map<string, HandleType>();

  handleType(this: Mut<this>, gives: Type, throws: Type | undefined): HandleType {
    const key = `handle ${this.keyOf(gives)} ${throws !== undefined ? this.keyOf(throws) : ""}`;
    let t = this.handles.get(key);
    if (t === undefined) {
      t = this.made<HandleType>({ kind: "handle", gives, throws, fields: [] }, key);
      this.handles.set(key, t);
    }
    return t;
  }

  // What `handle.join()` gives: the task's handle, awaited as throwing a TaskPanic too.
  joinedType(this: Mut<this>, base: HandleType, panic: Type): HandleType {
    const key = `joined ${this.keyOf(base)} ${this.keyOf(panic)}`;
    let t = this.handles.get(key);
    if (t === undefined) {
      const { gives, throws } = this.rec(base);
      const allThrows = throws !== undefined ? this.unionType([throws, panic]) : panic;
      t = this.made<HandleType>({ kind: "handle", gives, throws: allThrows, fields: [], joined: { base, panic } }, key);
      this.handles.set(key, t);
    }
    return t;
  }

  futureType(this: Mut<this>, name: string, concrete: boolean): FutureType {
    const id = this.declared++;
    const t = this.made<FutureType>({ kind: "future", name, gives: "void", fields: [], params: [], frame: [], concrete }, `future ${id}`);
    return t;
  }
  combinedOf = new TypeMap<FutureType, Combined>();

  // What a future in a combined one gives, null for nothing, and what it throws.
  private givenBy(f: FutureType | HandleType | DynType): Type {
    const r = this.rec(f);
    const gives = r.kind === "dyn" ? this.promiseElement(r.of)! : r.gives;
    return gives === "void" ? "null" : gives;
  }

  // An `allSettled` outcome, as JavaScript gives it: fulfilled with the value, or, for a future that
  // can throw, rejected with what it threw.
  settledType(this: Mut<this>, gives: Type, thrown: Type | undefined): Type {
    const { fulfilled, rejected } = this.settledParts(gives, thrown);
    return rejected !== undefined ? this.unionType([fulfilled, rejected]) : fulfilled;
  }

  settledParts(this: Mut<this>, gives: Type, thrown: Type | undefined): { fulfilled: ObjectType; rejected?: ObjectType } {
    const fulfilledTag = this.literalType("fulfilled");
    const fulfilled = this.objectType([{ name: "status", type: fulfilledTag }, { name: "value", type: gives }]);
    if (thrown === undefined) return { fulfilled };
    const rejectedTag = this.literalType("rejected");
    const rejected = this.objectType([{ name: "status", type: rejectedTag }, { name: "reason", type: thrown }]);
    return { fulfilled, rejected };
  }

  private makeCombinedFuture(this: Mut<this>, c: Combined, gives: Type, throws: Type | undefined, frame: Field[]): FutureType {
    let params: Field[] = [];
    for (const f of c.futures) {
      const r = this.rec(f);
      if (r.kind === "future") for (const p of r.params) params.push({ ...p });
    }
    const id = this.declared++;
    const t = this.made<FutureType>({ kind: "future", name: `Promise.${c.kind}`, gives, throws, fields: [], params, frame, concrete: true }, `future ${id}`);
    this.combinedOf.set(t, c);
    return t;
  }

  combinedFuture(this: Mut<this>, combined: Combined): FutureType {
    const { kind, aggregate } = combined;
    if (combined.array !== undefined) {
      const given = this.givenBy(this.rec(combined.array).element as DynType);
      const kept = kind === "allSettled" ? this.settledType(given, undefined) : given;
      const frame: Field[] = [{ name: "state", type: "i32" }, { name: "futures", type: combined.array }, { name: "values", type: this.arrayType(kept) }, { name: "flags", type: this.arrayType("u8") }];
      const gives = kind === "all" || kind === "allSettled" ? this.arrayType(kept) : given;
      return this.makeCombinedFuture(combined, gives, kind === "any" ? aggregate : undefined, frame);
    }
    // Each future's slot keeps its value, its outcome for `allSettled`, or its error for `any`.
    const kept = combined.futures.map((f) => (kind === "allSettled" ? this.settledType(this.givenBy(f), this.thrownBy(f)) : kind === "any" ? (this.thrownBy(f) ?? "null") : this.givenBy(f)));
    let frame: Field[] = [{ name: "state", type: "i32" }];
    combined.futures.forEach((f, i) => {
      frame.push({ name: `future${i}`, type: f });
      frame.push({ name: `value${i}`, type: kept[i as usize]! });
      frame.push({ name: `done${i}`, type: "i32" });
    });
    let thrown: Type[] = [];
    for (const f of combined.futures) {
      const th = this.thrownBy(f);
      if (th !== undefined) thrown.push(th);
    }
    const allThrown = thrown.length > 0 ? this.unionType(thrown) : undefined;
    if (kind === "all") {
      const tuple = this.tupleType(kept);
      return this.makeCombinedFuture(combined, tuple, allThrown, frame);
    }
    if (kind === "allSettled") {
      const tuple = this.tupleType(kept);
      return this.makeCombinedFuture(combined, tuple, undefined, frame);
    }
    const gives = this.unionType(combined.futures.map((t) => this.givenBy(t)));
    if (kind === "race") return this.makeCombinedFuture(combined, gives, allThrown, frame);
    return this.makeCombinedFuture(combined, gives, aggregate, frame);
  }

  private promises = new Map<string, InterfaceType>();
  private promised = new TypeMap<InterfaceType, Type>();

  // `Promise<T>`: any future giving a `T` once awaited, as TypeScript's type of an async result is.
  promiseInterface(this: Mut<this>, t: Type): InterfaceType {
    const key = this.keyOf(t);
    let found = this.promises.get(key);
    if (found === undefined) {
      const shown = this.show(t);
      found = this.interfaceType(`Promise<${shown}>`);
      this.promises.set(key, found);
      this.promised.set(found, t);
    }
    return found;
  }

  // The boxed future a Dyn's async method gives: a `Promise<T>` that borrows the Dyn's value, so
  // it holds a reference, which keeps it from outliving the Dyn or crossing threads.
  private lent = new Map<string, InterfaceType>();
  borrowing = new TypeSet<InterfaceType>();

  lentPromise(this: Mut<this>, t: Type): DynType {
    const key = this.keyOf(t);
    let found = this.lent.get(key);
    if (found === undefined) {
      const shown = this.show(t);
      found = this.interfaceType(`Promise<${shown}>`);
      this.lent.set(key, found);
      this.promised.set(found, t);
      this.borrowing.add(found);
    }
    return this.dynType(found);
  }

  // Whether copies of a Dyn share its one value, as Rust's `Arc<dyn Trait>` does: so they may when
  // nothing through its interface changes or takes over the value. A boxed future never does,
  // since polling changes it.
  sharesDyn(t: DynType): boolean {
    const { of } = this.rec(t);
    return !this.promised.has(of) && this.generatorElement(of, true) === undefined && this.rec(of).methods.every((m) => m.mutable !== true && m.owned !== true);
  }

  // What a `Promise<T>` gives, when the interface is one.
  promiseElement(t: Type): Type | undefined {
    return this.recOf(t)?.kind === "interface" ? this.promised.get(t as InterfaceType) : undefined;
  }

  private regexes = new Map<string, RegexType>();

  regexType(this: Mut<this>, pattern: string, flags: string, captures: RegexRecord["captures"], source: string = pattern): RegexType {
    const key = `regex ${flags} ${pattern}`;
    let t = this.regexes.get(key);
    if (t === undefined) {
      t = this.made<RegexType>({ kind: "regex", source, pattern, flags, captures, fields: [] }, key);
      this.regexes.set(key, t);
    }
    return t;
  }

  // One per alias instance a program's types lead back to; the checker keeps them by instance.
  recursiveType(this: Mut<this>, name: string, args: Type[]): RecursiveType {
    const id = this.declared++;
    const t = this.made<RecursiveType>({ kind: "recursive", name, args, of: "never", fields: [] }, `recursive ${id}`);
    return t;
  }

  // The recursive type standing for a class or an enum instance, made once for it, so the one
  // made for another instance is found from the instance.
  private heldBlocks = new TypeMap<Exclude<Type, string>, RecursiveType>();
  blockFor(this: Mut<this>, t: ClassType | UnionType, args: Type[]): RecursiveType {
    let back = this.heldBlocks.get(t);
    if (back === undefined) {
      const shown = this.show(t);
      back = this.recursiveType(shown, args);
      this.heldBlocks.set(t, back);
      this.standsFor(back, t);
    }
    return back;
  }
  holdsBlock(this: Mut<this>, t: UnionType, back: RecursiveType) {
    this.heldBlocks.set(t, back);
  }

  // The same recursive type made with other type arguments, registered as the resolver makes it.
  private recursiveInstances = new Map<string, RecursiveType>();
  private recursiveNames = new TypeMap<RecursiveType, string>();
  needed: NeededInstance[] = [];
  noteRecursiveInstance(this: Mut<this>, name: string, key: string, t: RecursiveType) {
    this.recursiveNames.set(t, name);
    this.recursiveInstances.set(key, t);
  }
  private instanceRecursive(this: Mut<this>, t: RecursiveType, args: Type[]): RecursiveType {
    const name = this.recursiveNames.get(t);
    if (name === undefined) return t;
    const key = `${name}<${args.map((a) => this.keyOf(a)).join(",")}>`;
    const found = this.recursiveInstances.get(key);
    if (found !== undefined) return found;
    this.needed.push({ kind: "recursive", t, args });
    return t;
  }

  // A recursive type for other type arguments: a class's or an enum's is found from its instance,
  // `of` made with them, which makes the instance without reading its fields; an alias's is
  // remade by the checker.
  private remade(this: Mut<this>, t: RecursiveType, makeOf: (self: Mut<this>) => Type, args: Type[]): RecursiveType {
    const stands = this.rec(t).of;
    const kind = this.recOf(stands)?.kind;
    if (kind === "class" || (kind === "union" && this.heldBlocks.get(stands as UnionType) === t)) {
      const made = makeOf(this);
      const madeKind = this.recOf(made)?.kind;
      return madeKind === "class" || madeKind === "union" ? this.blockFor(made as ClassType | UnionType, args) : t;
    }
    return this.instanceRecursive(t, args);
  }

  // Whether a value of `type` lent where a type parameter is wanted is a part of a value whose type
  // holds itself, the parameter standing for that type: each instance checks it again.
  partOfItself(this: Mut<this>, type: Type, to: Type): boolean {
    const r = this.recOf(to);
    if (r?.kind !== "param" || r.concrete !== undefined || r.bound === undefined || this.lower(type) !== this.lower(r.bound)) return false;
    const bound = r.bound;
    const lowered = this.lower(type);
    return this.ties.has(bound) || this.holdsPart(bound, (u) => { const v = this.recOf(u); return v?.kind === "recursive" && v.of === lowered; });
  }

  // The part of a type that keeps `JSON.stringify` and `JSON.parse` from taking its values, or
  // undefined when every part is Json: booleans, numbers, strings and literals, and objects,
  // tuples, arrays, unions and string-keyed Maps of them, with the classes and data enums that
  // `json` says derive it. A class's `#private` fields aren't written, as in JavaScript.
  /** @throws {CompileError} */
  unjson(this: Mut<this>, t: Type, json: TypePred): Type | undefined {
    let seen = new TypeSet<Type>();
    return this.unjsonIn(t, json, seen);
  }

  // Walked with a stack of what is left to look at, in the order a recursive walk would take,
  // so `json` is called rather than handed on: each closure handed on would make another
  // instance of this method where Fish checks it.
  /** @throws {CompileError} */
  private unjsonIn(this: Mut<this>, start: Type, json: TypePred, seen: Mut<TypeSet<Type>>): Type | undefined {
    let stack: Type[] = [start];
    while (stack.length > 0) {
      const t = stack.pop()!;
      // JavaScript throws for a bigint, which JSON has no number for.
      if (typeof t === "string") {
        if (t === "void" || t === "never" || t === "bigint") return t;
        continue;
      }
      if (seen.has(t)) continue;
      seen.add(t);
      const r = this.rec(t);
      let parts: Type[] = [];
      switch (r.kind) {
        case "brand":
          parts = [r.base];
          break;
        case "literal":
        case "pattern":
        case "unknown":
          break;
        case "ref":
          parts = [r.to];
          break;
        case "recursive":
          parts = [r.of];
          break;
        case "param":
          if (r.concrete !== undefined) parts = [r.concrete];
          break;
        case "union":
          parts = r.members.slice();
          break;
        case "array":
        case "fixed":
          parts = [r.element];
          break;
        case "object":
          if (r.match === true) return t;
          parts = r.fields.map((f) => f.type);
          break;
        case "map":
          if (r.set || this.lower(r.key) !== "string") return t;
          parts = [r.value];
          break;
        case "class": {
          if (!json(t as ClassType)) return t;
          const base: Type[] = r.base !== undefined ? [r.base] : [];
          parts = [...base, ...r.fields.filter((f) => !f.name.startsWith("#")).map((f) => f.type)];
          break;
        }
        case "variant": {
          if (!json(t as VariantType)) return t;
          const of = this.recOf(this.rec(t as VariantType).of);
          const members: Type[] = of?.kind === "union" ? of.members : [t];
          for (const v of members) {
            const w = this.recOf(v);
            if (w?.kind === "variant") for (const f of w.fields) parts.push(f.type);
          }
          break;
        }
        default:
          return t;
      }
      for (let i = parts.length; i > 0; i--) stack.push(parts[i - 1]!);
    }
    return undefined;
  }

  // What reading a place of `t` gives: a recursive type, or a union's recursive members, as the
  // types they stand for, held in a value of their own rather than in a block.
  unfolded(this: Mut<this>, t: Type): Type {
    const r = this.recOf(t);
    if (r?.kind === "union" && r.members.some((m) => this.recOf(m)?.kind === "recursive")) return this.unionType(r.members.map((t) => this.unfold(t)), r.name);
    return this.unfold(t);
  }

  private pointers = new Map<string, PointerType>();

  pointerType(this: Mut<this>, to: Type, mutable: boolean): PointerType {
    const key = `${mutable ? "mutptr" : "ptr"} ${this.keyOf(to)}`;
    let t = this.pointers.get(key);
    if (t === undefined) {
      t = this.made<PointerType>({ kind: "pointer", to, mutable, fields: [] }, key);
      this.pointers.set(key, t);
    }
    return t;
  }

  private interned = new Map<string, ObjectType>();
  private literals = new Map<string, LiteralType>();
  private unions = new Map<string, UnionType>();
  private keys = new TypeMap<Exclude<Type, string>, string>();
  private declared = 0;

  // A new type: its record kept in the arena, and interned under `key` when it has one.
  private made<T extends Exclude<Type, string>>(this: Mut<this>, record: RecordOf<T>, key?: string): T {
    const t = (this.arena.size + 21) as T;
    this.arena.set(t as usize, record);
    if (key !== undefined) this.keys.set(t, key);
    return t;
  }

  // The record of the type with id `id`, if this program has one.
  typeOf(id: usize): TypeRecord | undefined {
    return this.arena.get(id);
  }

  // A class's key is unique to its declaration, since two programs may reuse a class name.
  classType(this: Mut<this>, name: string, generic?: ClassRecord["generic"]): ClassType {
    const id = this.declared++;
    const t = this.made<ClassType>({ kind: "class", name, fields: [], generic }, `class ${id}`);
    return t;
  }

  interfaceType(this: Mut<this>, name: string): InterfaceType {
    const id = this.declared++;
    const t = this.made<InterfaceType>({ kind: "interface", name, fields: [], methods: [] }, `interface ${id}`);
    return t;
  }

  generatorType(this: Mut<this>, name: string, concrete: boolean, async = false): GeneratorType {
    const id = this.declared++;
    const rec: GeneratorRecord = async ? { kind: "generator", name, yields: "never", fields: [], params: [], frame: [], concrete, async: true } : { kind: "generator", name, yields: "never", fields: [], params: [], frame: [], concrete };
    const t = this.made<GeneratorType>(rec, `generator ${id}`);
    return t;
  }

  // What `receiveFrom()` gives: a datagram's bytes and its sender, named as `sendTo` takes them.
  datagram(this: Mut<this>): ObjectType {
    const bytes = this.arrayType("u8");
    return this.objectType([{ name: "bytes", type: bytes }, { name: "host", type: "string" }, { name: "port", type: "i64" }]);
  }

  // What `next()` gives: the next value, or that the generator has finished.
  nextResult(this: Mut<this>, t: Type): Type {
    const falseType = this.literalType(false);
    const trueType = this.literalType(true);
    const next = this.objectType([{ name: "done", type: falseType }, { name: "value", type: t }]);
    const done = this.objectType([{ name: "done", type: trueType }]);
    return this.unionType([next, done]);
  }

  private generators = new Map<string, InterfaceType>();
  private elements = new TypeMap<InterfaceType, Type>();
  private sent = new TypeMap<InterfaceType, Type>();
  private asyncElements = new TypeMap<InterfaceType, Type>();

  // `Generator<T>`: anything whose `next()` gives `T`s, as TypeScript's type of a generator is.
  // `Generator<T, void, N>` is one whose `next(x)` takes `N`s too.
  generatorInterface(this: Mut<this>, t: Type, sends?: Type): InterfaceType {
    const key = sends === undefined ? this.keyOf(t) : `${this.keyOf(t)} sends ${this.keyOf(sends)}`;
    let found = this.generators.get(key);
    if (found === undefined) {
      const shown = sends === undefined ? `Generator<${this.show(t)}>` : `Generator<${this.show(t)}, void, ${this.show(sends)}>`;
      found = this.interfaceType(shown);
      const returns = this.nextResult(t);
      let ir = this.rec(found);
      ir.methods.push({ name: "next", params: [], returns });
      this.setRec(found, ir);
      this.generators.set(key, found);
      this.elements.set(found, t);
      if (sends !== undefined) this.sent.set(found, sends);
    }
    return found;
  }

  // `AsyncGenerator<T>`: anything whose awaited `next()` gives `T`s.
  asyncGeneratorInterface(this: Mut<this>, t: Type): InterfaceType {
    const key = `async ${this.keyOf(t)}`;
    let found = this.generators.get(key);
    if (found === undefined) {
      const shown = this.show(t);
      found = this.interfaceType(`AsyncGenerator<${shown}>`);
      const next = this.nextResult(t);
      const returns = this.promiseInterface(next);
      let ir = this.rec(found);
      ir.methods.push({ name: "next", params: [], returns });
      this.setRec(found, ir);
      this.generators.set(key, found);
      this.asyncElements.set(found, t);
    }
    return found;
  }

  // What a generator, or a type parameter standing for one or bounded by `Generator<T>`, yields.
  // `async` asks the same of an async generator and `AsyncGenerator<T>`.
  yieldsOf(t: Type, async = false): Type | undefined {
    if (typeof t === "string") return undefined;
    const r = this.rec(t);
    if (r.kind === "generator") return (r.async === true) === async ? r.yields : undefined;
    if (r.kind === "dyn") return async ? this.generatorElement(r.of, true) : undefined;
    if (r.kind === "param") return r.concrete !== undefined ? this.yieldsOf(r.concrete, async) : r.bound !== undefined ? this.generatorElement(r.bound, async) : undefined;
    return this.generatorElement(t, async);
  }

  // What a generator's `next(x)` takes, or a type parameter's standing for one or bounded by
  // `Generator<T, void, N>`.
  generatorSends(t: Type): Type | undefined {
    if (typeof t === "string") return undefined;
    const r = this.rec(t);
    if (r.kind === "generator") return r.sends;
    if (r.kind === "param") return r.concrete !== undefined ? this.generatorSends(r.concrete) : r.bound !== undefined ? this.generatorSends(r.bound) : undefined;
    return r.kind === "interface" ? this.sent.get(t as InterfaceType) : undefined;
  }

  // What advancing a generator, or a type parameter standing for one, may throw.
  generatorThrows(t: Type): Type | undefined {
    if (typeof t === "string") return undefined;
    const r = this.rec(t);
    if (r.kind === "generator") return r.throws;
    return r.kind === "param" && r.concrete !== undefined ? this.generatorThrows(r.concrete) : undefined;
  }

  private iterables = new TypeMap<InterfaceType, Type>();

  // `Iterable<T>`: anything `for...of` reads `T`s from. Its one method is a class's way to be one;
  // an array, a Map, a Set, a string and a generator are ones too.
  iterableInterface(this: Mut<this>, t: Type): InterfaceType {
    const key = `iterable ${this.keyOf(t)}`;
    let found = this.generators.get(key);
    if (found === undefined) {
      const shown = this.show(t);
      found = this.interfaceType(`Iterable<${shown}>`);
      const returns = this.generatorInterface(t);
      let ir = this.rec(found);
      ir.methods.push({ name: ITERATOR, params: [], returns });
      this.setRec(found, ir);
      this.generators.set(key, found);
      this.iterables.set(found, t);
    }
    return found;
  }

  // What an `Iterable<T>`, or a type parameter bounded by one, gives.
  iterableElement(t: Type): Type | undefined {
    const r = this.recOf(t);
    if (r?.kind === "param") return r.bound !== undefined ? this.iterableElement(r.bound) : undefined;
    return r?.kind === "interface" ? this.iterables.get(t as InterfaceType) : undefined;
  }

  // What `t` gives as an `Iterable<T>` without a method of its own: a generator's values, an array's
  // or a Set's members, a Map's `[key, value]` pairs, or a string's one-character strings.
  iteratedBy(this: Mut<this>, t: Type): Type | undefined {
    const bounded = this.iterableElement(t);
    if (bounded !== undefined) return bounded;
    const held = this.lower(t);
    if (held === "string") return "string";
    const r = this.recOf(held);
    if (r?.kind === "pattern" || (r?.kind === "literal" && typeof r.value === "string" && r.owner === undefined)) return "string";
    if (r?.kind === "generator") return r.async === true || r.throws !== undefined ? undefined : r.yields;
    if (r?.kind === "array" || r?.kind === "fixed") return r.element;
    if (r?.kind === "map" && r.dict !== true) return r.set ? r.key : this.tupleType([r.key, r.value]);
    return this.yieldsOf(held) ?? this.iterableElement(held);
  }

  // What a `Generator<T>`, or with `async` an `AsyncGenerator<T>`, yields, when the interface is one.
  generatorElement(t: Type, async = false): Type | undefined {
    return this.recOf(t)?.kind === "interface" ? (async ? this.asyncElements : this.elements).get(t as InterfaceType) : undefined;
  }

  functionType(this: Mut<this>, names: string[], params: Type[], returns: Type, throws?: Type): FunctionType {
    const name = this.signatureName(names, params, returns, throws);
    const id = this.declared++;
    const rec: FunctionRecord = throws !== undefined ? { kind: "function", name, names, params, returns, throws, fields: [] } : { kind: "function", name, names, params, returns, fields: [] };
    const t = this.made<FunctionType>(rec, `function ${id}`);
    return t;
  }

  private signatureName(this: Mut<this>, names: Ref<string[]>, params: Ref<Type[]>, returns: Type, throws: Type | undefined) {
    return `(${params.map((p, i) => `${names[i as usize]}: ${this.show(p)}`).join(", ")}) => ${this.show(returns)}${throws !== undefined ? ` throws ${this.show(throws)}` : ""}`;
  }

  closureType(this: Mut<this>, names: string[], params: Type[], returns: Type, fields: Field[], once: string | undefined, concrete: boolean, throws?: Type): ClosureType {
    const name = this.signatureName(names, params, returns, throws);
    const id = this.declared++;
    const rec: ClosureRecord = throws !== undefined ? { kind: "closure", name, params, returns, throws, fields, once, concrete } : { kind: "closure", name, params, returns, fields, once, concrete };
    const t = this.made<ClosureType>(rec, `closure ${id}`);
    return t;
  }

  private genericValues = new Map<string, ClosureType>();

  // The one type of a generic function used as a value, by the function's name.
  genericFunctionType(this: Mut<this>, name: string, shown: string): ClosureType {
    let t = this.genericValues.get(name);
    if (t === undefined) {
      t = this.made<ClosureType>({ kind: "closure", name: shown, params: [], returns: "void", fields: [], concrete: true, generic: name }, `generic function ${name}`);
      this.genericValues.set(name, t);
    }
    return t;
  }

  literalType(this: Mut<this>, value: string | bigint | boolean, owner?: LiteralRecord["owner"]): LiteralType {
    const kind = typeof value === "string" ? "string" : typeof value === "bigint" ? "bigint" : "boolean";
    const key = `literal ${kind} ${literalText(value)}${owner !== undefined ? ` of ${owner.enum}.${owner.member} ${owner.id}` : ""}`;
    let t = this.literals.get(key);
    if (t === undefined) {
      t = this.made<LiteralType>({ kind: "literal", value, fields: [], owner }, key);
      this.literals.set(key, t);
    }
    return t;
  }

  // A literal standing for a comptime value that isn't a string, number or boolean, such as a
  // tag's strings: interned by `key`, and never equal to an ordinary literal.
  standInLiteral(this: Mut<this>, key: string): LiteralType {
    const at = `stand-in ${key}`;
    let t = this.literals.get(at);
    if (t === undefined) {
      t = this.made<LiteralType>({ kind: "literal", value: key, fields: [] }, at);
      this.literals.set(at, t);
    }
    return t;
  }

  // Members are flattened, deduplicated and kept in one order, so equal unions are one type,
  // and a literal whose base type is also a member adds nothing. A single member is itself.
  // An enum's union carries the enum's name, for messages.
  unionType(this: Mut<this>, parts: Type[], name?: string): Type {
    // An `unknown` holds every other member already.
    const unknown = parts.find((p) => this.isUnknown(p));
    if (unknown !== undefined) return unknown;
    let flattened: Type[] = [];
    for (const p of parts) {
      const r = this.recOf(p);
      if (r?.kind === "union") for (const m of r.members) flattened.push(m);
      else flattened.push(p);
    }
    const allNever = flattened.every((q) => q === "never");
    let flat: Type[] = flattened.filter((p) => p !== "never" || allNever);
    // Regexes of different patterns are one `RegExp`, as every regex is a pointer to a program.
    const isRegex = (p: Type) => this.recOf(p)?.kind === "regex";
    if (new TypeSet<Type>(flat.filter((p) => isRegex(p))).size > 1) flat = flat.map((p): Type => (isRegex(p) ? ANY_REGEX : p));
    // Members of one value shape, like `{ a?: T }` and `{ a: T | null }`, are one member, spelled
    // as whichever sorts first.
    let seen = new Set<string>();
    const sorted = [...new TypeSet<Type>(flat.slice())]
      .filter((t) => {
        if (typeof t === "string") return true;
        const { kind } = this.rec(t);
        return (kind !== "literal" || !flat.includes(this.baseOf(t as LiteralType)!)) && (kind !== "pattern" || !flat.includes("string"));
      })
      .toSorted((a, b) => (this.keyOf(a) < this.keyOf(b) ? -1 : this.keyOf(a) > this.keyOf(b) ? 1 : 0));
    let members: Type[] = [];
    for (const t of sorted) {
      const shape = this.shapeKey(t);
      if (seen.has(shape)) continue;
      seen.add(shape);
      members.push(t);
    }
    if (members.length === 1) return members[0]!;
    const key = `union ${members.map((t) => this.keyOf(t)).join("|")}`;
    let t = this.unions.get(key);
    if (t === undefined) {
      t = this.made<UnionType>({ kind: "union", members, fields: [], name }, key);
      this.unions.set(key, t);
    }
    return t;
  }

  // The members of `union` a value of `type` can go into: the one it is, or else every one it
  // fits. The checker allows exactly one.
  membersFor(this: Mut<this>, type: Type, union: UnionType): Type[] {
    const { members } = this.rec(union);
    if (members.includes(type)) return [type];
    const fitting = members.filter((m) => this.fits(type, m));
    // A JS value goes into the union's JS value, whichever declared shape each has.
    const js = (t: Type) => { const r = this.recOf(t); return r?.kind === "block" && r.which === "JsValue"; };
    return fitting.length > 0 || !js(type) ? fitting : members.filter((m) => js(m));
  }

  // The one `unknown` type of this program.
  unknownType(this: Mut<this>): UnknownType {
    if (this.unknownId === undefined) {
      this.unknownId = this.made<UnknownType>({ kind: "unknown", name: "unknown", fields: [] }, "unknown");
    }
    return this.unknownId!;
  }

  isUnknown(t: Type | undefined): boolean {
    const r = this.recOf(t);
    return r?.kind === "unknown" || (r?.kind === "union" && r.unknown === true);
  }

  // Whether a value of `from` can be held by an `unknown`, noting the type it is held as. A type
  // parameter of a definition stands for nothing yet, and each instance checks its own argument.
  // A borrow, a function, a generator or a future can't be held, nor a value `console.log` can't
  // print, so that every unknown prints, nor a value holding an `unknown` in place, which would
  // make its layout hold itself.
  private storesUnknown(this: Mut<this>, from: Type): boolean {
    const r = this.recOf(from);
    if (r?.kind === "param") return r.concrete === undefined || r.within === true || this.storesUnknown(r.concrete);
    if (r?.kind === "union") return r.members.every((m) => this.storesUnknown(m));
    if (from === "void" || r?.kind === "interface" || r?.kind === "function" || r?.kind === "closure" || r?.kind === "generator" || r?.kind === "future" || r?.kind === "handle") return false;
    if (this.holdsRef(from) || this.holdsUnknownInPlace(from) || this.uninspectable(from) !== undefined) return false;
    const held = this.lower(r?.kind === "literal" ? (r.owner?.of ?? this.baseOf(from as LiteralType)) : r?.kind === "variant" && r.of !== undefined ? r.of : from);
    const heldMembers: Type[] = this.isUnknown(held) ? [] : (this.recOf(held)?.kind === "union" ? this.rec(held as UnionType).members : [held]);
    for (const m of heldMembers) this.intoUnknown.add(m);
    return true;
  }

  private holdsUnknownInPlace(t: Type): boolean {
    if (this.isUnknown(t)) return true;
    const r = this.recOf(t);
    if (r === undefined) return false;
    if (r.kind === "union") return r.members.some((m) => this.holdsUnknownInPlace(m));
    if (r.kind === "fixed") return this.holdsUnknownInPlace(r.element);
    if (r.kind === "class" && r.base !== undefined && this.holdsUnknownInPlace(r.base)) return true;
    return (r.kind === "object" || r.kind === "class" || r.kind === "variant") && r.fields.some((f) => this.holdsUnknownInPlace(f.type));
  }

  // Once every body is checked, `unknown` becomes the union of every type the program stores in
  // one, and of `null`, which an optional or defaulted `unknown` parameter is given when left out.
  closeUnknown(this: Mut<this>): void {
    if (this.unknownId === undefined) return;
    const id = this.unknownId as usize;
    const all = this.unionType([...this.intoUnknown, "null"]);
    const members = this.recOf(all)?.kind === "union" ? this.rec(all as UnionType).members : [all];
    this.arena.set(id, { kind: "union", members, fields: [], name: "unknown", unknown: true });
  }

  // Whether an `unknown` holding a `member` gives it where a `to` is read, after narrowing: as
  // itself, as a class it extends, or, for a number, as JavaScript's `number`, an f64.
  unknownGives(this: Mut<this>, member: Type, to: Type): boolean {
    if (member === to || this.isSubclass(member, to) || (to === "f64" && isNumeric(member))) return true;
    const r = this.recOf(to);
    return r?.kind === "union" && r.members.some((m) => this.unknownGives(member, m));
  }

  private unknownId?: UnknownType;
  private intoUnknown = new TypeSet<Type>();

  typeParameter(this: Mut<this>, name: string, bound: Bound | undefined, within?: Type): ParamType {
    const id = this.declared++;
    const rec: ParamRecord = within === undefined ? { kind: "param", name, bound, fields: [] } : { kind: "param", name, bound, fields: [], concrete: within, within: true };
    const t = this.made<ParamType>(rec, `param ${id}`);
    return t;
  }

  refType(this: Mut<this>, to: Type, mutable: boolean, life?: string): RefType {
    const key = `${mutable ? "mut" : "ref"} ${this.keyOf(to)}${life !== undefined ? ` ${life}` : ""}`;
    let t = this.refs.get(key);
    if (t === undefined) {
      t = this.made<RefType>({ kind: "ref", to, mutable, fields: [], life }, key);
      this.refs.set(key, t);
    }
    return t;
  }

  private refs = new Map<string, RefType>();

  fixedType(this: Mut<this>, element: Type, size: usize): FixedType {
    const key = `fixed ${size} ${this.keyOf(element)}`;
    let t = this.fixeds.get(key);
    if (t === undefined) {
      t = this.made<FixedType>({ kind: "fixed", element, size, fields: [] }, key);
      this.fixeds.set(key, t);
    }
    return t;
  }
  private fixeds = new Map<string, FixedType>();

  arrayType(this: Mut<this>, element: Type, typed?: TypedName): ArrayType {
    const key = `[${this.keyOf(element)}]${typed !== undefined ? typed : ""}`;
    let t = this.arrays.get(key);
    if (t === undefined) {
      const rec: ArrayRecord = typed !== undefined ? { kind: "array", element, fields: [], typed } : { kind: "array", element, fields: [] };
      t = this.made<ArrayType>(rec, key);
      this.arrays.set(key, t);
    }
    return t;
  }

  private arrays = new Map<string, ArrayType>();

  typedArray(this: Mut<this>, name: TypedName): ArrayType {
    return this.arrayType(typedElement(name), name);
  }

  // The name of the typed array a type is, if it is one.
  typedName(this: Mut<this>, t: Type): TypedName | undefined {
    const r = this.recOf(t);
    return r?.kind === "array" ? r.typed : undefined;
  }

  // Sets the type a recursive type stands for. An array is on the heap already, so where the
  // type reaches itself through one, that array holds the type itself rather than a block, and is
  // the array `Tree[]` means wherever it is written. The type then holds itself, a loop the walks
  // over types stop at by the recursive type kept for it.
  standsFor(this: Mut<this>, back: RecursiveType, of: Type) {
    let br = this.rec(back);
    br.of = of;
    this.setRec(back, br);
    // A Map that leads back holds the type inline too, as an array does, so a Map written with
    // the type is the one the type holds.
    const r = this.recOf(of);
    if (typeof of !== "string" && r?.kind !== "map") {
      for (const map of [...this.maps.values()]) {
        let m = this.rec(map);
        if (m.value !== back) continue;
        const mapKey = `${m.set ? "Set" : m.dict === true ? "Dict" : "Map"}<${this.keyOf(m.key)},${this.keyOf(of)}>`;
        m.value = of;
        this.setRec(map, m);
        this.maps.set(mapKey, map);
        this.ties.set(of, back);
      }
    }
    // An Rc, a Weak or a shared value already points at a block, so one that leads back holds the
    // type inline too, and is the one written with the type.
    if (typeof of !== "string") {
      for (const which of ["shared", "Rc", "Weak"] as const) {
        const held = this.shareds.get(`${which} ${this.keyOf(back)}`);
        if (held === undefined) continue;
        let hr = this.rec(held);
        hr.of = of;
        this.setRec(held, hr);
        this.shareds.set(`${which} ${this.keyOf(of)}`, held);
        this.ties.set(of, back);
      }
    }
    const array = this.arrays.get(`[${this.keyOf(back)}]`);
    // A type that is itself an array, as `type T = T[]`, has no other part to hold, so its
    // elements stay blocks.
    if (array === undefined || typeof of === "string" || r?.kind === "array") return;
    let ar = this.rec(array);
    ar.element = of;
    this.setRec(array, ar);
    this.arrays.set(`[${this.keyOf(of)}]`, array);
    this.ties.set(of, back);
    // Its members stay as they are too, so one narrowed to is still a member of it.
    if (r?.kind === "union") for (const m of r.members) if (typeof m !== "string" && this.rec(m).kind === "object") this.members.set(m, back);
  }

  // The type holding itself that each member of its union belongs to.
  private members = new TypeMap<Exclude<Type, string>, RecursiveType>();

  private ties = new TypeMap<Exclude<Type, string>, RecursiveType>();

  // The recursive type a type holding itself through an array was made with.
  tiedBy(t: Type): RecursiveType | undefined {
    return typeof t === "string" ? undefined : this.ties.get(t);
  }

  mapType(this: Mut<this>, key: Type, value: Type, set = false, dict?: true): MapType {
    const id = `${set ? "Set" : dict === true ? "Dict" : "Map"}<${this.keyOf(key)},${this.keyOf(value)}>`;
    let t = this.maps.get(id);
    if (t === undefined) {
      const rec: MapRecord = dict !== undefined ? { kind: "map", key, value, set, dict, fields: [] } : { kind: "map", key, value, set, fields: [] };
      t = this.made<MapType>(rec, id);
      this.maps.set(id, t);
    }
    return t;
  }

  private maps = new Map<string, MapType>();

  // The variant `member` of an enum declaration (by its unique id) with these type arguments.
  variantType(this: Mut<this>, enumName: string, id: usize, member: string, args: Type[], payload: Type[]): VariantType {
    const key = `variant ${id} ${member} <${args.map((t) => this.keyOf(t)).join(",")}>`;
    let t = this.variants.get(key);
    if (t === undefined) {
      const shown = args.length > 0 ? `${enumName}<${args.map((t) => this.show(t)).join(", ")}>` : enumName;
      t = this.made<VariantType>({ kind: "variant", name: `${shown}.${member}`, member, enum: enumName, fields: payload.map((type, i): Field => ({ name: String(i), type })), args });
      this.variants.set(key, t);
      this.variantIds.set(t, id);
      // A short key of its own, so an enum nested in itself doesn't double its key each level.
      this.keys.set(t, `variant#${this.variants.size}`);
    }
    return t;
  }

  private variants = new Map<string, VariantType>();
  private variantIds = new TypeMap<VariantType, usize>();

  // Whether a value of `t` holds a reference anywhere, which only lifetimes could keep valid. A
  // class met again inside itself adds nothing; one that contains itself is refused elsewhere.
  // Kept by id, and forgotten whenever a record changes or an interface is found to borrow.
  holdsRef(this: Ref<this>, t: Type): boolean {
    let seen = new TypeSet<Type>();
    return this.holdsRefIn(t, seen);
  }

  private holdsRefIn(t: Type, seen: Mut<TypeSet<Type>>): boolean {
    if (typeof t === "string" || seen.has(t)) return false;
    seen.add(t);
    const r = this.rec(t);
    if (r.kind === "ref" || (r.kind === "dyn" && this.borrowing.has(r.of))) return true;
    // A type parameter holds references when what it stands for, or its bound, does.
    if (r.kind === "param") return r.concrete !== undefined ? this.holdsRefIn(r.concrete, seen) : r.bound !== undefined && this.holdsRefIn(r.bound, seen);
    if (r.kind === "union") {
      for (const m of r.members) if (this.holdsRefIn(m, seen)) return true;
      return false;
    }
    if (r.kind === "recursive") return this.holdsRefIn(r.of, seen);
    if (r.kind === "array" || r.kind === "fixed") return this.holdsRefIn(r.element, seen);
    if (r.kind === "map") return this.holdsRefIn(r.value, seen);
    if (r.kind === "variant") {
      for (const f of r.fields) if (this.holdsRefIn(f.type, seen)) return true;
      return false;
    }
    if (r.kind === "class") {
      for (const f of r.fields) if (this.holdsRefIn(f.type, seen)) return true;
      return r.base !== undefined && this.holdsRefIn(r.base, seen);
    }
    // A generator borrows what its parameters do; its frame's own references point into itself.
    if (r.kind === "generator" || r.kind === "future") {
      for (const f of r.params) if (this.holdsRefIn(f.type, seen)) return true;
      return false;
    }
    if (r.kind === "object" || r.kind === "closure") {
      for (const f of r.fields) if (this.holdsRefIn(f.type, seen)) return true;
    }
    return false;
  }

  // The signatures of callbacks that run while a lock is held, so their bodies can't await; and
  // of those changing a shared value, whose interior-mutable parts others borrow unlocked.
  lockCallbacks = new TypeMap<FunctionType, string>();
  sharedCallbacks = new TypeSet<FunctionType>();
  // Those of an Rc's `update` and `read`, which only this thread runs.
  rcCallbacks = new TypeSet<FunctionType>();

  // A type parameter as an instance sees it: standing for `concrete`, which has no type
  // parameter in it.
  wrapped(this: Mut<this>, name: string, bound: Bound | undefined, concrete: Type): ParamType {
    const key = `param ${name} ${bound !== undefined ? this.keyOf(bound) : ""} as ${this.keyOf(concrete)}`;
    let t = this.wrappers.get(key);
    if (t === undefined) {
      t = this.made<ParamType>({ kind: "param", name, bound, fields: [], concrete }, key);
      this.wrappers.set(key, t);
    }
    return t;
  }

  private wrappers = new Map<string, ParamType>();

  // A type with each instance's type parameter replaced by the concrete type it stands for. A
  // generic class made from one becomes the class made from what it stands for.
  lower(this: Mut<this>, t: Type): Type {
    // A generic interface made from type parameters is the one made from what they stand for.
    if (typeof t === "string") return t;
    const r = this.rec(t);
    if (r.kind === "interface" && r.generic !== undefined && r.generic.args.some((a) => this.lower(a) !== a)) {
      const args = r.generic.args.map((t) => this.lower(t));
      return this.instanceInterface(t as InterfaceType, args);
    }
    if (r.kind === "dyn") {
      const ir = this.rec(r.of);
      if (ir.generic !== undefined && ir.generic.args.some((a) => this.lower(a) !== a)) {
        const of = this.lower(r.of) as InterfaceType;
        return this.dynType(of);
      }
      if (r.shown !== undefined) return this.dynType(r.of);
    }
    if (r.kind === "unknown" || (r.kind === "union" && r.unknown === true) || r.kind === "literal" || r.kind === "interface" || r.kind === "closure" || r.kind === "function" || r.kind === "generator" || r.kind === "future" || r.kind === "dyn" || r.kind === "regex") return t;
    if (r.kind === "param") return r.concrete !== undefined && r.within !== true ? this.lower(r.concrete) : t;
    if (r.kind === "pattern") return "string";
    if (r.kind === "brand") return r.base;
    if (r.kind === "pointer") {
      const to = this.lower(r.to);
      return this.pointerType(to, r.mutable);
    }
    if (r.kind === "handle") {
      if (r.joined !== undefined) {
        const base = this.lower(r.joined.base) as HandleType;
        return this.joinedType(base, r.joined.panic);
      }
      const gives = this.lower(r.gives);
      const throws = r.throws !== undefined ? this.lower(r.throws) : undefined;
      return this.handleType(gives, throws);
    }
    if (r.kind === "interior") {
      const of = this.lower(r.of);
      return this.interiorType(r.which, of);
    }
    if (r.kind === "shared") {
      const of = this.lower(r.of);
      return this.sharedType(of, r.which);
    }
    if (r.kind === "block") {
      const of = this.lower(r.of);
      return this.blockType(r.which, of);
    }
    if (r.kind === "map") {
      const key = this.lower(r.key);
      const value = this.lower(r.value);
      return this.mapType(key, value, r.set, r.dict);
    }
    if (r.kind === "recursive") {
      if (!r.args.some((a) => this.lower(a) !== a)) return t;
      const args = r.args.map((t) => this.lower(t));
      return this.remade(t as RecursiveType, (self) => self.lower(r.of), args);
    }
    // A type holding itself through an array is remade from its type arguments.
    const tied = this.ties.get(t);
    if (tied !== undefined) {
      const { args } = this.rec(tied);
      if (this.heldBlocks.get(t) !== tied) {
        if (!args.some((a) => this.lower(a) !== a)) return t;
        const loweredArgs = args.map((t) => this.lower(t));
        const inst = this.instanceRecursive(tied, loweredArgs);
        return this.rec(inst).of;
      }
    }
    const loop = this.members.get(t);
    if (loop !== undefined && !this.rec(loop).args.some((a) => this.lower(a) !== a)) return t;
    let found = this.lowered.get(t);
    if (found === undefined) {
      // A class keeps its brands, which a bound on its type parameters may ask for; its fields are
      // lowered where they are laid out.
      if (r.kind === "class") {
        if (r.generic !== undefined && r.generic.args.some((a) => this.lowerKeepingBrands(a) !== a)) {
          const keptArgs = r.generic.args.map((t) => this.lowerKeepingBrands(t));
          found = this.instanceClass(t as ClassType, keptArgs);
        } else {
          found = t;
        }
      } else if (r.kind === "ref") {
        const to = this.lower(r.to);
        found = this.refType(to, r.mutable, r.life);
      } else if (r.kind === "array") {
        const element = this.lower(r.element);
        found = this.arrayType(element);
      } else if (r.kind === "fixed") {
        const element = this.lower(r.element);
        found = this.fixedType(element, r.size);
      } else if (r.kind === "variant") {
        const loweredArgs = r.args.map((t) => this.lower(t));
        found = r.args.some((a, i) => loweredArgs[i as usize] !== a) ? this.instanceVariant(t as VariantType, loweredArgs) : t;
      } else if (r.kind === "object" && r.match === true) found = t;
      else if (r.kind === "object" && r.tuple === true) {
        const elements = this.elementsOf(t as ObjectType).map((u) => this.lower(u));
        const rest = r.rest === undefined ? undefined : this.lower(r.rest);
        found = this.retuple(t as ObjectType, elements, rest);
      } else if (r.kind === "union") {
        const members = r.members.map((t) => this.lower(t));
        found = this.unionType(members, r.name);
      } else {
        const fields = r.fields.map(({ optional: _, ...f }): Field => ({ ...f, type: this.lower(f.type) }));
        found = this.objectType(fields);
      }
      this.lowered.set(t, found);
    }
    return found;
  }

  private lowered = new TypeMap<Exclude<Type, string>, Type>();

  // Once every body is checked, what futures give and generators yield and take are laid out as
  // codegen holds values, a brand as its base; the checker kept the brands to check them.
  layOutForCodegen(this: Mut<this>): void {
    for (const id of [...this.arena.keys()]) {
      let r = this.arena.get(id)!;
      if (r.kind === "future") {
        r.gives = this.lower(r.gives);
        this.arena.set(id, r);
      } else if (r.kind === "generator") {
        r.yields = this.lower(r.yields);
        const sends = r.sends;
        if (sends !== undefined) r.sends = this.lower(sends);
        this.arena.set(id, r);
      }
    }
  }

  // A type lowered as `lower` does, except that its brands stay, through the forms that hold a
  // value directly: what a function type checks its arguments and result against.
  lowerKeepingBrands(this: Mut<this>, t: Type): Type {
    if (!this.holdsBrand(t)) return this.lower(t);
    const nonPrim = t as Exclude<Type, string>;
    const r = this.rec(nonPrim);
    const tied = this.ties.get(nonPrim);
    if (tied !== undefined) {
      const { args } = this.rec(tied);
      if (this.heldBlocks.get(nonPrim) !== tied) {
        if (!args.some((a) => this.lowerKeepingBrands(a) !== a)) return t;
        const keptArgs = args.map((a) => this.lowerKeepingBrands(a));
        const inst = this.instanceRecursive(tied, keptArgs);
        return this.rec(inst).of;
      }
    }
    const loop = this.members.get(nonPrim);
    if (loop !== undefined && !this.rec(loop).args.some((a) => this.lowerKeepingBrands(a) !== a)) return t;
    if (r.kind === "brand") return t;
    if (r.kind === "param" && r.concrete !== undefined && r.within !== true) return this.lowerKeepingBrands(r.concrete);
    if (r.kind === "union") {
      const members = r.members.map((m) => this.lowerKeepingBrands(m));
      return this.unionType(members, r.name);
    }
    if (r.kind === "array") {
      const element = this.lowerKeepingBrands(r.element);
      return this.arrayType(element);
    }
    if (r.kind === "fixed") {
      const element = this.lowerKeepingBrands(r.element);
      return this.fixedType(element, r.size);
    }
    if (r.kind === "ref") {
      const to = this.lowerKeepingBrands(r.to);
      return this.refType(to, r.mutable, r.life);
    }
    if (r.kind === "map") {
      const key = this.lowerKeepingBrands(r.key);
      const value = this.lowerKeepingBrands(r.value);
      return this.mapType(key, value, r.set, r.dict);
    }
    if (r.kind === "object" && r.tuple === true && r.match !== true) {
      const elements = this.elementsOf(t as ObjectType).map((e) => this.lowerKeepingBrands(e));
      const rest = r.rest === undefined ? undefined : this.lowerKeepingBrands(r.rest);
      return this.retuple(t as ObjectType, elements, rest);
    }
    if (r.kind === "object" && r.match !== true) {
      const fields = r.fields.map(({ optional: _, ...f }): Field => ({ ...f, type: this.lowerKeepingBrands(f.type) }));
      return this.objectType(fields);
    }
    if (r.kind === "class" && r.generic !== undefined) {
      if (!r.generic.args.some((a) => this.lowerKeepingBrands(a) !== a)) return t;
      const keptArgs = r.generic.args.map((a) => this.lowerKeepingBrands(a));
      return this.instanceClass(t as ClassType, keptArgs);
    }
    if (r.kind === "block") {
      const of = this.lowerKeepingBrands(r.of);
      return this.blockType(r.which, of);
    }
    if (r.kind === "interior") {
      const of = this.lowerKeepingBrands(r.of);
      return this.interiorType(r.which, of);
    }
    if (r.kind === "shared") {
      const of = this.lowerKeepingBrands(r.of);
      return this.sharedType(of, r.which);
    }
    return this.lower(t);
  }

  // Whether `replaced` would give `t` back unchanged under any swap of type parameters alone: it
  // holds no type parameter, nothing tied, and nothing `heldArgument` would box. Kept by id, and
  // forgotten whenever a record changes, since a record filled in later may gain such a part.
  private settled = new TypeMap<Exclude<Type, string>, boolean>();
  private unswappable(this: Mut<this>, t: Type): boolean {
    if (typeof t === "string") return true;
    const known = this.settled.get(t);
    if (known !== undefined) return known;
    const r = this.rec(t);
    let found: boolean;
    if (this.ties.has(t)) found = false;
    else if (r.kind === "object") found = r.match === true || (this.allUnswappable(r.fields.map((f) => f.type), false) && (r.rest === undefined || this.unswappable(r.rest)));
    else if (r.kind === "union") found = r.unknown !== true && this.allUnswappable(r.members, false);
    else if (r.kind === "array" || r.kind === "fixed") found = this.unswappable(r.element);
    else if (r.kind === "ref") found = this.unswappable(r.to);
    else if (r.kind === "map") found = this.unswappable(r.key) && this.allUnswappable([r.value], true);
    else if (r.kind === "class") found = r.generic === undefined || this.allUnswappable(r.generic.args, true);
    else if (r.kind === "variant") found = this.allUnswappable(r.args, true);
    else if (r.kind === "recursive") found = this.allUnswappable(r.args, false);
    else found = r.kind === "literal" || r.kind === "pattern" || r.kind === "brand" || r.kind === "regex" || r.kind === "pointer" || (r.kind === "block" && r.which !== "Channel");
    this.settled.set(t, found);
    return found;
  }

  // Whether every one of `ts` is unswappable; `held` when each is a type argument, which a
  // function or closure type never is unchanged, since `heldArgument` boxes it.
  private allUnswappable(this: Mut<this>, ts: Type[], held: boolean): boolean {
    for (const u of ts) {
      const kind = this.recOf(u)?.kind;
      if (held && (kind === "function" || kind === "closure")) return false;
      if (!this.unswappable(u)) return false;
    }
    return true;
  }

  // A type with some of its parts swapped for others, looking inside objects and unions.
  replaced(this: Mut<this>, t: Type, swap: Ref<TypeMap<Type, Type>>): Type {
    const found = swap.get(t);
    if (found !== undefined) return found;
    if (typeof t === "string") return t;
    if (this.unswappable(t) && [...swap.keys()].every((k) => this.recOf(k)?.kind === "param")) return t;
    const r = this.rec(t);
    if (r.kind === "class") {
      if (r.generic === undefined) return t;
      const args = r.generic.args.map((a) => {
        const rep = this.replaced(a, swap);
        return this.heldArgument(rep);
      });
      return args.some((a, i) => a !== r.generic!.args[i as usize]) ? this.instanceClass(t as ClassType, args) : t;
    }
    if (r.kind === "ref") {
      const to = this.replaced(r.to, swap);
      return this.refType(to, r.mutable, r.life);
    }
    if (r.kind === "interface" && r.generic !== undefined) {
      const args = r.generic.args.map((a) => {
        const rep = this.replaced(a, swap);
        return this.heldArgument(rep);
      });
      return args.some((a, i) => a !== r.generic!.args[i as usize]) ? this.instanceInterface(t as InterfaceType, args) : t;
    }
    if (r.kind === "function") {
      const params = r.params.map((p) => this.replaced(p, swap));
      const returns = this.replaced(r.returns, swap);
      const throws = r.throws !== undefined ? this.replaced(r.throws, swap) : undefined;
      if (!params.some((p, i) => p !== r.params[i as usize]) && returns === r.returns && throws === r.throws) return t;
      const made = this.functionType(r.names, params, returns, throws);
      // A generic one stays generic, the types around it it was written among replaced too.
      if (r.generic !== undefined) {
        const scope = new Map<string, Type>([...r.generic.scope].map(([n, x]): [string, Type] => [n, this.replaced(x, swap)]));
        let mr = this.rec(made);
        mr.name = `<${r.generic.names.join(", ")}>${mr.name}`;
        const own = r.generic.own.slice();
        const gen: Family = { names: r.generic.names.slice(), node: r.generic.node, scope, own };
        mr.generic = gen;
        this.setRec(made, mr);
      }
      return made;
    }
    // A stored callable is remade from the function type it was written as.
    const fn = r.kind === "dyn" ? this.callableOf.get(r.of) : undefined;
    if (fn !== undefined) {
      const made = this.replaced(fn, swap);
      return made === fn ? t : this.callableType(made as FunctionType);
    }
    if (r.kind === "array") {
      const element = this.replaced(r.element, swap);
      return this.arrayType(element, r.typed);
    }
    if (r.kind === "fixed") {
      const element = this.replaced(r.element, swap);
      return this.fixedType(element, r.size);
    }
    if (r.kind === "map") {
      const key = this.replaced(r.key, swap);
      const val = this.replaced(r.value, swap);
      const value = this.heldArgument(val);
      return this.mapType(key, value, r.set, r.dict);
    }
    // What a lock, a shared value or a channel holds is a type argument, boxed as one.
    if (r.kind === "interior" || r.kind === "shared" || (r.kind === "block" && r.which === "Channel")) {
      const rep = this.replaced(r.of, swap);
      const of = this.heldArgument(rep);
      if (of === r.of) return t;
      return r.kind === "interior" ? this.interiorType(r.which, of) : r.kind === "shared" ? this.sharedType(of, r.which) : this.blockType("Channel", of);
    }
    if (r.kind === "variant") {
      const args = r.args.map((a) => {
        const rep = this.replaced(a, swap);
        return this.heldArgument(rep);
      });
      return args.some((a, i) => a !== r.args[i as usize]) ? this.instanceVariant(t as VariantType, args) : t;
    }
    const tied = this.ties.get(t);
    if (tied !== undefined && this.heldBlocks.get(t as UnionType) !== tied) {
      const tiedArgs = this.rec(tied).args;
      const args = tiedArgs.map((a) => this.replaced(a, swap));
      if (!args.some((a, i) => a !== tiedArgs[i as usize])) return t;
      const inst = this.instanceRecursive(tied, args);
      return this.rec(inst).of;
    }
    if (r.kind === "recursive") {
      const args = r.args.map((a) => this.replaced(a, swap));
      return args.some((a, i) => a !== r.args[i as usize]) ? this.remade(t as RecursiveType, (self) => self.replaced(r.of, swap), args) : t;
    }
    if (r.kind !== "object" && r.kind !== "union") return t;
    if (r.kind === "object" && r.match === true) return t;
    if (r.kind === "object" && r.tuple === true) {
      const elements = this.elementsOf(t as ObjectType).map((e) => this.replaced(e, swap));
      const rest = r.rest === undefined ? undefined : this.replaced(r.rest, swap);
      return this.retuple(t as ObjectType, elements, rest);
    }
    if (r.kind === "union") {
      const members = r.members.map((m) => this.replaced(m, swap));
      return this.unionType(members, r.name);
    }
    const fields = r.fields.map((f) => ({ ...f, type: this.replaced(f.type, swap) }));
    return this.objectType(fields);
  }

  // The classes, interfaces and variants of generic enums lowering makes for other type
  // arguments, registered as the checker and resolver declare them.
  private classInstances = new Map<string, ClassType>();
  private interfaceInstances = new Map<string, InterfaceType>();
  noteClassInstance(this: Mut<this>, name: string, key: string, t: ClassType) {
    this.classInstances.set(`${name}<${key}>`, t);
  }
  noteInterfaceInstance(this: Mut<this>, name: string, key: string, t: InterfaceType) {
    this.interfaceInstances.set(`${name}<${key}>`, t);
  }
  private instanceClass(this: Mut<this>, c: ClassType, args: Type[]): ClassType {
    const name = this.rec(c).generic!.name;
    const key = `${name}<${args.map((a) => this.keyOf(a)).join(",")}>`;
    const found = this.classInstances.get(key);
    if (found !== undefined) return found;
    this.needed.push({ kind: "class", c, args });
    return c;
  }
  private instanceVariant(this: Mut<this>, v: VariantType, args: Type[]): VariantType {
    const id = this.variantIds.get(v);
    if (id !== undefined) {
      const key = `variant ${id} ${this.rec(v).member} <${args.map((a) => this.keyOf(a)).join(",")}>`;
      const found = this.variants.get(key);
      if (found !== undefined) return found;
    }
    this.needed.push({ kind: "variant", v, args });
    return v;
  }
  private instanceInterface(this: Mut<this>, t: InterfaceType, args: Type[]): InterfaceType {
    const name = this.rec(t).generic!.name;
    const key = `${name}<${args.map((a) => this.keyOf(a)).join(",")}>`;
    const found = this.interfaceInstances.get(key);
    if (found !== undefined) return found;
    this.needed.push({ kind: "interface", t, args });
    return t;
  }

  // A string that is the same exactly when two types are, for keying instances.
  keyOf(t: Type): string {
    return typeof t === "string" ? t : `{${this.keys.get(t) ?? ""}}`;
  }

  // `[A, B]`: laid out as an object of fields `0` and `1`, but a type of its own.
  // A readonly one, `readonly [A, B]`, has every position a readonly field.
  tupleType(this: Mut<this>, elements: Type[], required: usize = elements.length, rest?: Type, readonly = false): ObjectType {
    const key = `${readonly ? "readonly " : ""}tuple ${elements.map((t) => this.keyOf(t)).join(",")}${required < elements.length ? `?${required}` : ""}${rest === undefined ? "" : `...${this.keyOf(rest)}`}`;
    let t = this.interned.get(key);
    if (t === undefined) {
      let fields: Field[] = elements.map((type, i): Field => (readonly ? { name: String(i), type, readonly: true } : { name: String(i), type }));
      if (rest !== undefined) fields.push(readonly ? { name: "...", type: this.arrayType(rest), readonly: true } : { name: "...", type: this.arrayType(rest) });
      const shape = this.objectType(fields);
      t = this.made<ObjectType>({ kind: "object", fields: this.rec(shape).fields.map((f) => ({ ...f })), tuple: true, shape }, key);
      if (required < elements.length || rest !== undefined) {
        let tr = this.rec(t);
        if (required < elements.length) tr.required = required;
        if (rest !== undefined) tr.rest = rest;
        this.setRec(t, tr);
      }
      this.interned.set(key, t);
    }
    return t;
  }

  readonlyTuple(t: ObjectType): boolean {
    const fields = this.rec(t).fields;
    return fields.length > 0 && fields[0]!.readonly === true;
  }

  // `t.length` as a type: the count of a tuple with neither optional nor rest elements, which
  // only then is known while compiling.
  tupleLength(this: Mut<this>, t: ObjectType): Type {
    const r = this.rec(t);
    return r.required === undefined && r.rest === undefined && r.match !== true ? this.literalType(BigInt(r.fields.length)) : "usize";
  }

  // A readonly tuple's writable twin; any other type as it is.
  writable(this: Mut<this>, t: Type): Type {
    if (!this.isTuple(t) || !this.readonlyTuple(t as ObjectType)) return t;
    const { required, rest } = this.rec(t as ObjectType);
    const elements = this.elementsOf(t as ObjectType);
    const req = required ?? elements.length;
    return this.tupleType(elements, req, rest);
  }

  // The same tuple shape over mapped elements and rest.
  retuple(this: Mut<this>, t: ObjectType, elements: Type[], rest: Type | undefined): ObjectType {
    const { required } = this.rec(t);
    const req = required ?? elements.length;
    return this.tupleType(elements, req, rest, this.readonlyTuple(t));
  }

  // What `re.exec(s)` gives when it matches: the whole match and each capture, a capture that
  // may not take part being `string | null`, then where the match starts, the string matched, and,
  // when the pattern names groups, an object of them.
  matchType(this: Mut<this>, t: RegexType): ObjectType {
    const key = `match ${this.keys.get(t) ?? ""}`;
    let found = this.interned.get(key);
    if (found === undefined) {
      const maybe = this.unionType(["string", "null"]);
      const { captures } = this.rec(t);
      const names = [...new Set(captures.flatMap((c): string[] => (c.name === undefined ? [] : [c.name])))];
      // A name shared by groups in different alternatives holds whichever took part.
      const named = names.map((name): Field => {
        const groups = captures.filter((c) => c.name === name);
        return { name, type: groups.length === 1 && !groups[0]!.optional ? "string" as Type : maybe };
      });
      const groupsField: Field[] = named.length > 0 ? [{ name: "groups", type: this.objectType(named) }] : [];
      const fields: Field[] = [
        { name: "0", type: "string" },
        ...captures.map((c, i) => ({ name: String(i + 1), type: c.optional ? maybe : "string" as Type })),
        { name: "index", type: "i64" },
        { name: "input", type: "string" },
        ...groupsField,
      ];
      const shape = this.objectType(fields);
      found = this.made<ObjectType>({ kind: "object", fields: this.rec(shape).fields.map((f) => ({ ...f })), tuple: true, match: true, shape }, key);
      this.interned.set(key, found);
    }
    return found;
  }

  objectType(this: Mut<this>, fields: Field[]): ObjectType {
    const sorted = fields.toSorted((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    // A nested key is braced, so `{ a: { x }; y }` and `{ a: { x; y } }` get different keys.
    const key = sorted.map((f) => `${f.readonly === true ? "readonly " : ""}${JSON.stringify(f.name)}${f.optional !== undefined ? `?${f.optional}` : ""}:${this.keyOf(f.type)}`).join(",");
    let t = this.interned.get(key);
    if (t === undefined) {
      // Its fields are its own, so no other type holds one of them.
      t = this.made<ObjectType>({ kind: "object", fields: sorted.map((f) => ({ ...f })) }, key);
      this.interned.set(key, t);
    }
    return t;
  }

  // A key that is the same exactly when two types' values have one shape: like `keyOf`, but
  // blind to which fields are marked optional, so `{ a?: T }` and `{ a: T | null }` share one.
  shapeKey(this: Mut<this>, t: Type): string {
    if (typeof t === "string") return t;
    if (this.ties.has(t)) return this.keyOf(t);
    let found = this.shapeKeys.get(t);
    if (found === undefined) {
      const r = this.rec(t);
      if (r.kind === "object" && r.tuple === true) found = `${this.readonlyTuple(t as ObjectType) ? "readonly " : ""}[${this.elementsOf(t as ObjectType).map((t) => this.shapeKey(t)).join(",")}${r.required === undefined ? "" : `?${r.required}`}${r.rest === undefined ? "" : `...${this.shapeKey(r.rest)}`}]`;
      else if (r.kind === "object") found = `{${r.fields.map((f) => `${f.readonly === true ? "readonly " : ""}${JSON.stringify(f.name)}:${this.shapeKey(f.type)}`).join(",")}}`;
      else if (r.kind === "array") found = `${this.shapeKey(r.element)}[]`;
      else if (r.kind === "fixed") found = `FixedArray<${this.shapeKey(r.element)},${r.size}>`;
      else if (r.kind === "map") found = r.set ? `Set<${this.shapeKey(r.key)}>` : `${r.dict === true ? "Dict" : "Map"}<${this.shapeKey(r.key)},${this.shapeKey(r.value)}>`;
      else if (r.kind === "union") found = `(${r.members.map((t) => this.shapeKey(t)).join("|")})`;
      else if (r.kind === "ref") found = `${r.mutable ? "mut" : "ref"} ${this.shapeKey(r.to)}${r.life !== undefined ? ` ${r.life}` : ""}`;
      // A type parameter standing for a concrete type has that type's shape.
      else if (r.kind === "param" && r.concrete !== undefined) return this.shapeKey(r.concrete);
      else if (r.kind === "class" && r.generic !== undefined) found = `${r.generic.name}<${r.generic.args.map((t) => this.shapeKey(t)).join(",")}>`;
      else found = this.keyOf(t);
      this.shapeKeys.set(t, found);
    }
    return found;
  }
  private shapeKeys = new TypeMap<Exclude<Type, string>, string>();

  // A type without the empty value an optional field adds.
  withoutNull(this: Mut<this>, t: Type): Type {
    const r = this.recOf(t);
    return r?.kind === "union" ? this.unionType(r.members.filter((m) => m !== "null")) : t;
  }

  // A field written `name?: T`: its type holds the empty value, and it remembers whether `?` added it.
  optionalField(this: Mut<this>, name: string, written: Type): Field {
    const r = this.recOf(written);
    const held = written === "null" || (r?.kind === "union" && r.members.includes("null"));
    const optional: "held" | "added" = held ? "held" : "added";
    const type = held ? written : this.unionType([written, "null"]);
    return { name, type, optional };
  }

  // Whether a value of `from` fits where `to` is declared: the same type, or an object or
  // instance with at least the fields of the object type `to`, each fitting in turn.
  private assumed = new Set<string>();

  fits(this: Mut<this>, from: Type, to: Type): boolean {
    // A string literal fits a pattern it matches; a pattern is a string. Both are strings once
    // lowered, so this comes first.
    const fr = this.recOf(from);
    const tr = this.recOf(to);
    const target = tr?.kind === "param" && tr.concrete !== undefined ? tr.concrete : to;
    if (from !== target && this.recOf(target)?.kind === "pattern") {
      if (fr?.kind === "union") return fr.members.every((m) => this.fits(m, target));
      return fr?.kind === "literal" && typeof fr.value === "string" && fr.owner === undefined && this.textFits(fr.value, target);
    }
    // In an instance, a type parameter and the concrete type it stands for are one value.
    if (from === to || this.sameLowered(from, to) || from === "never" || this.sameCallable(from, to)) return true;
    if (this.isUnknown(target)) return this.storesUnknown(from);
    // So does a value of a type parameter fit as what it stands for, a literal as its base type.
    if (fr?.kind === "param" && fr.concrete !== undefined && this.fits(fr.concrete, to)) return true;
    // A future fits the `Promise<T>` describing it, as an async function's result.
    if (tr?.kind === "interface" && this.promised.has(to as InterfaceType) && fr?.kind === "future") return fr.throws === undefined && this.lower(fr.gives) === this.lower(this.promised.get(to as InterfaceType)!);
    // A reference reads the value where it lives, so it fits only a reference to the same type;
    // a mutable one also lends itself as shared. Lifetimes are checked on their own.
    // A reference into a recursive type's block is one to the type it stands for.
    if (tr?.kind === "ref") {
      return fr?.kind === "ref" && (fr.mutable || !tr.mutable) && this.lower(this.unfold(fr.to)) === this.lower(tr.to);
    }
    // Any regex is a `RegExp`; all of them are the same pointer to a program.
    if (to === ANY_REGEX) return fr !== undefined && (fr.kind === "regex" || (fr.kind === "param" && this.recOf(fr.bound)?.kind === "regex"));
    // A `MutPtr<T>` may be used as a `Ptr<T>`, as Rust's `*mut T` coerces to `*const T`.
    if (tr?.kind === "pointer") {
      return fr?.kind === "pointer" && (fr.mutable || !tr.mutable) && this.lower(fr.to) === this.lower(tr.to);
    }
    // A recursive type is the type it stands for. Its type holds it again, so a pair being
    // compared is taken to fit while its parts are.
    // A union holding the recursive type itself takes it as it is.
    const held = tr?.kind === "union" && tr.members.includes(from);
    if (!held && (fr?.kind === "recursive" || tr?.kind === "recursive")) {
      const pair = `${this.keyOf(from)} ${this.keyOf(to)}`;
      if (this.assumed.has(pair)) return true;
      this.assumed.add(pair);
      try {
        return this.fits(this.unfold(from), this.unfold(to));
      } finally {
        this.assumed.delete(pair);
      }
    }
    // A brand fits one of the same kind whose tag its tag fits, as `Brand<usize, "A">` fits
    // `Brand<usize, string>`; its base fits only a loose one.
    if (tr?.kind === "brand") {
      if (fr?.kind === "brand") return fr.base === tr.base && (fr.unit === undefined) === (tr.unit === undefined) && fr.field === tr.field && (fr.loose !== true || tr.loose === true) && this.fits(fr.tag, tr.tag);
      return tr.loose === true && (from === tr.base || (fr?.kind === "literal" && fr.owner === undefined && this.baseOf(from as LiteralType) === tr.base));
    }
    if (tr?.kind === "union") {
      if (fr?.kind === "union") return fr.members.every((m) => this.fits(m, to));
      return tr.members.some((m) => this.fits(from, m));
    }
    // A union fits where every member it may hold does, as an enum fits an i64.
    if (fr?.kind === "union") return fr.members.every((m) => this.fits(m, to));
    if (fr?.kind === "brand") return this.fits(fr.base, to);
    if (fr?.kind === "pattern") return to === "string";
    if (fr?.kind === "literal") return this.baseOf(from as LiteralType) === to;
    // A closure fits a function type taking the same parameters, or the first of them, and
    // returning what it returns, or anything when it returns nothing.
    // A parameter of a function type fits through its signature.
    if (tr?.kind === "function") {
      const given = fr?.kind === "param" && fr.bound !== undefined && this.rec(fr.bound).kind === "function" ? fr.concrete ?? fr.bound : from;
      // A stored callable fits by the function type it was written as.
      const g = this.recOf(given);
      const fn = g?.kind === "dyn" ? this.callableOf.get(g.of) : undefined;
      const callable = fn !== undefined;
      const sig = this.recOf(fn !== undefined ? fn : given);
      // A stored callable's call passes all its parameters, so it takes exactly as many.
      if (callable && sig?.kind === "function" && sig.params.length !== tr.params.length) return false;
      // What it throws fits what the type throws, and one throwing nothing fits any.
      const throws = sig?.kind === "closure" || sig?.kind === "function" ? sig.throws : undefined;
      const caught = throws === undefined || (tr.throws !== undefined && this.fits(throws, tr.throws));
      return (sig?.kind === "closure" || sig?.kind === "function") && sig.params.length <= tr.params.length
        && sig.params.every((p, i) => this.sameKept(p, tr.params[i as usize]!) || this.sameCallable(p, tr.params[i as usize]!)) && (tr.returns === "void" || this.fits(sig.returns, tr.returns)) && caught;
    }
    if (fr?.kind === "ref") return false;
    // A tuple fits only a tuple of its length, element by element.
    if (this.isTuple(from) || this.isTuple(to)) {
      if (!this.isTuple(from) || !this.isTuple(to)) return false;
      const a = this.rec(from as ObjectType);
      const b = this.rec(to as ObjectType);
      // A tuple fits one of its shape, giving at least the elements that one requires.
      const shaped = a.fields.length === b.fields.length && (a.rest === undefined) === (b.rest === undefined);
      return shaped && (a.required ?? a.fields.length) >= (b.required ?? b.fields.length) && b.fields.every((f) => this.fits(this.field(from as ObjectType, f.name)!.type, f.type));
    }
    // An interface is satisfied by members, which only the checker can look up.
    if (typeof from === "string" || tr?.kind !== "object" || fr?.kind === "interface") return false;
    // A type parameter fits through its bound's fields, as any instance of it would.
    // A value may leave out a field whose type is an Option.
    return tr.fields.every((f) => {
      const found = this.field(from, f.name);
      // An optional `unknown` holds null when left out, as its `| null` is part of it.
      if (found === undefined) return this.isOption(f.type) || (f.optional !== undefined && this.isUnknown(f.type));
      return (found.access ?? "public") === "public" && this.fits(found.type, f.type);
    });
  }

  // A field, by its path, that a value of `from` holds read-only but `to` lets be written: lent
  // mutably as a `to`, it could be changed. A readonly field only fits a writable one by copy.
  unlocks(this: Mut<this>, from: Type, to: Type, path = ""): string | undefined {
    from = this.lower(from);
    const tr = this.recOf(to);
    if (typeof from === "string" || (tr?.kind !== "object" && tr?.kind !== "interface")) return undefined;
    for (const f of tr.fields) {

      const found = this.field(from, f.name);
      if (found === undefined) continue;
      if (found.readonly === true && f.readonly !== true) return `${path}${f.name}`;
      const deeper = this.unlocks(found.type, f.type, `${path}${f.name}.`);
      if (deeper !== undefined) return deeper;
    }
    return undefined;
  }

  // The instance each closure, future and generator type is made for: what tells it apart from
  // others of its signature, which show alike.
  madeFor = new TypeMap<Exclude<Type, string>, string>();
  private describing = false;

  // `show`, but with closures, futures and generators anywhere in the type named by the instance
  // each is made for, for naming what is generated for a type the same way in every program.
  described(this: Mut<this>, t: Type): string {
    const was = this.describing;
    this.describing = true;
    try {
      return this.show(t);
    } finally {
      this.describing = was;
    }
  }

  // How a type reads in a diagnostic, as TypeScript would print it.
  show(this: Mut<this>, t: Type): string {
    if (t === "f64") return "number";
    if (typeof t === "string") return t;
    if (this.describing && this.madeFor.has(t)) return this.madeFor.get(t)!;
    // A type holding itself is shown by its name.
    const tied = this.ties.get(t);
    if (tied !== undefined) return this.describing ? `part of ${this.rec(tied).name}` : this.rec(tied).name;
    const r = this.rec(t);
    if (r.kind === "literal" && r.owner !== undefined) return `${r.owner.enum}.${r.owner.member}`;
    if (r.kind === "literal") return typeof r.value === "string" ? JSON.stringify(r.value) : literalText(r.value);
    if (r.kind === "pattern") {
      const text = (q: string) => q.replaceAll("\\", "\\\\").replaceAll("`", "\\`").replaceAll("${", "\\${");
      return `\`${r.quasis.map((q, i) => (i === 0 ? text(q) : `\${${this.show(r.holes[(i - 1) as usize]!)}}${text(q)}`)).join("")}\``;
    }
    if (r.kind === "union") return r.name ?? r.members.map((t) => this.show(t)).join(" | ");
    if (r.kind === "brand") return r.field !== undefined ? `${this.show(r.base)} & { ${r.field}${r.loose === true ? "?" : ""}: ${this.show(r.tag)} }` : `${r.unit !== undefined ? "Unit" : "Brand"}<${this.show(r.base)}, ${this.show(r.tag)}>`;
    if (r.kind === "ref") return `${r.mutable ? "Mut" : "Ref"}<${this.show(r.to)}>`;
    if (r.kind === "pointer") return `${r.mutable ? "MutPtr" : "Ptr"}<${this.show(r.to)}>`;
    if (r.kind === "regex") return "RegExp";
    if (r.kind === "array" && r.typed !== undefined) return r.typed;
    if (r.kind === "array") {
      const e = r.element;
      const er = this.recOf(e);
      const wrap = er !== undefined && ((er.kind === "union" && er.name === undefined) || er.kind === "function" || er.kind === "closure" || (er.kind === "dyn" && this.callableOf.has(er.of)));
      return wrap ? `(${this.show(e)})[]` : `${this.show(e)}[]`;
    }
    if (r.kind === "fixed") return `FixedArray<${this.show(r.element)}, ${r.size}>`;
    if (r.kind === "map") return r.set ? `Set<${this.show(r.key)}>` : r.dict === true ? `{ [key: string]: ${this.show(r.value)} }` : `Map<${this.show(r.key)}, ${this.show(r.value)}>`;
    if (r.kind === "generator") return `${r.async === true ? "Async" : ""}Generator<${this.show(r.yields)}>${r.throws !== undefined ? ` throws ${this.show(r.throws)}` : ""}`;
    if (r.kind === "future") return `Promise<${this.show(r.gives)}>${r.throws !== undefined ? ` throws ${this.show(r.throws)}` : ""}${this.describing ? ` ${r.name}(${r.frame.map((f) => this.show(f.type)).join(", ")})` : ""}`;
    if (r.kind === "interior") return `${r.which}<${this.show(r.of)}>`;
    if (r.kind === "shared") return `${r.which}<${this.show(r.of)}>`;
    // A JS handle shows the shape its declaration gives it.
    // A package's shape is shown by the name the package gives it, not the one linking gave it.
    if (r.kind === "block") return r.which === "Channel" ? `Channel<${this.show(r.of)}>` : r.which === "JsValue" && r.of !== "void" ? this.show(r.of).replace(/-fsh\d+/g, "") : r.which;
    if (r.kind === "dyn") return !this.describing && (this.callableOf.has(r.of) || this.promised.has(r.of)) ? r.shown ?? this.rec(r.of).name : `Dyn<${this.rec(r.of).name}>`;
    if (r.kind === "recursive" && this.describing) return `recursive ${r.name}`;
    if (r.kind === "handle") return `${r.joined !== undefined ? "Promise" : "JoinHandle"}<${this.show(r.gives)}>${r.throws !== undefined ? ` throws ${this.show(r.throws)}` : ""}`;
    if (r.kind !== "object") return r.name;
    if (r.match === true && !this.describing) return "RegExpExecArray";
    if (r.tuple === true && r.match !== true) {
      const req = r.required ?? r.fields.length;
      const elems = this.elementsOf(t as ObjectType).map((e, i) => {
        if ((i as usize) < req) return this.show(e);
        const w = this.withoutNull(e);
        return `${this.show(w)}?`;
      });
      let restPart: string[] = [];
      if (r.rest !== undefined) {
        const restArr = this.arrayType(r.rest);
        restPart = [`...${this.show(restArr)}`];
      }
      return `${this.readonlyTuple(t as ObjectType) ? "readonly " : ""}[${[...elems, ...restPart].join(", ")}]`;
    }
    if (r.fields.length === 0) return "{}";
    const name = (n: string) => (/^[A-Za-z_$][\w$]*$/.test(n) ? n : JSON.stringify(n));
    return `{ ${r.fields.map((f) => {
      const inner = f.optional === "added" ? this.withoutNull(f.type) : f.type;
      return `${f.readonly === true ? "readonly " : ""}${name(f.name)}${f.optional !== undefined && f.optional !== "undefined" ? "?" : ""}: ${this.show(inner)}`;
    }).join("; ")} }`;
  }
}

// An instance of a generic class, interface, enum variant or recursive alias that `replaced`
// needed before the checker or resolver had declared it.
export type NeededInstance =
  | { kind: "class"; c: ClassType; args: Type[] }
  | { kind: "interface"; t: InterfaceType; args: Type[] }
  | { kind: "variant"; v: VariantType; args: Type[] }
  | { kind: "recursive"; t: RecursiveType; args: Type[] };
