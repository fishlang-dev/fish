import type { CompileError } from "./diag.ts";
import type { Expr } from "./parser.ts";
import { WeakNodeMap, type Id } from "./nodes.ts";
import type { RustClass } from "./rust.ts";

// The checker's types. Object types are interned, so two types are structurally identical,
// the same fields with the same types in any order, exactly when they are the same object.

// A class member that isn't public is reachable only from inside its class, and never
// counts toward a structural fit, as in TypeScript.
export type Access = "public" | "private" | "protected";

// A readonly field can't be written after construction, at any depth.
// `optional` marks a field written `name?: T`, whose type holds `null` for the value left out:
// "added" when `?` added it, "held" when T already held it, so `Required` removes only the first.
// "undefined" marks a field spelled `T | undefined`, which may be left out like an optional one,
// and which printing and JSON leave out while it is empty.
export type Field = { name: string; type: Type; access?: Access; readonly?: boolean; optional?: "added" | "held" | "undefined" };

// Fields are sorted by name, which is also their order in memory.
// A tuple is an object whose fields are its positions, `0`, `1` and on, marked `tuple`.
// A regex match is a tuple of its captures with `index`, `input` and `groups` beside them.
// A tuple with optional elements has `required`, the count before them; each optional one holds
// `T | null`. A tuple ending in `...T[]` has `rest`, T, and holds those elements as an array in
// its field `...`.
export type ObjectType = { kind: "object"; typeId: usize; fields: Field[]; tuple?: true; match?: true; required?: usize; rest?: Type };

// A class is nominal: one object per declaration, so `===` is identity. Its own fields are in
// declaration order, filled in once resolved, and follow the base it embeds in memory.
// An instance of a generic class also records the class it came from and its type arguments.
// `rust`: the Rust type a class a Rust module declares stands for. An abstract class only ever
// exists embedded in a concrete one, so it is never a value's type.
export type ClassType = { kind: "class"; typeId: usize; name: string; fields: Field[]; base?: ClassType; generic?: { name: string; args: Type[] }; rust?: RustClass; abstract?: true };

// An interface is a trait: fields and method signatures that any value with those members
// satisfies. It describes values but is never one, so it never reaches codegen. Its members
// are filled in once resolved.
// An interface's method; `mutable` and `owned` when it declares `this: Mut<this>` or
// `this: Own<this>`, which a call through a Dyn must allow for.
// A generic method, `map<U>(f: (x: T) => U): U`, keeps its type parameters' names and the node it
// was written as, as a generic function type does, each call resolving it.
// `optional`: which parameters are written with `?`, kept for JS, which tells left out from null.
// `throws`: what a stored callable's call may throw.
export type Method = { name: string; params: Type[]; returns: Type; throws?: Type; mutable?: boolean; owned?: boolean; generic?: Family; optional?: boolean[] };
// A generic interface's instance knows the interface and the type arguments it was made from.
export type InterfaceType = { kind: "interface"; typeId: usize; name: string; fields: Field[]; methods: Method[]; generic?: { name: string; args: Type[] } };

// A type parameter: it stands for any type satisfying its bound, and offers only the bound's
// fields. At the definition it stands for nothing in particular. In an instance it also holds
// the concrete type it stands for, so the instance checks exactly as the definition did while
// codegen lays the value out as its concrete type; `lower` removes it before codegen.
export type ParamType = { kind: "param"; typeId: usize; name: string; bound: Bound | undefined; fields: Field[]; concrete?: Type };

// A literal type has one value, known at compile time, so on its own it takes no space: it
// has no fields. An integer or boolean literal fits its base type; a string literal has none yet.
// An enum's member is a literal that knows its enum, so a plain literal is never one.
export type LiteralType = {
  kind: "literal"; typeId: usize; value: string | bigint | boolean; fields: Field[];
  // For an enum's member: the enum, unique to its declaration, and the enum's own type.
  owner?: { enum: string; member: string; id: usize; of?: Type };
};

// A union holds a value of one of its members: a tag naming which, then that member's value.
// It has no fields; reaching into one takes narrowing to a member first.
export type UnionType = { kind: "union"; typeId: usize; members: Type[]; fields: Field[]; name?: string };

// A borrow of a value that lives elsewhere: `Ref<T>` shared, `Mut<T>` mutable. It is a pointer
// to the value, reads through to it, and copies like a pointer. A written lifetime names the
// function's lifetime parameter it lives for; it is checked, then erased.
export type RefType = { kind: "ref"; typeId: usize; to: Type; mutable: boolean; fields: Field[]; life?: string };

// A member of a data-carrying enum: a nominal value holding positional fields named `0`, `1`,
// ..., laid out as an object's. One per enum instance and member, so `===` is identity. A
// generic enum's variant knows the enum's type arguments, to be made again from lowered ones.
export type VariantType = {
  kind: "variant"; typeId: usize; name: string; member: string; enum: string; fields: Field[]; args: Type[];
  // The enum it belongs to, a union of its variants, once the enum is made.
  of?: Type;
};

// An owned array of elements of one type, growable like Rust's Vec. One per element type, so
// `===` is identity. It has no fields; its length and elements are reached by name and index.
export type ArrayType = { kind: "array"; typeId: usize; element: Type; fields: Field[] };

// `FixedArray<T, N>`: exactly `size` elements stored inline, laid out as `[size x T]`; interned,
// so `===` is identity.
export type FixedType = { kind: "fixed"; typeId: usize; element: Type; size: usize; fields: Field[] };
// `Map<K, V>` and `Set<T>` (a Set's value is `void`): a pointer to an owned hash table in the
// runtime, its entries kept in insertion order.
export type MapType = { kind: "map"; typeId: usize; key: Type; value: Type; set: boolean; fields: Field[] };

// A closure: an arrow function and what it captures. Each arrow, in each instance of the body
// it is written in, is its own type, so `===` is identity. Its value is its captures, laid out
// as its fields, which are never read by name.
// A closure that moves a captured value out of itself can run only once; `once` names one. A
// closure made in a generic body's definition check is never compiled, so it isn't concrete.
// A generic function used as a value, `generic` naming it, is a closure capturing nothing whose
// calls each instantiate that function, as calls of it by name do.
// `throws` is what a call of it may throw; an async arrow's error is its future's instead.
export type ClosureType = { kind: "closure"; typeId: usize; name: string; params: Type[]; returns: Type; throws?: Type; fields: Field[]; once?: string; concrete: boolean; generic?: string };

// A function type: the signature a closure must have to be passed where it is declared. Like an
// interface, it describes values without being one, so it never reaches codegen.
// A generic one, `<T>(x: T) => T`, is a family: `generic` holds its type parameters' names and
// the node it was written as, each call resolving it for that call's types.
// The type parameters around it, `scope`, are those it was written among; `own` are its type
// parameters' placeholders, in order, for comparing it with another.
export type Family = { names: string[]; node: unknown; scope: Map<string, Type>; own: Type[] };
export type FunctionType = { kind: "function"; typeId: usize; name: string; names: string[]; params: Type[]; returns: Type; throws?: Type; fields: Field[]; generic?: Family };

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

export const isInteger = (t: Type): t is Integer => typeof t === "string" && t in INTEGERS;

// A template literal type with open holes, like `${number}px`: the strings that match it. Its
// values are strings, so it is a checker type only, which `lower` makes `string`.
export type PatternType = { kind: "pattern"; typeId: usize; quasis: string[]; holes: Hole[]; fields: Field[] };
export type Hole = "string" | Numeric;

// The texts a template's holes take in `s`, as TypeScript matches: each hole but the last takes
// text up to the next piece's first occurrence (one character before another hole), the last
// takes what is left before the final piece.
export function splitTemplate(s: string, quasis: string[]): string[] | undefined {
  const last = quasis.length - 1;
  const [head, tail] = [quasis[0]!, quasis[last]!];
  if (!s.startsWith(head) || !s.endsWith(tail) || s.length < head.length + tail.length) return undefined;
  const end = s.length - tail.length;
  const parts: string[] = [];
  let pos = head.length;
  for (let i = 1; i < last; i++) {
    const next = quasis[i]!;
    const at = next === "" ? (pos < end ? pos + 1 : -1) : s.indexOf(next, pos);
    if (at < 0 || at + next.length > end) return undefined;
    parts.push(s.slice(pos, at));
    pos = at + next.length;
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

export function redundantBang(e: Expr): boolean {
  return e.kind === "nonNull" && (e as Bang).redundant === true;
}

// An expression with its redundant `!`s taken off.
export function bare(e: Expr): Expr {
  while (e.kind === "nonNull" && redundantBang(e)) e = e.expr;
  return e;
}

// The values an integer type holds.
export function range(t: Integer): [bigint, bigint] {
  const { bits, signed } = INTEGERS[t];
  return signed ? [-(1n << BigInt(bits - 1)), (1n << BigInt(bits - 1)) - 1n] : [0n, (1n << BigInt(bits)) - 1n];
}

// `null` is the empty Option: `T | null`, `T | undefined` and `x?: T` are all a union holding
// it, which flattening keeps from nesting.
// `never` is the type of an expression that never finishes, like a throw expression; it fits
// anywhere, and a union drops it.
export type Type = Numeric | "boolean" | "void" | "null" | "never" | "string" | "bigint" | ObjectType | ClassType | InterfaceType | ParamType | LiteralType | PatternType | UnionType | RefType | ClosureType | FunctionType | ArrayType | FixedType | MapType | VariantType | GeneratorType | PointerType | FutureType | HandleType | InteriorType | SharedType | BlockType | DynType | RegexType | RecursiveType;

// The ids the primitives key tables by, below every type record's.
const PRIMITIVE_IDS: Record<Extract<Type, string>, usize> = {
  i8: 1, i16: 2, i32: 3, i64: 4, i128: 5, isize: 6, u8: 7, u16: 8, u32: 9, u64: 10, u128: 11, usize: 12,
  f32: 13, f64: 14, boolean: 15, void: 16, null: 17, never: 18, string: 19, bigint: 20,
};

// The id a type keys a table by: a primitive's reserved one, or a record's `typeId`.
export const idOf = (t: Type): usize => (typeof t === "string" ? PRIMITIVE_IDS[t] : t.typeId);

// The type behind each id is kept, so a different object arriving with an id already in use, a
// copy that kept its original's id, fails loudly instead of reading or replacing its entry.
function checkedId(t: Type, known: Type | undefined): usize {
  if (known !== undefined && known !== t) throw new Error(`internal error: two types share typeId ${idOf(t)}`);
  return idOf(t);
}

// A `Map` from types, keyed by their ids, holding each type as a `Map` holds its keys.
export class TypeMap<K extends Type, V> {
  private table = new Map<usize, { type: K; value: V }>();

  constructor(entries?: Iterable<readonly [K, V]>) {
    if (entries) for (const [type, value] of entries) this.set(type, value);
  }

  get size(): usize {
    return this.table.size;
  }

  get(type: K): V | undefined {
    return this.table.get(checkedId(type, this.table.get(idOf(type))?.type))?.value;
  }

  has(type: K): boolean {
    return this.table.has(checkedId(type, this.table.get(idOf(type))?.type));
  }

  set(type: K, value: V): this {
    this.table.set(checkedId(type, this.table.get(idOf(type))?.type), { type, value });
    return this;
  }

  delete(type: K): boolean {
    return this.table.delete(checkedId(type, this.table.get(idOf(type))?.type));
  }

  clear(): void {
    this.table.clear();
  }

  *keys(): IterableIterator<K> {
    for (const e of this.table.values()) yield e.type;
  }

  *values(): IterableIterator<V> {
    for (const e of this.table.values()) yield e.value;
  }

  *entries(): IterableIterator<[K, V]> {
    for (const e of this.table.values()) yield [e.type, e.value];
  }

  [Symbol.iterator](): IterableIterator<[K, V]> {
    return this.entries();
  }

  forEach(each: (value: V, type: K) => void): void {
    for (const e of this.table.values()) each(e.value, e.type);
  }
}

// A `Set` of types, keyed by their ids, holding each type as a `Set` holds its members.
export class TypeSet<K extends Type> {
  private table = new Map<usize, K>();

  constructor(types?: Iterable<K>) {
    if (types) for (const t of types) this.add(t);
  }

  get size(): usize {
    return this.table.size;
  }

  has(type: K): boolean {
    return this.table.has(checkedId(type, this.table.get(idOf(type))));
  }

  add(type: K): this {
    this.table.set(checkedId(type, this.table.get(idOf(type))), type);
    return this;
  }

  delete(type: K): boolean {
    return this.table.delete(checkedId(type, this.table.get(idOf(type))));
  }

  clear(): void {
    this.table.clear();
  }

  values(): IterableIterator<K> {
    return this.table.values();
  }

  [Symbol.iterator](): IterableIterator<K> {
    return this.table.values();
  }

  forEach(each: (type: K) => void): void {
    for (const t of this.table.values()) each(t);
  }
}

// `Atomic<T>`, `Lock<T>` and `Cell<T>`: a value changed through a shared reference, so a
// `const` or a `Ref` can still change what it holds. An Atomic and a Cell are laid out as what
// they hold, a Lock as its lock word, then what it holds.
export type InteriorType = { kind: "interior"; typeId: usize; which: "Atomic" | "Lock" | "Cell"; of: Type; fields: Field[] };

// `shared<T>`: a counted pointer to a block holding the count, a lock word and the value, so
// every clone is the same value, read and changed from any thread.
export type SharedType = { kind: "shared"; typeId: usize; of: Type; fields: Field[] };

// `Dyn<I>`: a value of any type implementing interface I, owned in a heap block, with a vtable
// of what that type does: drop it, clone it, and each of I's members.
// A stored callable written with other parameter names is its own DynType, `shown` as written,
// for the same interface and key, which `lower` gives.
export type DynType = { kind: "dyn"; typeId: usize; of: InterfaceType; fields: Field[]; shown?: string };

// `Semaphore`, its `Permit` and `Channel<T>`: each a pointer to a counted block in the runtime,
// which tasks wait on without holding a thread. A Permit holds a count on its Semaphore. An
// `AbortController` and its `AbortSignal`s are handles to one block.
// A FileJob is a file read or write handed to the runtime's blocking pool.
// A JsValue is a value of the JS engine, which Fish holds without knowing its type.
export type BlockType = { kind: "block"; typeId: usize; which: "Semaphore" | "Permit" | "Channel" | "AbortController" | "AbortSignal" | "TcpListener" | "TcpStream" | "FileJob" | "JsValue"; of: Type; fields: Field[] };

// The futures a Semaphore's and a Channel's methods give, and a `sleep` given a signal, polled by
// the runtime: each frame holds its state, a count on the block (or a sleep's deadline), and for
// `send` the value going in. One given an AbortSignal ends with a count on it and whether it is
// waiting on it, and throws the `AbortError` it is given. `leafOf` names each one's method and
// what it carries.
export type Leaf = "acquire" | "send" | "receive" | "sleep" | "bind" | "connect" | "accept" | "read" | "write" | "readFile" | "writeFile" | "timerNext" | "jsAwait" | "next";

// A spawned task's `JoinHandle<T>`: what its future gives and may throw, awaited like it. A
// counted pointer to the task; dropping it detaches the task.
// `joined` marks what `handle.join()` gives: the same task, awaited so that its panic is thrown as
// the TaskPanic `panic` rather than panicking its awaiter.
export type HandleType = { kind: "handle"; typeId: usize; gives: Type; throws?: Type; fields: Field[]; joined?: { base: HandleType; panic: Type } };

// An async function's future, a `Promise<T>`: what it gives once awaited, what it may throw,
// its parameters, which say what it borrows, and the frame its state lives in, as a
// generator's. Polled where it lives and never moved after its first poll. One per async
// instance, so `===` is nominal identity; it has no properties.
export type FutureType = { kind: "future"; typeId: usize; name: string; gives: Type; throws?: Type; fields: Field[]; params: Field[]; frame: Field[]; concrete: boolean };

// `sleep(ms)`'s future: its state, then the delay, then the deadline the runtime sets.
export const SLEEP: FutureType = { kind: "future", typeId: 21, name: "sleep", gives: "void", fields: [], params: [], frame: [{ name: "state", type: "i32" }, { name: "deadline", type: "i64" }], concrete: true };

// A future awaiting several at once in its task, made for one `Promise.all` or `Promise.race`
// call: `all` gives each one's value as a tuple, `race` the first to settle's. Its frame is its
// state, then for each future the future, its value, and how far it got: 0 not yet polled, 1
// waiting, 2 done. A future giving nothing gives null here.
// Over an array of `Promise<T>` values, `array` is its type, and the frame holds the array, the
// values and a flag per future instead. `aggregate` is the AggregateError an `any` throws when
// every future fails.
export type Combined = { kind: "all" | "race" | "allSettled" | "any"; futures: (FutureType | HandleType | DynType)[]; array?: ArrayType; aggregate?: ClassType; at: { start: usize; end: usize } };

// `yieldNow()`'s future, which is pending once, then done.
export const YIELD_NOW: FutureType = { kind: "future", typeId: 22, name: "yieldNow", gives: "void", fields: [], params: [], frame: [{ name: "state", type: "i32" }], concrete: true };

// A raw pointer, `Ptr<T>` or `MutPtr<T>`: an address the borrow checker doesn't follow, used
// only inside `unsafe`. It copies like a number and owns nothing.
export type PointerType = { kind: "pointer"; typeId: usize; to: Type; mutable: boolean; fields: Field[] };

// A regex: its pattern and flags, which fix what each capture may hold. Its value points at a
// compiled program that never changes, so it copies freely and needs no drop.
// \`source\` is how JavaScript shows the pattern; \`pattern\` what is matched, which differ only for
// a \`new RegExp\` whose string held a \`/\` or a line terminator.
export type RegexType = { kind: "regex"; typeId: usize; source: string; pattern: string; flags: string; captures: { name: string | undefined; optional: boolean }[]; fields: Field[]; any?: true };

// The \`RegExp\` annotation: any regex. A parameter of it is an implicit type parameter, so each
// instance knows its regex; elsewhere it holds one whose pattern isn't known there.
export const ANY_REGEX: RegexType = { kind: "regex", typeId: 23, source: "", pattern: "", flags: "", captures: [], fields: [], any: true };

// Where a type leads back to itself, as `next` does in `type Node = { next: Node | null }`: a
// pointer to a block holding `of`, the type it stands for, which is set once that is made. It
// is that type everywhere but in its layout, and every walk over types stops at it.
// `args` are the alias's type arguments, so one made from type parameters is remade for what
// they stand for.
export type RecursiveType = { kind: "recursive"; typeId: usize; name: string; args: Type[]; of: Type; fields: Field[] };

// A generator: what it yields, its parameters, which say what it borrows, and the frame its
// state lives in, filled once the body is checked. It has no properties, so `fields` stays
// empty. One per generator instance, so `===` is nominal identity. An async one's `next()` gives
// a future, and its body may await between yields.
export type GeneratorType = { kind: "generator"; typeId: usize; name: string; yields: Type; fields: Field[]; params: Field[]; frame: Field[]; concrete: boolean; async?: boolean };

export const INTERIORS = new Set(["Atomic", "Lock", "Cell"]);

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
export function newTyping() {
  // The record a type that isn't a primitive stands for. A type is its record for now, so this
  // gives it back.
  function rec<T extends Exclude<Type, string>>(t: T): T {
    return t;
  }

  // The record of a type that isn't a primitive, or undefined for a primitive or no type.
  const recOf = (t: Type | undefined) => (typeof t === "string" || t === undefined ? undefined : rec(t));

  // Whether a hole of type `t` takes `text`: any text for a string, the text a number of that type
  // prints as for a number type, a literal's own text, or for a union, what any member takes.
  function textFits(text: string, t: Type): boolean {
    if (t === "string") return true;
    if (t === "boolean") return text === "true" || text === "false";
    // A number's text must be what that number prints as, so `-0` and `01` aren't integers.
    if (isInteger(t)) {
      if (!/^-?(0|[1-9]\d*)$/.test(text) || text === "-0") return false;
      const { bits, signed } = INTEGERS[t];
      const n = BigInt(text);
      return signed ? n >= -(1n << BigInt(bits - 1)) && n < 1n << BigInt(bits - 1) : n >= 0n && n < 1n << BigInt(bits);
    }
    // As TypeScript's `${number}`: any text JavaScript reads as a finite number.
    if (isFloat(t)) return text.trim() !== "" && Number.isFinite(Number(text));
    if (typeof t === "string") return false;
    const r = rec(t);
    if (r.kind === "literal") return !r.owner && String(r.value) === text;
    if (r.kind === "union") return r.members.some((m) => textFits(text, m));
    if (r.kind === "pattern") {
      const parts = splitTemplate(text, r.quasis);
      return parts !== undefined && parts.every((p, i) => textFits(p, r.holes[i]!));
    }
    return false;
  }

  // Whether a type is an Option: a union one of whose members is the empty value.
  const isOption = (t: Type): t is UnionType => {
    const r = recOf(t);
    return r?.kind === "union" && r.members.includes("null");
  };

  // The reference a `Ref<T> | null` holds when it isn't empty.
  function optionRef(t: Type | undefined): RefType | undefined {
    if (!t || !isOption(t) || rec(t).members.length !== 2) return undefined;
    const ref = rec(t).members.find((m) => m !== "null")!;
    return recOf(ref)?.kind === "ref" ? (ref as RefType) : undefined;
  }

  // The shape a JS handle's declaration gives it, when it has one.
  function jsShape(t: Type): InterfaceType | ObjectType | undefined {
    const r = recOf(t);
    if (r?.kind !== "block" || r.which !== "JsValue" || typeof r.of === "string") return undefined;
    const kind = rec(r.of).kind;
    return kind === "interface" || kind === "object" ? (r.of as InterfaceType | ObjectType) : undefined;
  }

  // A JsValue a program holds without knowing its type, not a package's handle of a known shape.
  const isPlainJs = (t: Type) => {
    const r = recOf(t);
    return r?.kind === "block" && r.which === "JsValue" && r.of === "void";
  };

  // The same, or a reference to one.
  const holdsPlainJs = (t: Type) => {
    const r = recOf(t);
    return isPlainJs(r?.kind === "ref" ? r.to : t);
  };

  const thrownBy = (f: FutureType | HandleType | DynType): Type | undefined => {
    const r = rec(f);
    return r.kind === "dyn" ? undefined : r.throws;
  };

  // The part of a type that keeps `===` from comparing its values, or undefined when every part
  // compares: primitives, strings and literals, and objects, tuples, arrays and unions of them. A
  // class compares through its `equals`, and a data enum when it derives Eq; `eq` says which do.
  function unequal(t: Type, eq: (t: ClassType | VariantType) => boolean, seen: TypeSet<Type> = new TypeSet<Type>()): Type | undefined {
    if (typeof t === "string" || seen.has(t)) return undefined;
    seen.add(t);
    const part = (u: Type) => unequal(u, eq, seen);
    const r = rec(t);
    switch (r.kind) {
      case "literal":
      case "pattern":
      case "pointer":
        return undefined;
      case "ref":
        return part(r.to);
      case "recursive":
        return part(r.of);
      // An open type parameter is judged in each instance, where it is concrete.
      case "param":
        return r.concrete ? part(r.concrete) : undefined;
      case "union":
        return r.members.map(part).find((p) => p !== undefined);
      case "array":
      case "fixed":
        return part(r.element);
      case "object":
        return r.match ? t : r.fields.map((f) => part(f.type)).find((p) => p !== undefined);
      case "class":
        return eq(t as ClassType) ? undefined : t;
      case "variant": {
        if (!eq(t as VariantType)) return t;
        const of = recOf(r.of);
        return (of?.kind === "union" ? of.members : [t])
          .flatMap((v) => { const w = recOf(v); return w?.kind === "variant" ? w.fields : []; })
          .map((f) => part(f.type)).find((p) => p !== undefined);
      }
      default:
        return t;
    }
  }

  // The part of a type that `console.log` can't print as Node's util.inspect would, or undefined:
  // every value but functions, handles and other runtime objects prints, a type parameter in each
  // instance once it is concrete.
  function uninspectable(t: Type, seen: TypeSet<Type> = new TypeSet<Type>()): Type | undefined {
    if (typeof t === "string") return t === "void" ? t : undefined;
    if (seen.has(t)) return undefined;
    seen.add(t);
    const part = (u: Type) => uninspectable(u, seen);
    const first = (parts: Type[]) => parts.map(part).find((p) => p !== undefined);
    const r = rec(t);
    switch (r.kind) {
      case "literal":
      case "pattern":
        return undefined;
      case "ref":
        return part(r.to);
      case "recursive":
        return part(r.of);
      case "param":
        return r.concrete ? part(r.concrete) : undefined;
      case "union":
        return first(r.members);
      case "array":
      case "fixed":
        return part(r.element);
      case "map":
        return first(r.set ? [r.key] : [r.key, r.value]);
      case "object":
        return r.match ? t : first(r.fields.map((f) => f.type));
      case "class":
        // The prelude's Error prints its cause through what ErrorLike gives.
        if ((r.name === "Error" && !r.generic) || r.generic?.name === "AggregateError") return r.generic ? part(r.generic.args[0]!) : undefined;
        // A JsError prints as an Error, the JS value it keeps left out.
        if (r.name === "JsError" && !r.generic) return undefined;
        return first([...(r.base ? [r.base] : []), ...r.fields.filter((f) => !f.name.startsWith("#")).map((f) => f.type)]);
      case "variant": {
        const of = recOf(r.of);
        return first((of?.kind === "union" ? of.members : [t]).flatMap((v) => { const w = recOf(v); return w?.kind === "variant" ? w.fields.map((f) => f.type) : []; }));
      }
      default:
        return t;
    }
  }

  // The type a recursive type stands for, or the type itself.
  const unfold = (t: Type): Type => {
    const r = recOf(t);
    return r?.kind === "recursive" ? r.of : t;
  };

  // An enum's member widens to its enum where TypeScript widens it: a `let`, a field, a type
  // argument or a property, since the place may later hold another member.
  function widenEnum(t: Type): Type {
    const r = recOf(t);
    if (r?.kind === "variant" && r.of) return r.of;
    return r?.kind === "literal" && r.owner?.of ? r.owner.of : t;
  }

  // A `let` holds its literal's whole type too, as in TypeScript: `let s = "a"` is a string.
  function widenLet(t: Type): Type {
    const r = recOf(t);
    if (r?.kind === "literal" && !r.owner && typeof r.value === "string") return "string";
    // A \`let\` may later hold another regex, so it holds any.
    if (r?.kind === "regex") return ANY_REGEX;
    return widenEnum(t);
  }

  // The type a literal's value belongs to, if Fish has it yet.
  function baseOf(t: LiteralType): "i64" | "boolean" | "string" {
    const { value } = rec(t);
    return typeof value === "bigint" ? "i64" : typeof value === "boolean" ? "boolean" : "string";
  }

  // Primitives, literals, references, and unions of nothing else are copied; objects,
  // instances, interface values and type parameters move. A closure copies like what it holds. A mutable reference passed on is
  // lent again rather than moved, so it copies too.
  // Whether a type is the class `c`, or a class extending it: what `instanceof c` tests.
  function isSubclass(t: Type, c: Type): boolean {
    for (let x: ClassType | undefined = recOf(t)?.kind === "class" ? (t as ClassType) : undefined; x; x = rec(x).base) if (x === c) return true;

    return false;
  }

  function isCopy(t: Type): boolean {
    if (typeof t === "string") return true;
    const r = rec(t);
    if (r.kind === "literal" || r.kind === "pattern" || r.kind === "ref" || r.kind === "pointer" || r.kind === "regex") return true;
    // A closure copies when what it captures does, and it changes nothing through it.
    if (r.kind === "closure") return r.fields.every((f) => isCopy(f.type) && !holdsMut(f.type));
    // A parameter of a generic function type holds a generic function value, which captures nothing.
    if (r.kind === "param" && r.bound) {
      const bound = rec(r.bound);
      if (bound.kind === "function" && bound.generic) return true;
    }
    // A fixed array copies when its elements do, as Rust's `[T; N]` does.
    if (r.kind === "fixed") return isCopy(r.element) && !holdsMut(r.element);
    // A tuple copies when everything in it does, as a union does.
    // A copy of a mutable reference would be a second one, so a tuple holding one moves.
    if (r.kind === "object" && r.tuple === true) return r.fields.every((f) => isCopy(f.type) && !holdsMut(f.type));
    return r.kind === "union" && r.members.every(isCopy);
  }

  // Whether a value of `t` holds a mutable reference anywhere, which a copy would alias.
  function holdsMut(t: Type, seen: TypeSet<Type> = new TypeSet<Type>()): boolean {
    if (typeof t === "string" || seen.has(t)) return false;
    seen.add(t);
    const inner = (u: Type) => holdsMut(u, seen);
    const r = rec(t);
    if (r.kind === "ref") return r.mutable;
    if (r.kind === "recursive") return holdsPart(r.of, (u) => { const v = recOf(u); return v?.kind === "ref" && v.mutable; });
    if (r.kind === "param") return r.concrete ? inner(r.concrete) : r.bound !== undefined && inner(r.bound);
    if (r.kind === "union") return r.members.some(inner);
    if (r.kind === "array" || r.kind === "fixed") return inner(r.element);
    if (r.kind === "map") return inner(r.value);
    if (r.kind === "variant") return r.fields.some((f) => inner(f.type));
    if (r.kind === "class") return r.fields.some((f) => inner(f.type)) || (r.base !== undefined && inner(r.base));
    if (r.kind === "generator" || r.kind === "future") return r.params.some((f) => inner(f.type));
    return (r.kind === "object" || r.kind === "closure") && r.fields.some((f) => inner(f.type));
  }

  // Whether a value has a part `found` picks anywhere in it, or with `throughRefs` also behind a
  // reference it holds. What a `shared` holds isn't its own part: copies of it are the same value.
  function holdsPart(t: Type, found: (t: Type) => boolean, throughRefs = false, seen: TypeSet<Type> = new TypeSet<Type>()): boolean {
    const holds = (u: Type) => holdsPart(u, found, throughRefs, seen);
    if (found(t)) return true;
    if (typeof t === "string") return false;
    // A type that holds itself, through an array of itself, is looked into once.
    if (seen.has(t)) return false;
    seen.add(t);
    const r = rec(t);
    if (r.kind === "ref") return throughRefs && holds(r.to);
    if (r.kind === "param") return r.concrete !== undefined && holds(r.concrete);
    if (r.kind === "union") return r.members.some(holds);
    if (r.kind === "array" || r.kind === "fixed") return holds(r.element);
    if (r.kind === "map") return holds(r.key) || holds(r.value);
    if (r.kind === "interior" || r.kind === "recursive") return holds(r.of);
    if (r.kind === "class") return r.fields.some((f) => holds(f.type)) || (r.base !== undefined && holds(r.base));
    if (r.kind === "generator" || r.kind === "future") return [...r.params, ...r.frame].some((f) => holds(f.type));
    return (r.kind === "object" || r.kind === "closure" || r.kind === "variant") && r.fields.some((f) => holds(f.type));
  }

  // Whether a value owns a JoinHandle, or with `throughRefs` borrows one: only one place may
  // await a task's result.
  const holdsHandle = (t: Type, throughRefs = false) => holdsPart(t, (u) => recOf(u)?.kind === "handle", throughRefs);

  // Whether a value changes in place behind a shared reference: it holds an Atomic, a Lock, a
  // shared value, or a Dyn, whose hidden value may hold them. Readers of a shared value borrow
  // such fields without its lock.
  const interiorMutable = (t: Type) => holdsPart(t, (u) => {
    const r = recOf(u);
    return r !== undefined && (r.kind === "shared" || r.kind === "dyn" || (r.kind === "interior" && r.which !== "Cell") || (r.kind === "block" && r.which !== "Permit"));
  });

  // The first Atomic, Lock or Cell a value holds, if any.
  function holdsInterior(t: Type): InteriorType | undefined {
    let found: InteriorType | undefined;
    holdsPart(t, (u) => recOf(u)?.kind === "interior" && (found = u as InteriorType) !== undefined);
    return found;
  }

  // A tuple's element types, in order.
  function elementsOf(t: ObjectType): Type[] {
    return rec(t).fields.filter((f) => /^\d+$/.test(f.name)).toSorted((a, b) => Number(a.name) - Number(b.name)).map((f) => f.type);
  }

  const isTuple = (t: Type): boolean => {
    const r = recOf(t);
    return r?.kind === "object" && r.tuple === true;
  };

  // A field of an object, or of an instance or the bases it embeds.
  function field(t: Exclude<Type, string>, name: string): Field | undefined {
    const r = rec(t);
    const own = r.fields.find((f) => f.name === name);
    return own ?? (r.kind === "class" && r.base ? field(r.base, name) : undefined);
  }

  // The indices that reach a field inside a value of `t`, through any embedded bases.
  function fieldPath(t: ObjectType | ClassType, name: string): usize[] {
    const r = rec(t);
    const embeds = r.kind === "class" && r.base;
    const i = r.fields.findIndex((f) => f.name === name);
    if (i >= 0) return [i + (embeds ? 1 : 0)];
    return [0, ...fieldPath(rec(t as ClassType).base!, name)];
  }

  // Every field of an instance: its bases' first, then its own.
  function allFields(t: ClassType): Field[] {
    const r = rec(t);
    return [...(r.base ? allFields(r.base) : []), ...r.fields];
  }

  // Whether `t` embeds `base`, directly or through another base.
  function derives(t: ClassType, base: ClassType): boolean {
    const r = rec(t);
    return r.base !== undefined && (r.base === base || derives(r.base, base));

  }

  // Function types whose error is a type parameter the call hasn't decided: an arrow given as one
  // infers what it throws, which then decides that parameter.
  const openThrows = new TypeSet<FunctionType>();

  const patterns = new Map<string, PatternType>();
  function patternType(quasis: string[], holes: Hole[]): Type {
    // `${string}` alone is every string.
    if (holes.length === 1 && holes[0] === "string" && quasis.every((q) => q === "")) return "string";
    const key = JSON.stringify([quasis, holes]);
    let t = patterns.get(key);
    if (!t) {
      t = made<PatternType>({ kind: "pattern", quasis, holes, fields: [] }, `pattern ${key}`);
      patterns.set(key, t);
    }
    return t;
  }

  // Whether a pattern is anywhere in `t`, where lowering it to `string` would lose what it asks.
  function holdsPattern(t: Type): boolean {
    if (typeof t === "string") return false;
    let found = patterned.get(t);
    if (found === undefined) {
      patterned.set(t, false);
      const r = rec(t);
      const parts = r.kind === "union" ? r.members : r.kind === "array" || r.kind === "fixed" ? [r.element] : r.kind === "map" ? [r.key, r.value] : r.kind === "ref" || r.kind === "pointer" ? [r.to]
        : r.kind === "object" ? r.fields.map((f) => f.type) : r.kind === "class" ? (r.generic?.args ?? []) : r.kind === "param" && r.concrete ? [r.concrete]
        : r.kind === "interior" || r.kind === "shared" || r.kind === "block" ? [r.of] : r.kind === "handle" ? [r.gives, ...(r.throws ? [r.throws] : [])]
        : r.kind === "variant" ? [...r.args, ...r.fields.map((f) => f.type)] : r.kind === "function" || r.kind === "closure" ? [...r.params, r.returns]
        : r.kind === "future" ? [r.gives] : r.kind === "generator" ? [r.yields] : r.kind === "dyn" ? rec(r.of).methods.flatMap((m) => [...m.params, m.returns]) : [];
      found = r.kind === "pattern" || parts.some(holdsPattern);
      patterned.set(t, found);
    }
    return found;
  }
  const patterned = new TypeMap<Exclude<Type, string>, boolean>();

  // Whether two types are one once lowered, except where `to` holds a pattern that lowering
  // would make a plain string: then fitting decides, part by part.
  function sameLowered(from: Type, to: Type): boolean {
    return lower(from) === lower(to) && (!holdsPattern(to) || holdsPattern(from) && shapeKey(from) === shapeKey(to));
  }

  const interiors = new Map<string, InteriorType>();

  function interiorType(which: InteriorType["which"], of: Type): InteriorType {
    const key = `${which} ${keyOf(of)}`;
    let t = interiors.get(key);
    if (!t) {
      t = made<InteriorType>({ kind: "interior", which, of, fields: [] }, key);
      interiors.set(key, t);
    }
    return t;
  }

  const shareds = new Map<string, SharedType>();

  function sharedType(of: Type): SharedType {
    const key = `shared ${keyOf(of)}`;
    let t = shareds.get(key);
    if (!t) {
      t = made<SharedType>({ kind: "shared", of, fields: [] }, key);
      shareds.set(key, t);
    }
    return t;
  }

  const dyns = new TypeMap<InterfaceType, DynType>();

  function dynType(of: InterfaceType): DynType {
    let t = dyns.get(of);
    if (!t) {
      t = made<DynType>({ kind: "dyn", of, fields: [] }, `dyn ${keyOf(of)}`);
      dyns.set(of, t);
    }
    return t;
  }

  // A stored callable: a written function type in a field, an element, an annotated variable or
  // a return is a Dyn of an interface with one method, `call`, which a closure satisfies by its
  // signature. One per signature, parameter names aside; each spelling is shown as written.
  const callables = new Map<string, InterfaceType>();
  const spellings = new Map<string, DynType>();
  const callableOf = new TypeMap<InterfaceType, FunctionType>();

  // Why a type can't cross between Fish and JS yet, when it can't: what crosses is strings,
  // booleans, numbers, null, literals, unions and Options of them, arrays and tuples of them,
  // copied across, and opaque JS values.
  function uncrossable(t: Type, within: TypeSet<Type> = new TypeSet<Type>()): string | undefined {
    // An empty array's element type, `never`, holds no value to cross.
    if (t === "string" || t === "boolean" || t === "null" || t === "never" || isNumeric(t)) return undefined;
    if (typeof t === "string") return t === "void" ? "'void' gives no value" : "Fish has no JS form for it";
    // A type holding itself has no JS form yet, as converting it would never end.
    if (within.has(t)) return "a type holding itself has no JS form yet";
    within.add(t);
    const why = crossing(t, (u) => uncrossable(u, within));
    within.delete(t);
    return why;
  }

  function crossing(t: Exclude<Type, string>, uncrossable: (t: Type) => string | undefined): string | undefined {
    // A callback or a stored Promise crosses on its own, as JS keeps it, not inside another value.
    const kept = (u: Type) => recOf(u)?.kind === "dyn" && keptByJs(u as DynType);
    const r = rec(t);
    switch (r.kind) {
      case "literal":
        return undefined;
      case "param":
        if (r.bound && rec(r.bound).kind === "function") return "functions crossing between Fish and JS aren't supported yet";
        return r.concrete === undefined ? "a type parameter's value isn't known here" : uncrossable(r.concrete);
      case "union":
        if (r.members.some(kept)) return "a callback or a Promise in a union, as an optional parameter holds one, isn't supported yet";
        return r.members.map(uncrossable).find((w) => w !== undefined);
      case "array":
      case "fixed":
        if (holdsPart(r.element, kept)) return "a callback or a Promise inside an array isn't supported yet; give it on its own";
        return uncrossable(r.element);
      case "object": {
        const parts = r.tuple ? elementsOf(t as ObjectType) : r.fields.map((f) => f.type);
        if (parts.some((u) => holdsPart(u, kept))) return "a callback or a Promise inside an object isn't supported yet; give it on its own";
        return parts.map(uncrossable).find((w) => w !== undefined);
      }
      case "block":
        return r.which === "JsValue" ? undefined : `a '${r.which}' is Fish's own`;
      case "function":
      case "closure":
        return "functions crossing between Fish and JS aren't supported yet";
      case "future":
      case "handle":
        if (r.kind === "future" && leafOf.get(t as FutureType)?.method === "jsAwait") return r.gives === "void" ? undefined : uncrossable(r.gives);
        return "Promises crossing between Fish and JS aren't supported yet";
      case "interface":
      case "dyn":
        // A callback crosses as a JS function when what it takes and gives do.
        if (r.kind === "dyn" && callableOf.has(r.of)) {
          const fn = rec(callableOf.get(r.of)!);
          // What JS gives a callback is read into Fish, which has no reading of a JS function or
          // promise as a Fish one.
          if (fn.params.some((p) => holdsPart(p, (u) => {
            const v = recOf(u);
            return kept(u) || (v !== undefined && (v.kind === "function" || (v.kind === "interface" && promiseElement(u as InterfaceType) !== undefined)));
          }))) {
            return "a callback that is given a function or a Promise isn't supported yet";
          }
          if (fn.throws) return "a callback that throws isn't supported yet; catch inside it";
          return [...fn.params, ...(fn.returns === "void" ? [] : [fn.returns])].map(uncrossable).find((w) => w !== undefined);
        }
        {
          // A Fish future given to JS is a promise of what it gives.
          const promised = promiseElement(r.kind === "dyn" ? r.of : t);
          if (promised === undefined) return "Fish has no JS form for it";
          return r.kind === "dyn" ? (promised === "void" ? undefined : uncrossable(promised)) : "Promises crossing between Fish and JS aren't supported yet";
        }
      default:
        return "Fish has no JS form for it";
    }
  }

  // The members of a package's shapes Fish can't type, each with why: refused only where used.
  const jsUntyped = new TypeMap<InterfaceType, Map<string, CompileError>>();
  // The refusals of members held aside that are optional, which a value may leave out.
  const jsOptional = new WeakSet<CompileError>();
  // The same for a package's function a program imports but doesn't call.
  const jsUncalled = new WeakNodeMap<Id, CompileError>();

  // The prelude's JsError, what awaiting a JS promise that rejects throws, once the prelude is read.
  let jsError: Type | undefined;
  function setJsError(t: Type | undefined) {
    jsError = t;
  }

  // What a declared type is when JS gives it: an object, as a handle of its shape, inside unions,
  // arrays and tuples too, and a promise as a Fish future of what it fulfills with.
  function jsView(t: Type): Type {
    if (typeof t === "string") return t;
    const r = rec(t);
    const promised = promiseElement(r.kind === "dyn" ? r.of : t);
    if (promised !== undefined && jsError !== undefined) return leafFuture("jsAwait", promised === "void" ? "void" : jsView(promised), jsError);
    if (r.kind === "object" && !r.tuple) return blockType("JsValue", t);
    if (r.kind === "object") return retuple(t as ObjectType, jsView);
    if (r.kind === "union") return unionType(r.members.map(jsView));
    if (r.kind === "array") return arrayType(jsView(r.element));
    return t;
  }

  // What the timer task runs: each timer's callback, wrapped as an async function.
  const timerCallback = (): DynType => callableType(functionType([], [], promiseInterface("void")));

  function callableType(fn: FunctionType): DynType {
    // In an instance, what its type parameters stand for decides the layout.
    const f = rec(fn);
    const [params, returns, throws] = [f.params.map(lower), lower(f.returns), f.throws && lower(f.throws)];
    // Keyed by types alone, as parameter names don't make another function type, so
    // `Box<(n: i64) => i64>` and `Box<(m: i64) => i64>` are one class; the first spelling met is shown.
    const key = `${params.map(keyOf).join(", ")} => ${keyOf(returns)}${throws ? ` throws ${keyOf(throws)}` : ""}`;
    let i = callables.get(key);
    if (!i) {
      i = interfaceType(f.name);
      i.methods.push({ name: "call", params, returns, ...(throws && { throws }) });
      callables.set(key, i);
      callableOf.set(i, made<FunctionType>({ ...f, params, returns, throws }));

    }
    if (f.name === rec(i).name) return dynType(i);
    let spelled = spellings.get(`${key} ${f.name}`);
    if (!spelled) {
      spelled = made<DynType>({ kind: "dyn", of: i, fields: [], shown: f.name }, keys.get(dynType(i))!);
      spellings.set(`${key} ${f.name}`, spelled);
    }
    return spelled;
  }

  // Whether two stored callables take and give the same types, so either holds the other's value.
  function sameCallable(a: Type, b: Type): boolean {
    const [f, g] = [a, b].map((t) => {
      const r = recOf(t);
      const fn = r?.kind === "dyn" ? callableOf.get(r.of) : undefined;
      return fn && rec(fn);
    });
    return f !== undefined && g !== undefined && f.params.length === g.params.length && f.params.every((p, i) => lower(p) === lower(g.params[i]!)) && lower(f.returns) === lower(g.returns)
      && (f.throws && lower(f.throws)) === (g.throws && lower(g.throws));
  }

  // A function type, or a `Promise<T>`, where a value is stored becomes its boxed form, inside
  // arrays too.
  function stored(t: Type): Type {
    if (typeof t === "string") return t;
    const r = rec(t);
    // A generic function type, like an interface, describes a value without being one.
    if (r.kind === "function" && r.generic) return t;
    if (r.kind === "function") return callableType(t as FunctionType);
    // A `Promise<T>` stored holds a future, boxed.
    if (r.kind === "interface" && promised.has(t as InterfaceType)) return dynType(t as InterfaceType);
    if (r.kind === "array") return arrayType(stored(r.element));
    if (r.kind === "fixed") return fixedType(stored(r.element), r.size);
    if (r.kind === "map") return mapType(r.key, stored(r.value), r.set);
    return t;
  }

  // A type argument holds its values, so a function type or a closure's type given as one is a
  // stored callable, as Rust's `Box<dyn Fn>` is.
  function heldArgument(t: Type): Type {
    if (typeof t === "string") return t;
    const r = rec(t);
    if ((r.kind !== "function" && r.kind !== "closure") || r.generic) return t;
    if (r.kind === "function") return callableType(t as FunctionType);
    // An async closure gives a Promise, as a written `() => Promise<T>` does. One whose future
    // throws has no written form yet, so it stays as it is, for its holder to refuse.
    const gives = recOf(r.returns);
    const future = gives?.kind === "future" ? gives : undefined;
    if (future?.throws) return t;
    // What it gives widens as a `let` would, so `() => "a"` and `() => "b"` meet as `() => string`.
    const returns = future ? promiseInterface(future.gives) : widenLet(r.returns);
    const fn = functionType(r.params.map((_, i) => `p${i}`), r.params, returns, r.throws);
    // Shown as the closure was written, with its own parameter names, when that is still its type.
    return callableType(returns === r.returns ? { ...rec(fn), name: r.name } : fn);
  }

  const blocks = new Map<string, BlockType>();

  // Whether a value crosses between Fish and JS converted on the way: a string, a number, a
  // boolean, empty, a literal, a JS value or handle, and unions, arrays, tuples and objects of them.
  // A Fish type holding itself has no JS form yet, as converting it would never end: `within` is
  // the types the walk is inside.
  function jsConverts(t: Type, within: TypeSet<Type> = new TypeSet<Type>()): boolean {
    // An empty array's element type, `never`, holds no value to convert.
    if (t === "string" || t === "boolean" || t === "null" || t === "never" || isNumeric(t)) return true;
    if (typeof t === "string" || within.has(t)) return false;
    const r = rec(t);
    if (r.kind === "block") return r.which === "JsValue";
    if (r.kind === "dyn" && callableOf.has(r.of)) {
      const fn = rec(callableOf.get(r.of)!);
      if (fn.throws) return false;
      return [...fn.params, ...(fn.returns === "void" ? [] : [fn.returns])].every((u) => jsConverts(u, within));
    }
    if (r.kind === "dyn" && promiseElement(r.of) !== undefined) return promiseElement(r.of) === "void" || jsConverts(promiseElement(r.of)!, within);
    if (r.kind === "future") return leafOf.get(t as FutureType)?.method === "jsAwait" && (r.gives === "void" || jsConverts(r.gives, within));
    const parts = r.kind === "ref" ? [r.to] : r.kind === "param" ? (r.concrete === undefined ? undefined : [r.concrete])
      : r.kind === "union" ? r.members : r.kind === "array" || r.kind === "fixed" ? [r.element] : r.kind === "object" ? r.fields.map((f) => f.type) : r.kind === "literal" ? [] : undefined;
    if (parts === undefined) return false;
    within.add(t);
    const all = parts.every((u) => jsConverts(u, within));
    within.delete(t);
    return all;
  }

  // A value JS keeps once it is given: a stored callable or a stored Promise, or what is stored as
  // one, a closure, a function or a future. Given to JS, it is handed over.
  function keptByJs(t: Type): boolean {
    if (typeof t === "string") return false;
    const r = rec(t);
    if (r.kind === "dyn") return callableOf.has(r.of) || promiseElement(r.of) !== undefined;
    return r.kind === "closure" || r.kind === "function" || r.kind === "future" || r.kind === "handle";
  }

  // What a package's parameter takes: a function type is a callback that JS may keep, so a stored
  // callable, owning what it uses; a `Promise<T>` is a stored one, as the task settling the JS
  // promise owns it; an object type is a handle of that shape, which a Fish value of it meets by
  // being made a new JS object.
  function jsTakes(t: Type): Type {
    if (typeof t === "string") return t;
    const r = rec(t);
    if (r.kind === "union") return unionType(r.members.map(jsTakes));
    if (r.kind === "function" || (r.kind === "interface" && promiseElement(t as InterfaceType) !== undefined)) return stored(t);
    return jsView(t);
  }

  // What a variable of type `declared` holding a JsValue reads as where `typeof` narrowed it to
  // `read`: one kind of value, read out of JS, or several, which leave it the JsValue.
  function jsRead(declared: Type, read: Type | undefined): "one" | "several" | undefined {
    if (read === undefined) return undefined;
    const ref = recOf(declared);
    const held = ref?.kind === "ref" ? ref.to : declared;
    const union = recOf(held);
    const members = union?.kind === "union" ? union.members : [held];
    if (!members.some(isPlainJs)) return undefined;
    const kinds = (u: Type) => (u === "string" || u === "f64" || u === "boolean") && !members.includes(u);
    const readRec = recOf(read);
    const reads = (readRec?.kind === "union" ? readRec.members : [read]).filter(kinds);
    if (reads.length === 0) return undefined;
    return reads.length === 1 && kinds(read) ? "one" : "several";
  }

  function blockType(which: BlockType["which"], of: Type = "void"): BlockType {
    const key = `${which} ${keyOf(of)}`;
    let t = blocks.get(key);
    if (!t) {
      t = made<BlockType>({ kind: "block", which, of, fields: [] }, key);
      blocks.set(key, t);
    }
    return t;
  }
  const leaves = new Map<string, FutureType>();
  const leafOf = new TypeMap<FutureType, { method: Leaf; of: Type; signal: boolean }>();

  // Each leaf's frame after its state: what it waits on, then what it carries.
  const LEAF_FRAMES: Record<Leaf, (of: Type) => Field[]> = {
    sleep: () => [{ name: "deadline", type: "i64" }],
    acquire: () => [{ name: "block", type: blockType("Semaphore") }],
    send: (of) => [{ name: "block", type: blockType("Channel", of) }, { name: "value", type: of }],
    receive: (of) => [{ name: "block", type: blockType("Channel", of) }],
    bind: () => [{ name: "host", type: "string" }, { name: "port", type: "i64" }],
    connect: () => [{ name: "socket", type: blockType("TcpStream") }, { name: "host", type: "string" }, { name: "port", type: "i64" }],
    accept: () => [{ name: "block", type: blockType("TcpListener") }],
    read: () => [{ name: "block", type: blockType("TcpStream") }, { name: "max", type: "i64" }],
    write: () => [{ name: "block", type: blockType("TcpStream") }, { name: "bytes", type: arrayType("u8") }, { name: "written", type: "i64" }],
    readFile: () => [{ name: "path", type: "string" }, { name: "job", type: blockType("FileJob") }],
    writeFile: () => [{ name: "path", type: "string" }, { name: "bytes", type: arrayType("u8") }, { name: "job", type: blockType("FileJob") }],
    timerNext: () => [],
    // A JS promise, and whether the task already waits for it to settle.
    jsAwait: () => [{ name: "promise", type: blockType("JsValue") }, { name: "waiting", type: "i32" }],
    // An async generator's `next()`, which runs the generator where it lives, in the awaiting task.
    next: (of) => [{ name: "generator", type: refType(of, true) }],
  };

  // A leaf future: what it gives, what it may throw, and whether it was given an AbortSignal, whose
  // count and waiting flag end its frame.
  function leafFuture(method: Leaf, of: Type, throws?: Type, signal = false): FutureType {
    const key = `${method} ${keyOf(of)} ${throws ? keyOf(throws) : ""} ${signal}`;
    let t = leaves.get(key);
    if (!t) {
      const frame: Field[] = [{ name: "state", type: "i32" }, ...LEAF_FRAMES[method](of)];
      if (signal) frame.push({ name: "signal", type: blockType("AbortSignal") }, { name: "waiting", type: "i32" });
      const gives: Type = method === "acquire" ? blockType("Permit") : method === "receive" || method === "timerNext" ? unionType([of, "null"]) : method === "bind" ? blockType("TcpListener")
        : method === "connect" || method === "accept" ? blockType("TcpStream") : method === "read" || method === "readFile" ? arrayType("u8") : method === "jsAwait" ? of
        : method === "next" ? nextResult(rec(of as GeneratorType).yields) : "void";
      t = made<FutureType>({ kind: "future", name: method, gives, throws, fields: [], params: [], frame, concrete: true }, `leaf ${key}`);
      leaves.set(key, t);
      leafOf.set(t, { method, of, signal });
    }
    return t;
  }

  const handles = new Map<string, HandleType>();

  function handleType(gives: Type, throws: Type | undefined): HandleType {
    const key = `handle ${keyOf(gives)} ${throws ? keyOf(throws) : ""}`;
    let t = handles.get(key);
    if (!t) {
      t = made<HandleType>({ kind: "handle", gives, throws, fields: [] }, key);
      handles.set(key, t);
    }
    return t;
  }

  // What `handle.join()` gives: the task's handle, awaited as throwing a TaskPanic too.
  function joinedType(base: HandleType, panic: Type): HandleType {
    const key = `joined ${keyOf(base)} ${keyOf(panic)}`;
    let t = handles.get(key);
    if (!t) {
      const { gives, throws } = rec(base);
      t = made<HandleType>({ kind: "handle", gives, throws: throws ? unionType([throws, panic]) : panic, fields: [], joined: { base, panic } }, key);
      handles.set(key, t);
    }
    return t;
  }

  function futureType(name: string, concrete: boolean): FutureType {
    const t = made<FutureType>({ kind: "future", name, gives: "void", fields: [], params: [], frame: [], concrete }, `future ${declared++}`);
    return t;
  }
  const combinedOf = new TypeMap<FutureType, Combined>();

  // What a future in a combined one gives, null for nothing, and what it throws.
  function givenBy(f: FutureType | HandleType | DynType): Type {
    const r = rec(f);
    const gives = r.kind === "dyn" ? promiseElement(r.of)! : r.gives;
    return gives === "void" ? "null" : gives;
  }

  // An `allSettled` outcome, as JavaScript gives it: fulfilled with the value, or, for a future that
  // can throw, rejected with what it threw.
  function settledType(gives: Type, thrown: Type | undefined): Type {
    const { fulfilled, rejected } = settledParts(gives, thrown);
    return rejected ? unionType([fulfilled, rejected]) : fulfilled;
  }

  function settledParts(gives: Type, thrown: Type | undefined): { fulfilled: ObjectType; rejected?: ObjectType } {
    const fulfilled = objectType([{ name: "status", type: literalType("fulfilled") }, { name: "value", type: gives }]);
    return { fulfilled, rejected: thrown ? objectType([{ name: "status", type: literalType("rejected") }, { name: "reason", type: thrown }]) : undefined };
  }

  function combinedFuture(combined: Combined): FutureType {
    const { kind } = combined;
    const make = (gives: Type, throws: Type | undefined, frame: Field[]) => {
      const params = combined.futures.flatMap((f) => {
        const r = rec(f);
        return r.kind === "future" ? r.params : [];
      });
      const t = made<FutureType>({ kind: "future", name: `Promise.${kind}`, gives, throws, fields: [], params, frame, concrete: true }, `future ${declared++}`);
      combinedOf.set(t, combined);
      return t;
    };
    if (combined.array) {
      const given = givenBy(rec(combined.array).element as DynType);
      const kept = kind === "allSettled" ? settledType(given, undefined) : given;
      const frame: Field[] = [{ name: "state", type: "i32" }, { name: "futures", type: combined.array }, { name: "values", type: arrayType(kept) }, { name: "flags", type: arrayType("u8") }];
      return make(kind === "all" || kind === "allSettled" ? arrayType(kept) : given, kind === "any" ? combined.aggregate : undefined, frame);
    }
    // Each future's slot keeps its value, its outcome for `allSettled`, or its error for `any`.
    const kept = combined.futures.map((f) => (kind === "allSettled" ? settledType(givenBy(f), thrownBy(f)) : kind === "any" ? (thrownBy(f) ?? "null") : givenBy(f)));
    const frame: Field[] = [{ name: "state", type: "i32" }];
    combined.futures.forEach((f, i) => frame.push({ name: `future${i}`, type: f }, { name: `value${i}`, type: kept[i]! }, { name: `done${i}`, type: "i32" }));
    const thrown = combined.futures.flatMap((f) => (thrownBy(f) ? [thrownBy(f)!] : []));
    if (kind === "all") return make(tupleType(kept), thrown.length > 0 ? unionType(thrown) : undefined, frame);
    if (kind === "allSettled") return make(tupleType(kept), undefined, frame);
    const gives = unionType(combined.futures.map(givenBy));
    if (kind === "race") return make(gives, thrown.length > 0 ? unionType(thrown) : undefined, frame);
    return make(gives, combined.aggregate, frame);
  }

  const promises = new Map<string, InterfaceType>();
  const promised = new TypeMap<InterfaceType, Type>();

  // `Promise<T>`: any future giving a `T` once awaited, as TypeScript's type of an async result is.
  function promiseInterface(t: Type): InterfaceType {
    let found = promises.get(keyOf(t));
    if (!found) {
      found = interfaceType(`Promise<${show(t)}>`);
      promises.set(keyOf(t), found);
      promised.set(found, t);
    }
    return found;
  }

  // The boxed future a Dyn's async method gives: a `Promise<T>` that borrows the Dyn's value, so
  // it holds a reference, which keeps it from outliving the Dyn or crossing threads.
  const lent = new Map<string, InterfaceType>();
  const borrowing = new TypeSet<InterfaceType>();

  function lentPromise(t: Type): DynType {
    let found = lent.get(keyOf(t));
    if (!found) {
      found = interfaceType(`Promise<${show(t)}>`);
      lent.set(keyOf(t), found);
      promised.set(found, t);
      borrowing.add(found);
    }
    return dynType(found);
  }

  // Whether copies of a Dyn share its one value, as Rust's `Arc<dyn Trait>` does: so they may when
  // nothing through its interface changes or takes over the value. A boxed future never does,
  // since polling changes it.
  function sharesDyn(t: DynType): boolean {
    const { of } = rec(t);
    return !promised.has(of) && generatorElement(of, true) === undefined && rec(of).methods.every((m) => !m.mutable && !m.owned);
  }

  // What a `Promise<T>` gives, when the interface is one.
  function promiseElement(t: Type): Type | undefined {
    return recOf(t)?.kind === "interface" ? promised.get(t as InterfaceType) : undefined;
  }

  const regexes = new Map<string, RegexType>();

  function regexType(pattern: string, flags: string, captures: RegexType["captures"], source: string = pattern): RegexType {
    const key = `regex ${flags} ${pattern}`;
    let t = regexes.get(key);
    if (!t) {
      t = made<RegexType>({ kind: "regex", source, pattern, flags, captures, fields: [] }, key);
      regexes.set(key, t);
    }
    return t;
  }

  // One per alias instance a program's types lead back to; the checker keeps them by instance.
  function recursiveType(name: string, args: Type[]): RecursiveType {
    const t = made<RecursiveType>({ kind: "recursive", name, args, of: "never", fields: [] }, `recursive ${declared++}`);
    return t;
  }

  // The recursive type standing for a class or an enum instance, made once for it, so the one
  // made for another instance is found from the instance.
  const heldBlocks = new TypeMap<Exclude<Type, string>, RecursiveType>();
  function blockFor(t: ClassType | UnionType, args: Type[]): RecursiveType {
    let back = heldBlocks.get(t);
    if (!back) {
      heldBlocks.set(t, back = recursiveType(show(t), args));
      standsFor(back, t);
    }
    return back;
  }
  function holdsBlock(t: UnionType, back: RecursiveType) {
    heldBlocks.set(t, back);
  }

  // The same recursive type made with other type arguments, which only the checker can make.
  let instanceRecursive = (t: RecursiveType, _args: Type[]): RecursiveType => t;
  function lowersRecursive(f: typeof instanceRecursive) {
    instanceRecursive = f;
  }

  // A recursive type for other type arguments: a class's or an enum's is found from its instance,
  // `of` made with them, which makes the instance without reading its fields; an alias's is
  // remade by the checker.
  function remade(t: RecursiveType, of: () => Type, args: Type[]): RecursiveType {
    const stands = rec(t).of;
    const kind = recOf(stands)?.kind;
    if (kind === "class" || (kind === "union" && heldBlocks.get(stands as UnionType) === t)) {
      const made = of();
      const madeKind = recOf(made)?.kind;
      return madeKind === "class" || madeKind === "union" ? blockFor(made as ClassType | UnionType, args) : t;
    }
    return instanceRecursive(t, args);
  }

  // Whether a value of `type` lent where a type parameter is wanted is a part of a value whose type
  // holds itself, the parameter standing for that type: each instance checks it again.
  function partOfItself(type: Type, to: Type): boolean {
    const r = recOf(to);
    if (r?.kind !== "param" || r.concrete || r.bound === undefined || lower(type) !== lower(r.bound)) return false;
    const bound = r.bound;
    return ties.has(bound) || holdsPart(bound, (u) => { const v = recOf(u); return v?.kind === "recursive" && v.of === lower(type); });
  }

  // The part of a type that keeps `JSON.stringify` and `JSON.parse` from taking its values, or
  // undefined when every part is Json: booleans, numbers, strings and literals, and objects,
  // tuples, arrays, unions and string-keyed Maps of them, with the classes and data enums that
  // `json` says derive it. A class's `#private` fields aren't written, as in JavaScript.
  function unjson(t: Type, json: (t: ClassType | VariantType) => boolean, seen: TypeSet<Type> = new TypeSet<Type>()): Type | undefined {
    // JavaScript throws for a bigint, which JSON has no number for.
    if (typeof t === "string") return t === "void" || t === "never" || t === "bigint" ? t : undefined;
    if (seen.has(t)) return undefined;
    seen.add(t);
    const part = (u: Type) => unjson(u, json, seen);
    const first = (parts: Type[]) => parts.map(part).find((p) => p !== undefined);
    const r = rec(t);
    switch (r.kind) {
      case "literal":
      case "pattern":
        return undefined;
      case "ref":
        return part(r.to);
      case "recursive":
        return part(r.of);
      case "param":
        return r.concrete ? part(r.concrete) : undefined;
      case "union":
        return first(r.members);
      case "array":
      case "fixed":
        return part(r.element);
      case "object":
        return r.match ? t : first(r.fields.map((f) => f.type));
      case "map":
        return r.set || lower(r.key) !== "string" ? t : part(r.value);
      case "class":
        return json(t as ClassType) ? first([...(r.base ? [r.base] : []), ...r.fields.filter((f) => !f.name.startsWith("#")).map((f) => f.type)]) : t;
      case "variant": {
        if (!json(t as VariantType)) return t;
        const of = recOf(r.of);
        return first((of?.kind === "union" ? of.members : [t]).flatMap((v) => { const w = recOf(v); return w?.kind === "variant" ? w.fields.map((f) => f.type) : []; }));
      }
      default:
        return t;
    }
  }

  // What reading a place of `t` gives: a recursive type, or a union's recursive members, as the
  // types they stand for, held in a value of their own rather than in a block.
  function unfolded(t: Type): Type {
    const r = recOf(t);
    if (r?.kind === "union" && r.members.some((m) => recOf(m)?.kind === "recursive")) return unionType(r.members.map(unfold), r.name);
    return unfold(t);
  }

  const pointers = new Map<string, PointerType>();

  function pointerType(to: Type, mutable: boolean): PointerType {
    const key = `${mutable ? "mutptr" : "ptr"} ${keyOf(to)}`;
    let t = pointers.get(key);
    if (!t) {
      t = made<PointerType>({ kind: "pointer", to, mutable, fields: [] }, key);
      pointers.set(key, t);
    }
    return t;
  }

  const interned = new Map<string, ObjectType>();
  const literals = new Map<string, LiteralType>();
  const unions = new Map<string, UnionType>();
  const keys = new TypeMap<Exclude<Type, string>, string>();
  let declared = 0;

  // Every type of this program by its `typeId`. Ids 1 to 20 are the primitives', and 21 to 23 the
  // module constants', which every program shares.
  const arena = new Map<usize, Exclude<Type, string>>([[SLEEP.typeId, SLEEP], [YIELD_NOW.typeId, YIELD_NOW], [ANY_REGEX.typeId, ANY_REGEX]]);
  let nextTypeId: usize = 24;

  // A new type record: given its id, kept in the arena, and interned under `key` when it has one.
  function made<T extends Exclude<Type, string>>(record: Omit<T, "typeId">, key?: string): T {
    const t = record as T;
    t.typeId = nextTypeId++;
    arena.set(t.typeId, t);
    if (key !== undefined) keys.set(t, key);
    return t;
  }

  const typeOf = (id: usize): Exclude<Type, string> | undefined => arena.get(id);

  // A class's key is unique to its declaration, since two programs may reuse a class name.
  function classType(name: string, generic?: ClassType["generic"]): ClassType {
    const t = made<ClassType>({ kind: "class", name, fields: [], generic }, `class ${declared++}`);
    return t;
  }

  function interfaceType(name: string): InterfaceType {
    const t = made<InterfaceType>({ kind: "interface", name, fields: [], methods: [] }, `interface ${declared++}`);
    return t;
  }

  function generatorType(name: string, concrete: boolean, async = false): GeneratorType {
    const t = made<GeneratorType>({ kind: "generator", name, yields: "never", fields: [], params: [], frame: [], concrete, ...(async ? { async } : {}) }, `generator ${declared++}`);
    return t;
  }

  // What `next()` gives: the next value, or that the generator has finished.
  function nextResult(t: Type): Type {
    return unionType([objectType([{ name: "done", type: literalType(false) }, { name: "value", type: t }]), objectType([{ name: "done", type: literalType(true) }])]);
  }

  const generators = new Map<string, InterfaceType>();
  const elements = new TypeMap<InterfaceType, Type>();
  const asyncElements = new TypeMap<InterfaceType, Type>();

  // `Generator<T>`: anything whose `next()` gives `T`s, as TypeScript's type of a generator is.
  function generatorInterface(t: Type): InterfaceType {
    let found = generators.get(keyOf(t));
    if (!found) {
      found = interfaceType(`Generator<${show(t)}>`);
      found.methods.push({ name: "next", params: [], returns: nextResult(t) });
      generators.set(keyOf(t), found);
      elements.set(found, t);
    }
    return found;
  }

  // `AsyncGenerator<T>`: anything whose awaited `next()` gives `T`s.
  function asyncGeneratorInterface(t: Type): InterfaceType {
    let found = generators.get(`async ${keyOf(t)}`);
    if (!found) {
      found = interfaceType(`AsyncGenerator<${show(t)}>`);
      found.methods.push({ name: "next", params: [], returns: promiseInterface(nextResult(t)) });
      generators.set(`async ${keyOf(t)}`, found);
      asyncElements.set(found, t);
    }
    return found;
  }

  // What a generator, or a type parameter standing for one or bounded by `Generator<T>`, yields.
  // `async` asks the same of an async generator and `AsyncGenerator<T>`.
  function yieldsOf(t: Type, async = false): Type | undefined {
    if (typeof t === "string") return undefined;
    const r = rec(t);
    if (r.kind === "generator") return !!r.async === async ? r.yields : undefined;
    if (r.kind === "dyn") return async ? generatorElement(r.of, true) : undefined;
    if (r.kind === "param") return r.concrete ? yieldsOf(r.concrete, async) : r.bound && generatorElement(r.bound, async);
    return generatorElement(t, async);
  }

  // What a `Generator<T>`, or with `async` an `AsyncGenerator<T>`, yields, when the interface is one.
  function generatorElement(t: Type, async = false): Type | undefined {
    return recOf(t)?.kind === "interface" ? (async ? asyncElements : elements).get(t as InterfaceType) : undefined;
  }

  function functionType(names: string[], params: Type[], returns: Type, throws?: Type): FunctionType {
    const t = made<FunctionType>({ kind: "function", name: signatureName(names, params, returns, throws), names, params, returns, ...(throws && { throws }), fields: [] }, `function ${declared++}`);
    return t;
  }

  const signatureName = (names: string[], params: Type[], returns: Type, throws: Type | undefined) =>
    `(${params.map((p, i) => `${names[i]}: ${show(p)}`).join(", ")}) => ${show(returns)}${throws ? ` throws ${show(throws)}` : ""}`;

  function closureType(names: string[], params: Type[], returns: Type, fields: Field[], once: string | undefined, concrete: boolean, throws?: Type): ClosureType {
    const t = made<ClosureType>({ kind: "closure", name: signatureName(names, params, returns, throws), params, returns, ...(throws && { throws }), fields, once, concrete }, `closure ${declared++}`);
    return t;
  }

  const genericValues = new Map<string, ClosureType>();

  // The one type of a generic function used as a value, by the function's name.
  function genericFunctionType(name: string, shown: string): ClosureType {
    let t = genericValues.get(name);
    if (!t) {
      t = made<ClosureType>({ kind: "closure", name: shown, params: [], returns: "void", fields: [], concrete: true, generic: name }, `generic function ${name}`);
      genericValues.set(name, t);
    }
    return t;
  }

  function literalType(value: string | bigint | boolean, owner?: LiteralType["owner"]): LiteralType {
    const key = `literal ${typeof value} ${value}${owner ? ` of ${owner.enum}.${owner.member} ${owner.id}` : ""}`;
    let t = literals.get(key);
    if (!t) {
      t = made<LiteralType>({ kind: "literal", value, fields: [], owner }, key);
      literals.set(key, t);
    }
    return t;
  }

  // A literal standing for a comptime value that isn't a string, number or boolean, such as a
  // tag's strings: interned by `key`, and never equal to an ordinary literal.
  function standInLiteral(key: string): LiteralType {
    const at = `stand-in ${key}`;
    let t = literals.get(at);
    if (!t) {
      t = made<LiteralType>({ kind: "literal", value: key, fields: [] }, at);
      literals.set(at, t);
    }
    return t;
  }

  // Members are flattened, deduplicated and kept in one order, so equal unions are one type,
  // and a literal whose base type is also a member adds nothing. A single member is itself.
  // An enum's union carries the enum's name, for messages.
  function unionType(parts: Type[], name?: string): Type {
    let flat = parts.flatMap((p) => { const r = recOf(p); return r?.kind === "union" ? r.members : [p]; }).filter((p, _, all) => p !== "never" || all.every((q) => q === "never"));
    // Regexes of different patterns are one \`RegExp\`, as every regex is a pointer to a program.
    const isRegex = (p: Type) => recOf(p)?.kind === "regex";
    if (new TypeSet(flat.filter(isRegex)).size > 1) flat = flat.map((p) => (isRegex(p) ? ANY_REGEX : p));
    // Members of one value shape, like `{ a?: T }` and `{ a: T | null }`, are one member, spelled
    // as whichever sorts first.
    const seen = new Set<string>();
    const members = [...new TypeSet(flat)]
      .filter((t) => {
        if (typeof t === "string") return true;
        const { kind } = rec(t);
        return (kind !== "literal" || !flat.includes(baseOf(t as LiteralType)!)) && (kind !== "pattern" || !flat.includes("string"));
      })
      .toSorted((a, b) => (keyOf(a) < keyOf(b) ? -1 : keyOf(a) > keyOf(b) ? 1 : 0))
      .filter((t) => {
        const shape = shapeKey(t);
        return !seen.has(shape) && seen.add(shape) !== undefined;
      });
    if (members.length === 1) return members[0]!;
    const key = `union ${members.map(keyOf).join("|")}`;
    let t = unions.get(key);
    if (!t) {
      t = made<UnionType>({ kind: "union", members, fields: [], name }, key);
      unions.set(key, t);
    }
    return t;
  }

  // The members of `union` a value of `type` can go into: the one it is, or else every one it
  // fits. The checker allows exactly one.
  function membersFor(type: Type, union: UnionType): Type[] {
    const { members } = rec(union);
    if (members.includes(type)) return [type];
    const fitting = members.filter((m) => fits(type, m));
    // A JS value goes into the union's JS value, whichever declared shape each has.
    const js = (t: Type) => { const r = recOf(t); return r?.kind === "block" && r.which === "JsValue"; };
    return fitting.length > 0 || !js(type) ? fitting : members.filter(js);
  }

  function typeParameter(name: string, bound: Bound | undefined): ParamType {
    const t = made<ParamType>({ kind: "param", name, bound, fields: bound ? rec(bound).fields : [] }, `param ${declared++}`);
    return t;
  }

  function refType(to: Type, mutable: boolean, life?: string): RefType {
    const key = `${mutable ? "mut" : "ref"} ${keyOf(to)}${life ? ` ${life}` : ""}`;
    let t = refs.get(key);
    if (!t) {
      t = made<RefType>({ kind: "ref", to, mutable, fields: [], life }, key);
      refs.set(key, t);
    }
    return t;
  }

  const refs = new Map<string, RefType>();

  function fixedType(element: Type, size: usize): FixedType {
    const key = `fixed ${size} ${keyOf(element)}`;
    let t = fixeds.get(key);
    if (!t) {
      t = made<FixedType>({ kind: "fixed", element, size, fields: [] }, key);
      fixeds.set(key, t);
    }
    return t;
  }
  const fixeds = new Map<string, FixedType>();

  function arrayType(element: Type): ArrayType {
    const key = `[${keyOf(element)}]`;
    let t = arrays.get(key);
    if (!t) {
      t = made<ArrayType>({ kind: "array", element, fields: [] }, key);
      arrays.set(key, t);
    }
    return t;
  }

  const arrays = new Map<string, ArrayType>();

  // Sets the type a recursive type stands for. An array is on the heap already, so where the
  // type reaches itself through one, that array holds the type itself rather than a block, and is
  // the array `Tree[]` means wherever it is written. The type then holds itself, a loop the walks
  // over types stop at by the recursive type kept for it.
  function standsFor(back: RecursiveType, of: Type) {
    back.of = of;
    // A Map that leads back holds the type inline too, as an array does, so a Map written with
    // the type is the one the type holds.
    const r = recOf(of);
    if (typeof of !== "string" && r?.kind !== "map") {
      for (const map of [...maps.values()]) {
        const m = rec(map);
        if (m.value !== back) continue;
        map.value = of;
        maps.set(`${m.set ? "Set" : "Map"}<${keyOf(m.key)},${keyOf(of)}>`, map);
        ties.set(of, back);
      }
    }
    const array = arrays.get(`[${keyOf(back)}]`);
    // A type that is itself an array, as `type T = T[]`, has no other part to hold, so its
    // elements stay blocks.
    if (!array || typeof of === "string" || r?.kind === "array") return;
    array.element = of;
    arrays.set(`[${keyOf(of)}]`, array);
    ties.set(of, back);
    // Its members stay as they are too, so one narrowed to is still a member of it.
    if (r?.kind === "union") for (const m of r.members) if (typeof m !== "string" && rec(m).kind === "object") members.set(m, back);
  }

  // The type holding itself that each member of its union belongs to.
  const members = new TypeMap<Exclude<Type, string>, RecursiveType>();

  const ties = new TypeMap<Exclude<Type, string>, RecursiveType>();

  // The recursive type a type holding itself through an array was made with.
  const tiedBy = (t: Type): RecursiveType | undefined => (typeof t === "string" ? undefined : ties.get(t));

  function mapType(key: Type, value: Type, set = false): MapType {
    const id = `${set ? "Set" : "Map"}<${keyOf(key)},${keyOf(value)}>`;
    let t = maps.get(id);
    if (!t) {
      t = made<MapType>({ kind: "map", key, value, set, fields: [] }, id);
      maps.set(id, t);
    }
    return t;
  }

  const maps = new Map<string, MapType>();

  // The variant `member` of an enum declaration (by its unique id) with these type arguments.
  function variantType(enumName: string, id: usize, member: string, args: Type[], payload: Type[]): VariantType {
    const key = `variant ${id} ${member} <${args.map(keyOf).join(",")}>`;
    let t = variants.get(key);
    if (!t) {
      const shown = args.length > 0 ? `${enumName}<${args.map(show).join(", ")}>` : enumName;
      t = made<VariantType>({ kind: "variant", name: `${shown}.${member}`, member, enum: enumName, fields: payload.map((type, i) => ({ name: String(i), type })), args });
      variants.set(key, t);
      // A short key of its own, so an enum nested in itself doesn't double its key each level.
      keys.set(t, `variant#${variants.size}`);
    }
    return t;
  }

  const variants = new Map<string, VariantType>();

  // Whether a value of `t` holds a reference anywhere, which only lifetimes could keep valid. A
  // class met again inside itself adds nothing; one that contains itself is refused elsewhere.
  function holdsRef(t: Type, seen: TypeSet<Type> = new TypeSet<Type>()): boolean {
    if (typeof t === "string" || seen.has(t)) return false;
    seen.add(t);
    const holds = (u: Type) => holdsRef(u, seen);
    const r = rec(t);
    if (r.kind === "ref" || (r.kind === "dyn" && borrowing.has(r.of))) return true;
    // A type parameter holds references when what it stands for, or its bound, does.
    if (r.kind === "param") return r.concrete ? holds(r.concrete) : r.bound !== undefined && holds(r.bound);
    if (r.kind === "union") return r.members.some(holds);
    if (r.kind === "recursive") return holds(r.of);
    if (r.kind === "array" || r.kind === "fixed") return holds(r.element);
    if (r.kind === "map") return holds(r.value);
    if (r.kind === "variant") return r.fields.some((f) => holds(f.type));
    if (r.kind === "class") return r.fields.some((f) => holds(f.type)) || (r.base !== undefined && holds(r.base));
    // A generator borrows what its parameters do; its frame's own references point into itself.
    if (r.kind === "generator" || r.kind === "future") return r.params.some((f) => holds(f.type));
    return (r.kind === "object" || r.kind === "closure") && r.fields.some((f) => holds(f.type));
  }

  // The signatures of callbacks that run while a lock is held, so their bodies can't await; and
  // of those changing a shared value, whose interior-mutable parts others borrow unlocked.
  const lockCallbacks = new TypeSet<FunctionType>();
  const sharedCallbacks = new TypeSet<FunctionType>();

  // A type parameter as an instance sees it: standing for `concrete`, which has no type
  // parameter in it.
  function wrapped(name: string, bound: Bound | undefined, concrete: Type): ParamType {
    const key = `param ${name} ${bound ? keyOf(bound) : ""} as ${keyOf(concrete)}`;
    let t = wrappers.get(key);
    if (!t) {
      t = made<ParamType>({ kind: "param", name, bound, fields: bound ? rec(bound).fields : [], concrete }, key);
      wrappers.set(key, t);
    }
    return t;
  }

  const wrappers = new Map<string, ParamType>();

  // A type with each instance's type parameter replaced by the concrete type it stands for. A
  // generic class made from one becomes the class made from what it stands for.
  function lower(t: Type): Type {
    // A generic interface made from type parameters is the one made from what they stand for.
    if (typeof t === "string") return t;
    const r = rec(t);
    if (r.kind === "interface" && r.generic?.args.some((a) => lower(a) !== a)) return instanceInterface(t as InterfaceType, r.generic.args.map(lower));
    if (r.kind === "dyn" && rec(r.of).generic?.args.some((a) => lower(a) !== a)) return dynType(lower(r.of) as InterfaceType);
    if (r.kind === "dyn" && r.shown !== undefined) return dynType(r.of);
    if (r.kind === "literal" || r.kind === "interface" || r.kind === "closure" || r.kind === "function" || r.kind === "generator" || r.kind === "future" || r.kind === "dyn" || r.kind === "regex") return t;
    if (r.kind === "param") return r.concrete ? lower(r.concrete) : t;
    if (r.kind === "pattern") return "string";
    if (r.kind === "pointer") return pointerType(lower(r.to), r.mutable);
    if (r.kind === "handle") return r.joined ? joinedType(lower(r.joined.base) as HandleType, r.joined.panic) : handleType(lower(r.gives), r.throws && lower(r.throws));
    if (r.kind === "interior") return interiorType(r.which, lower(r.of));
    if (r.kind === "shared") return sharedType(lower(r.of));
    if (r.kind === "block") return blockType(r.which, lower(r.of));
    if (r.kind === "map") return mapType(lower(r.key), lower(r.value), r.set);
    if (r.kind === "recursive") return r.args.some((a) => lower(a) !== a) ? remade(t as RecursiveType, () => lower(r.of), r.args.map(lower)) : t;
    // A type holding itself through an array is remade from its type arguments.
    const tied = ties.get(t);
    if (tied) {
      const { args } = rec(tied);
      if (heldBlocks.get(t) !== tied) return args.some((a) => lower(a) !== a) ? rec(instanceRecursive(tied, args.map(lower))).of : t;
    }
    const loop = members.get(t);
    if (loop && !rec(loop).args.some((a) => lower(a) !== a)) return t;
    let found = lowered.get(t);
    if (!found) {
      if (r.kind === "class") found = r.generic?.args.some((a) => lower(a) !== a) ? instanceClass(t as ClassType, r.generic.args.map(lower)) : t;
      else if (r.kind === "ref") found = refType(lower(r.to), r.mutable, r.life);
      else if (r.kind === "array") found = arrayType(lower(r.element));
      else if (r.kind === "fixed") found = fixedType(lower(r.element), r.size);
      else if (r.kind === "variant") found = r.args.some((a) => lower(a) !== a) ? instanceVariant(t as VariantType, r.args.map(lower)) : t;
      else if (r.kind === "object" && r.match) found = t;
      else if (r.kind === "object" && r.tuple) found = retuple(t as ObjectType, lower);
      else found = r.kind === "union" ? unionType(r.members.map(lower), r.name) : objectType(r.fields.map(({ optional: _, ...f }) => ({ ...f, type: lower(f.type) })));
      lowered.set(t, found);

    }
    return found;
  }

  const lowered = new TypeMap<Exclude<Type, string>, Type>();

  // A type with some of its parts swapped for others, looking inside objects and unions.
  function replaced(t: Type, swap: TypeMap<Type, Type>): Type {
    const found = swap.get(t);
    if (found) return found;
    if (typeof t === "string") return t;
    const r = rec(t);
    if (r.kind === "class") {
      const args = r.generic?.args.map((a) => heldArgument(replaced(a, swap)));
      return args && args.some((a, i) => a !== r.generic!.args[i]) ? instanceClass(t as ClassType, args) : t;
    }
    if (r.kind === "ref") return refType(replaced(r.to, swap), r.mutable, r.life);
    if (r.kind === "interface" && r.generic) {
      const args = r.generic.args.map((a) => heldArgument(replaced(a, swap)));
      return args.some((a, i) => a !== r.generic!.args[i]) ? instanceInterface(t as InterfaceType, args) : t;
    }
    if (r.kind === "function") {
      const params = r.params.map((p) => replaced(p, swap));
      const returns = replaced(r.returns, swap);
      const throws = r.throws && replaced(r.throws, swap);
      if (!params.some((p, i) => p !== r.params[i]) && returns === r.returns && throws === r.throws) return t;
      const made = functionType(r.names, params, returns, throws);
      // A generic one stays generic, the types around it it was written among replaced too.
      if (r.generic) {
        made.name = `<${r.generic.names.join(", ")}>${rec(made).name}`;
        made.generic = { ...r.generic, scope: new Map([...r.generic.scope].map(([n, x]) => [n, replaced(x, swap)])) };
      }
      return made;
    }
    // A stored callable is remade from the function type it was written as.
    const fn = r.kind === "dyn" ? callableOf.get(r.of) : undefined;
    if (fn) {
      const made = replaced(fn, swap);
      return made === fn ? t : callableType(made as FunctionType);
    }
    if (r.kind === "array") return arrayType(replaced(r.element, swap));
    if (r.kind === "fixed") return fixedType(replaced(r.element, swap), r.size);
    if (r.kind === "map") return mapType(replaced(r.key, swap), heldArgument(replaced(r.value, swap)), r.set);
    // What a lock, a shared value or a channel holds is a type argument, boxed as one.
    if (r.kind === "interior" || r.kind === "shared" || (r.kind === "block" && r.which === "Channel")) {
      const of = heldArgument(replaced(r.of, swap));
      if (of === r.of) return t;
      return r.kind === "interior" ? interiorType(r.which, of) : r.kind === "shared" ? sharedType(of) : blockType("Channel", of);
    }
    if (r.kind === "variant") {
      const args = r.args.map((a) => heldArgument(replaced(a, swap)));
      return args.some((a, i) => a !== r.args[i]) ? instanceVariant(t as VariantType, args) : t;
    }
    const tied = ties.get(t);
    if (tied && heldBlocks.get(t as UnionType) !== tied) {
      const tiedArgs = rec(tied).args;
      const args = tiedArgs.map((a) => replaced(a, swap));
      return args.some((a, i) => a !== tiedArgs[i]) ? rec(instanceRecursive(tied, args)).of : t;
    }
    if (r.kind === "recursive") {
      const args = r.args.map((a) => replaced(a, swap));
      return args.some((a, i) => a !== r.args[i]) ? remade(t as RecursiveType, () => replaced(r.of, swap), args) : t;
    }
    if (r.kind !== "object" && r.kind !== "union") return t;
    if (r.kind === "object" && r.match) return t;
    if (r.kind === "object" && r.tuple) return retuple(t as ObjectType, (e) => replaced(e, swap));
    return r.kind === "union" ? unionType(r.members.map((m) => replaced(m, swap)), r.name) : objectType(r.fields.map((f) => ({ ...f, type: replaced(f.type, swap) })));
  }

  // The class a generic class's type arguments make, which only the checker can declare.
  let instanceClass = (c: ClassType, _args: Type[]): ClassType => c;
  function lowersClasses(f: typeof instanceClass) {
    instanceClass = f;
  }

  // The same variant of a generic enum made with other type arguments, which only the checker
  // can make.
  let instanceVariant = (v: VariantType, _args: Type[]): VariantType => v;
  let instanceInterface = (t: InterfaceType, _args: Type[]): InterfaceType => t;
  function lowersInterfaces(f: typeof instanceInterface) {
    instanceInterface = f;
  }
  function lowersVariants(f: typeof instanceVariant) {
    instanceVariant = f;
  }

  // A string that is the same exactly when two types are, for keying instances.
  function keyOf(t: Type): string {
    return typeof t === "string" ? t : `{${keys.get(t)}}`;
  }

  // `[A, B]`: laid out as an object of fields `0` and `1`, but a type of its own.
  function tupleType(elements: Type[], required: usize = elements.length, rest?: Type): ObjectType {
    const key = `tuple ${elements.map(keyOf).join(",")}${required < elements.length ? `?${required}` : ""}${rest === undefined ? "" : `...${keyOf(rest)}`}`;
    let t = interned.get(key);
    if (!t) {
      const fields: Field[] = elements.map((type, i) => ({ name: String(i), type }));
      if (rest !== undefined) fields.push({ name: "...", type: arrayType(rest) });
      t = made<ObjectType>({ kind: "object", fields: rec(objectType(fields)).fields, tuple: true }, key);
      if (required < elements.length) t.required = required;
      if (rest !== undefined) t.rest = rest;
      interned.set(key, t);
    }
    return t;
  }

  // The same tuple shape over elements mapped by `f`.
  const retuple = (t: ObjectType, f: (e: Type) => Type): ObjectType => {
    const { required, rest } = rec(t);
    return tupleType(elementsOf(t).map(f), required, rest === undefined ? undefined : f(rest));
  };

  // What `re.exec(s)` gives when it matches: the whole match and each capture, a capture that
  // may not take part being `string | null`, then where the match starts, the string matched, and,
  // when the pattern names groups, an object of them.
  function matchType(t: RegexType): ObjectType {
    const key = `match ${keys.get(t)}`;
    let found = interned.get(key);
    if (!found) {
      const maybe = unionType(["string", "null"]);
      const { captures } = rec(t);
      const names = [...new Set(captures.flatMap((c) => (c.name === undefined ? [] : [c.name])))];
      // A name shared by groups in different alternatives holds whichever took part.
      const named = names.map((name) => {
        const groups = captures.filter((c) => c.name === name);
        return { name, type: groups.length === 1 && !groups[0]!.optional ? "string" as Type : maybe };
      });
      const fields: Field[] = [
        { name: "0", type: "string" },
        ...captures.map((c, i) => ({ name: String(i + 1), type: c.optional ? maybe : "string" as Type })),
        { name: "index", type: "i64" },
        { name: "input", type: "string" },
        ...(named.length > 0 ? [{ name: "groups", type: objectType(named) as Type }] : []),
      ];
      found = made<ObjectType>({ kind: "object", fields: rec(objectType(fields)).fields, tuple: true, match: true }, key);
      interned.set(key, found);
    }
    return found;
  }

  function objectType(fields: Field[]): ObjectType {
    const sorted = fields.toSorted((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    // A nested key is braced, so `{ a: { x }; y }` and `{ a: { x; y } }` get different keys.
    const key = sorted.map((f) => `${f.readonly ? "readonly " : ""}${JSON.stringify(f.name)}${f.optional ? `?${f.optional}` : ""}:${keyOf(f.type)}`).join(",");
    let t = interned.get(key);
    if (!t) {
      t = made<ObjectType>({ kind: "object", fields: sorted }, key);
      interned.set(key, t);
    }
    return t;
  }

  // A key that is the same exactly when two types' values have one shape: like `keyOf`, but
  // blind to which fields are marked optional, so `{ a?: T }` and `{ a: T | null }` share one.
  function shapeKey(t: Type): string {
    if (typeof t === "string") return t;
    if (ties.has(t)) return keyOf(t);
    let found = shapeKeys.get(t);
    if (found === undefined) {
      const r = rec(t);
      if (r.kind === "object" && r.tuple) found = `[${elementsOf(t as ObjectType).map(shapeKey).join(",")}${r.required === undefined ? "" : `?${r.required}`}${r.rest === undefined ? "" : `...${shapeKey(r.rest)}`}]`;
      else if (r.kind === "object") found = `{${r.fields.map((f) => `${f.readonly ? "readonly " : ""}${JSON.stringify(f.name)}:${shapeKey(f.type)}`).join(",")}}`;
      else if (r.kind === "array") found = `${shapeKey(r.element)}[]`;
      else if (r.kind === "fixed") found = `FixedArray<${shapeKey(r.element)},${r.size}>`;
      else if (r.kind === "map") found = r.set ? `Set<${shapeKey(r.key)}>` : `Map<${shapeKey(r.key)},${shapeKey(r.value)}>`;
      else if (r.kind === "union") found = `(${r.members.map(shapeKey).join("|")})`;
      else if (r.kind === "ref") found = `${r.mutable ? "mut" : "ref"} ${shapeKey(r.to)}${r.life ? ` ${r.life}` : ""}`;
      // A type parameter standing for a concrete type has that type's shape.
      else if (r.kind === "param" && r.concrete) return shapeKey(r.concrete);
      else if (r.kind === "class" && r.generic) found = `${r.generic.name}<${r.generic.args.map(shapeKey).join(",")}>`;
      else found = keyOf(t);
      shapeKeys.set(t, found);
    }
    return found;
  }
  const shapeKeys = new TypeMap<Exclude<Type, string>, string>();

  // A type without the empty value an optional field adds.
  function withoutNull(t: Type): Type {
    const r = recOf(t);
    return r?.kind === "union" ? unionType(r.members.filter((m) => m !== "null")) : t;
  }

  // A field written `name?: T`: its type holds the empty value, and it remembers whether `?` added it.
  function optionalField(name: string, written: Type): Field {
    const r = recOf(written);
    const held = written === "null" || (r?.kind === "union" && r.members.includes("null"));
    return { name, type: held ? written : unionType([written, "null"]), optional: held ? "held" : "added" };
  }

  // Whether a value of `from` fits where `to` is declared: the same type, or an object or
  // instance with at least the fields of the object type `to`, each fitting in turn.
  const assumed = new Set<string>();

  function fits(from: Type, to: Type): boolean {
    // A string literal fits a pattern it matches; a pattern is a string. Both are strings once
    // lowered, so this comes first.
    const fr = recOf(from);
    const tr = recOf(to);
    const target = tr?.kind === "param" && tr.concrete ? tr.concrete : to;
    if (from !== target && recOf(target)?.kind === "pattern") {
      if (fr?.kind === "union") return fr.members.every((m) => fits(m, target));
      return fr?.kind === "literal" && typeof fr.value === "string" && !fr.owner && textFits(fr.value, target);
    }
    // In an instance, a type parameter and the concrete type it stands for are one value.
    if (from === to || sameLowered(from, to) || from === "never" || sameCallable(from, to)) return true;
    // So does a value of a type parameter fit as what it stands for, a literal as its base type.
    if (fr?.kind === "param" && fr.concrete !== undefined && fits(fr.concrete, to)) return true;
    // A future fits the `Promise<T>` describing it, as an async function's result.
    if (tr?.kind === "interface" && promised.has(to as InterfaceType) && fr?.kind === "future") return !fr.throws && lower(fr.gives) === lower(promised.get(to as InterfaceType)!);
    // A reference reads the value where it lives, so it fits only a reference to the same type;
    // a mutable one also lends itself as shared. Lifetimes are checked on their own.
    // A reference into a recursive type's block is one to the type it stands for.
    if (tr?.kind === "ref") {
      return fr?.kind === "ref" && (fr.mutable || !tr.mutable) && lower(unfold(fr.to)) === lower(tr.to);
    }
    // Any regex is a \`RegExp\`; all of them are the same pointer to a program.
    if (to === ANY_REGEX) return fr !== undefined && (fr.kind === "regex" || (fr.kind === "param" && recOf(fr.bound)?.kind === "regex"));
    // A `MutPtr<T>` may be used as a `Ptr<T>`, as Rust's `*mut T` coerces to `*const T`.
    if (tr?.kind === "pointer") {
      return fr?.kind === "pointer" && (fr.mutable || !tr.mutable) && lower(fr.to) === lower(tr.to);
    }
    // A recursive type is the type it stands for. Its type holds it again, so a pair being
    // compared is taken to fit while its parts are.
    // A union holding the recursive type itself takes it as it is.
    const held = tr?.kind === "union" && tr.members.includes(from);
    if (!held && (fr?.kind === "recursive" || tr?.kind === "recursive")) {
      const pair = `${keyOf(from)} ${keyOf(to)}`;
      if (assumed.has(pair)) return true;
      assumed.add(pair);
      try {
        return fits(unfold(from), unfold(to));
      } finally {
        assumed.delete(pair);
      }
    }
    if (tr?.kind === "union") {
      if (fr?.kind === "union") return fr.members.every((m) => fits(m, to));
      return tr.members.some((m) => fits(from, m));
    }
    // A union fits where every member it may hold does, as an enum fits an i64.
    if (fr?.kind === "union") return fr.members.every((m) => fits(m, to));
    if (fr?.kind === "pattern") return to === "string";
    if (fr?.kind === "literal") return baseOf(from as LiteralType) === to;
    // A closure fits a function type taking the same parameters, or the first of them, and
    // returning what it returns, or anything when it returns nothing.
    // A parameter of a function type fits through its signature.
    if (tr?.kind === "function") {
      const given = fr?.kind === "param" && fr.bound && rec(fr.bound).kind === "function" ? fr.concrete ?? fr.bound : from;
      // A stored callable fits by the function type it was written as.
      const g = recOf(given);
      const fn = g?.kind === "dyn" ? callableOf.get(g.of) : undefined;
      const callable = fn !== undefined;
      const sig = recOf(fn ?? given);
      // A stored callable's call passes all its parameters, so it takes exactly as many.
      if (callable && sig?.kind === "function" && sig.params.length !== tr.params.length) return false;
      // What it throws fits what the type throws, and one throwing nothing fits any.
      const throws = sig?.kind === "closure" || sig?.kind === "function" ? sig.throws : undefined;
      const caught = throws === undefined || (tr.throws !== undefined && fits(throws, tr.throws));
      return (sig?.kind === "closure" || sig?.kind === "function") && sig.params.length <= tr.params.length
        && sig.params.every((p, i) => lower(p) === lower(tr.params[i]!) || sameCallable(p, tr.params[i]!)) && (tr.returns === "void" || fits(sig.returns, tr.returns)) && caught;
    }
    if (fr?.kind === "ref") return false;
    // A tuple fits only a tuple of its length, element by element.
    if (isTuple(from) || isTuple(to)) {
      const [a, b] = [rec(from as ObjectType), rec(to as ObjectType)];
      // A tuple fits one of its shape, giving at least the elements that one requires.
      const shaped = isTuple(from) && isTuple(to) && a.fields.length === b.fields.length && (a.rest === undefined) === (b.rest === undefined);
      return shaped && (a.required ?? a.fields.length) >= (b.required ?? b.fields.length) && b.fields.every((f) => fits(field(from as ObjectType, f.name)!.type, f.type));
    }
    // An interface is satisfied by members, which only the checker can look up.
    if (typeof from === "string" || tr?.kind !== "object" || fr?.kind === "interface") return false;
    // A type parameter fits through its bound's fields, as any instance of it would.
    // A value may leave out a field whose type is an Option.
    return tr.fields.every((f) => {
      const found = field(from, f.name);
      if (!found) return isOption(f.type);
      return (found.access ?? "public") === "public" && fits(found.type, f.type);
    });
  }

  // A field, by its path, that a value of `from` holds read-only but `to` lets be written: lent
  // mutably as a `to`, it could be changed. A readonly field only fits a writable one by copy.
  function unlocks(from: Type, to: Type, path = ""): string | undefined {
    from = lower(from);
    const tr = recOf(to);
    if (typeof from === "string" || (tr?.kind !== "object" && tr?.kind !== "interface")) return undefined;
    for (const f of tr.fields) {

      const found = field(from, f.name);
      if (!found) continue;
      if (found.readonly && !f.readonly) return `${path}${f.name}`;
      const deeper = unlocks(found.type, f.type, `${path}${f.name}.`);
      if (deeper) return deeper;
    }
    return undefined;
  }

  // The instance each closure, future and generator type is made for: what tells it apart from
  // others of its signature, which show alike.
  const madeFor = new TypeMap<Exclude<Type, string>, string>();
  let describing = false;

  // `show`, but with closures, futures and generators anywhere in the type named by the instance
  // each is made for, for naming what is generated for a type the same way in every program.
  function described(t: Type): string {
    const was = describing;
    describing = true;
    try {
      return show(t);
    } finally {
      describing = was;
    }
  }

  // How a type reads in a diagnostic, as TypeScript would print it.
  function show(t: Type): string {
    if (t === "f64") return "number";
    if (typeof t === "string") return t;
    if (describing && madeFor.has(t)) return madeFor.get(t)!;
    // A type holding itself is shown by its name.
    const tied = ties.get(t);
    if (tied) return describing ? `part of ${rec(tied).name}` : rec(tied).name;
    const r = rec(t);
    if (r.kind === "literal" && r.owner) return `${r.owner.enum}.${r.owner.member}`;
    if (r.kind === "literal") return typeof r.value === "string" ? JSON.stringify(r.value) : String(r.value);
    if (r.kind === "pattern") {
      const text = (q: string) => q.replaceAll("\\", "\\\\").replaceAll("`", "\\`").replaceAll("${", "\\${");
      return `\`${r.quasis.map((q, i) => (i === 0 ? text(q) : `\${${show(r.holes[i - 1]!)}}${text(q)}`)).join("")}\``;
    }
    if (r.kind === "union") return r.name ?? r.members.map(show).join(" | ");
    if (r.kind === "ref") return `${r.mutable ? "Mut" : "Ref"}<${show(r.to)}>`;
    if (r.kind === "pointer") return `${r.mutable ? "MutPtr" : "Ptr"}<${show(r.to)}>`;
    if (r.kind === "regex") return "RegExp";
    if (r.kind === "array") {
      const e = r.element;
      const er = recOf(e);
      const wrap = er !== undefined && ((er.kind === "union" && !er.name) || er.kind === "function" || er.kind === "closure" || (er.kind === "dyn" && callableOf.has(er.of)));
      return wrap ? `(${show(e)})[]` : `${show(e)}[]`;
    }
    if (r.kind === "fixed") return `FixedArray<${show(r.element)}, ${r.size}>`;
    if (r.kind === "map") return r.set ? `Set<${show(r.key)}>` : `Map<${show(r.key)}, ${show(r.value)}>`;
    if (r.kind === "generator") return `Generator<${show(r.yields)}>`;
    if (r.kind === "future") return `Promise<${show(r.gives)}>${r.throws ? ` throws ${show(r.throws)}` : ""}${describing ? ` ${r.name}(${r.frame.map((f) => show(f.type)).join(", ")})` : ""}`;
    if (r.kind === "interior") return `${r.which}<${show(r.of)}>`;
    if (r.kind === "shared") return `shared<${show(r.of)}>`;
    // A JS handle shows the shape its declaration gives it.
    // A package's shape is shown by the name the package gives it, not the one linking gave it.
    if (r.kind === "block") return r.which === "Channel" ? `Channel<${show(r.of)}>` : r.which === "JsValue" && r.of !== "void" ? show(r.of).replace(/-fsh\d+/g, "") : r.which;
    if (r.kind === "dyn") return !describing && (callableOf.has(r.of) || promised.has(r.of)) ? r.shown ?? rec(r.of).name : `Dyn<${rec(r.of).name}>`;
    if (r.kind === "recursive" && describing) return `recursive ${r.name}`;
    if (r.kind === "handle") return `${r.joined ? "Promise" : "JoinHandle"}<${show(r.gives)}>${r.throws ? ` throws ${show(r.throws)}` : ""}`;
    if (r.kind !== "object") return r.name;
    if (r.match && !describing) return "RegExpExecArray";
    if (r.tuple && !r.match) return `[${[...elementsOf(t as ObjectType).map((e, i) => (i < (r.required ?? Infinity) ? show(e) : `${show(withoutNull(e))}?`)), ...(r.rest === undefined ? [] : [`...${show(arrayType(r.rest))}`])].join(", ")}]`;
    if (r.fields.length === 0) return "{}";
    const name = (n: string) => (/^[A-Za-z_$][\w$]*$/.test(n) ? n : JSON.stringify(n));
    return `{ ${r.fields.map((f) =>
 `${f.readonly ? "readonly " : ""}${name(f.name)}${f.optional && f.optional !== "undefined" ? "?" : ""}: ${show(f.optional === "added" ? withoutNull(f.type) : f.type)}`).join("; ")} }`;
  }

  return {
    rec, textFits, isOption, optionRef, jsShape, isPlainJs, holdsPlainJs, unequal, uninspectable, unfold, widenEnum, widenLet, baseOf, isSubclass,
    isCopy, holdsMut, holdsPart, holdsHandle, interiorMutable, holdsInterior, elementsOf, isTuple, field, fieldPath, allFields, derives,
    openThrows, patternType, holdsPattern, sameLowered, interiorType, sharedType, dynType, callableOf, uncrossable, jsUntyped, jsOptional, jsUncalled,
    setJsError, jsView, timerCallback, callableType, sameCallable, stored, heldArgument, jsConverts, keptByJs, jsTakes, jsRead, blockType, leafOf,
    leafFuture, handleType, joinedType, futureType, combinedOf, settledType, settledParts, combinedFuture, promiseInterface, borrowing, lentPromise, sharesDyn,
    promiseElement, regexType, recursiveType, blockFor, holdsBlock, lowersRecursive, partOfItself, unjson, unfolded, pointerType, classType,
    interfaceType, generatorType, nextResult, generatorInterface, asyncGeneratorInterface, yieldsOf, generatorElement, functionType, closureType, genericFunctionType,
    literalType, standInLiteral, unionType, membersFor, typeParameter, refType, fixedType, arrayType, standsFor, tiedBy, mapType, variantType,
    holdsRef, lockCallbacks, sharedCallbacks, wrapped, lower, replaced, lowersClasses, lowersInterfaces, lowersVariants, keyOf, tupleType, retuple,
    matchType, objectType, shapeKey, withoutNull, optionalField, fits, unlocks, madeFor, described, show, typeOf,
  };
}

export type Typing = ReturnType<typeof newTyping>;
