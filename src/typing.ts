import type { CompileError } from "./diag.ts";
import type { Expr } from "./parser.ts";
import { WeakNodeMap, type Id } from "./nodes.ts";
import type { RustClass } from "./rust.ts";

// The checker's types: a primitive's name, or the id of a record in its program's arena, read
// through `rec`. Object types are interned, so two types are structurally identical, the same
// fields with the same types in any order, exactly when they are the same id.

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
// A tuple and a match also link `shape`, the object of their fields, and hold copies of its fields.
export type ObjectRecord = { kind: "object"; fields: Field[]; tuple?: true; match?: true; required?: usize; rest?: Type; shape?: ObjectType };
export type ObjectType = TypeId<ObjectRecord>;

// A class is nominal: one per declaration, so `===` is identity. Its own fields are in
// declaration order, filled in once resolved, and follow the base it embeds in memory.
// An instance of a generic class also records the class it came from and its type arguments.
// `rust`: the Rust type a class a Rust module declares stands for. An abstract class only ever
// exists embedded in a concrete one, so it is never a value's type.
export type ClassRecord = { kind: "class"; name: string; fields: Field[]; base?: ClassType; generic?: { name: string; args: Type[] }; rust?: RustClass; abstract?: true };
export type ClassType = TypeId<ClassRecord>;

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
export type InterfaceRecord = { kind: "interface"; name: string; fields: Field[]; methods: Method[]; generic?: { name: string; args: Type[] } };
export type InterfaceType = TypeId<InterfaceRecord>;

// A type parameter: it stands for any type satisfying its bound, and offers only the bound's
// fields. At the definition it stands for nothing in particular. In an instance it also holds
// the concrete type it stands for, so the instance checks exactly as the definition did while
// codegen lays the value out as its concrete type; `lower` removes it before codegen.
export type ParamRecord = { kind: "param"; name: string; bound: Bound | undefined; fields: Field[]; concrete?: Type };
export type ParamType = TypeId<ParamRecord>;

// A literal type has one value, known at compile time, so on its own it takes no space: it
// has no fields. An integer or boolean literal fits its base type; a string literal has none yet.
// An enum's member is a literal that knows its enum, so a plain literal is never one.
export type LiteralRecord = {
  kind: "literal"; value: string | bigint | boolean; fields: Field[];
  // For an enum's member: the enum, unique to its declaration, and the enum's own type.
  owner?: { enum: string; member: string; id: usize; of?: Type };
};
export type LiteralType = TypeId<LiteralRecord>;

// A union holds a value of one of its members: a tag naming which, then that member's value.
// It has no fields; reaching into one takes narrowing to a member first.
export type UnionRecord = { kind: "union"; members: Type[]; fields: Field[]; name?: string };
export type UnionType = TypeId<UnionRecord>;

// A borrow of a value that lives elsewhere: `Ref<T>` shared, `Mut<T>` mutable. It is a pointer
// to the value, reads through to it, and copies like a pointer. A written lifetime names the
// function's lifetime parameter it lives for; it is checked, then erased.
export type RefRecord = { kind: "ref"; to: Type; mutable: boolean; fields: Field[]; life?: string };
export type RefType = TypeId<RefRecord>;

// A member of a data-carrying enum: a nominal value holding positional fields named `0`, `1`,
// ..., laid out as an object's. One per enum instance and member, so `===` is identity. A
// generic enum's variant knows the enum's type arguments, to be made again from lowered ones.
export type VariantRecord = {
  kind: "variant"; name: string; member: string; enum: string; fields: Field[]; args: Type[];
  // The enum it belongs to, a union of its variants, once the enum is made.
  of?: Type;
};
export type VariantType = TypeId<VariantRecord>;

// An owned array of elements of one type, growable like Rust's Vec. One per element type, so
// `===` is identity. It has no fields; its length and elements are reached by name and index.
export type ArrayRecord = { kind: "array"; element: Type; fields: Field[] };
export type ArrayType = TypeId<ArrayRecord>;

// `FixedArray<T, N>`: exactly `size` elements stored inline, laid out as `[size x T]`; interned,
// so `===` is identity.
export type FixedRecord = { kind: "fixed"; element: Type; size: usize; fields: Field[] };
export type FixedType = TypeId<FixedRecord>;
// `Map<K, V>` and `Set<T>` (a Set's value is `void`): a pointer to an owned hash table in the
// runtime, its entries kept in insertion order.
export type MapRecord = { kind: "map"; key: Type; value: Type; set: boolean; fields: Field[] };
export type MapType = TypeId<MapRecord>;

// A closure: an arrow function and what it captures. Each arrow, in each instance of the body
// it is written in, is its own type, so `===` is identity. Its value is its captures, laid out
// as its fields, which are never read by name.
// A closure that moves a captured value out of itself can run only once; `once` names one. A
// closure made in a generic body's definition check is never compiled, so it isn't concrete.
// A generic function used as a value, `generic` naming it, is a closure capturing nothing whose
// calls each instantiate that function, as calls of it by name do.
// `throws` is what a call of it may throw; an async arrow's error is its future's instead.
export type ClosureRecord = { kind: "closure"; name: string; params: Type[]; returns: Type; throws?: Type; fields: Field[]; once?: string; concrete: boolean; generic?: string };
export type ClosureType = TypeId<ClosureRecord>;

// A function type: the signature a closure must have to be passed where it is declared. Like an
// interface, it describes values without being one, so it never reaches codegen.
// A generic one, `<T>(x: T) => T`, is a family: `generic` holds its type parameters' names and
// the node it was written as, each call resolving it for that call's types.
// The type parameters around it, `scope`, are those it was written among; `own` are its type
// parameters' placeholders, in order, for comparing it with another.
export type Family = { names: string[]; node: unknown; scope: Map<string, Type>; own: Type[] };
export type FunctionRecord = { kind: "function"; name: string; names: string[]; params: Type[]; returns: Type; throws?: Type; fields: Field[]; generic?: Family };
export type FunctionType = TypeId<FunctionRecord>;

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
export type PatternRecord = { kind: "pattern"; quasis: string[]; holes: Hole[]; fields: Field[] };
export type PatternType = TypeId<PatternRecord>;
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

// A tuple's element types, in order, from its fields.
export function tupleElements(fields: Field[]): Type[] {
  return fields.filter((f) => /^\d+$/.test(f.name)).toSorted((a, b) => Number(a.name) - Number(b.name)).map((f) => f.type);
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

// A type that isn't a primitive: its record's index in its program's arena, from 21 up, since
// 1 to 20 are the primitives' ids. `R` is the record's kind, for tsc only.
export type TypeId<R> = usize & { readonly __record?: R };

// What a type's record holds.
export type TypeRecord = ObjectRecord | ClassRecord | InterfaceRecord | ParamRecord | LiteralRecord | PatternRecord | UnionRecord | RefRecord | ClosureRecord | FunctionRecord | ArrayRecord | FixedRecord | MapRecord | VariantRecord | GeneratorRecord | PointerRecord | FutureRecord | HandleRecord | InteriorRecord | SharedRecord | BlockRecord | DynRecord | RegexRecord | RecursiveRecord;

// The record a type of `T` has.
export type RecordOf<T> = T extends { readonly __record?: infer R } ? Exclude<R, undefined> : never;

// The ids the primitives key tables by, below every type record's.
const PRIMITIVES: Extract<Type, string>[] = ["i8", "i16", "i32", "i64", "i128", "isize", "u8", "u16", "u32", "u64", "u128", "usize", "f32", "f64", "boolean", "void", "null", "never", "string", "bigint"];
const PRIMITIVE_IDS = new Map(PRIMITIVES.map((p, i): [string, usize] => [p, i + 1]));

// The id a type keys a table by: a primitive's reserved one, or the type itself.
export const idOf = (t: Type): usize => (typeof t === "string" ? PRIMITIVE_IDS.get(t)! : t);

// The type an id keys.
const typeAt = (id: usize): Type => (id <= PRIMITIVES.length ? PRIMITIVES[id - 1]! : (id as Exclude<Type, string>));

// A `Map` from types, keyed by their ids.
export class TypeMap<K extends Type, V> {
  private table = new Map<usize, V>();

  constructor(entries?: Iterable<readonly [K, V]>) {
    if (entries) for (const [type, value] of entries) this.set(type, value);
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

  set(type: K, value: V): this {
    this.table.set(idOf(type), value);
    return this;
  }

  delete(type: K): boolean {
    return this.table.delete(idOf(type));
  }

  clear(): void {
    this.table.clear();
  }

  *keys(): IterableIterator<K> {
    for (const id of this.table.keys()) yield typeAt(id) as K;
  }

  values(): IterableIterator<V> {
    return this.table.values();
  }

  *entries(): IterableIterator<[K, V]> {
    for (const [id, value] of this.table) yield [typeAt(id) as K, value];
  }

  [Symbol.iterator](): IterableIterator<[K, V]> {
    return this.entries();
  }

  forEach(each: (value: V, type: K) => void): void {
    for (const [id, value] of this.table) each(value, typeAt(id) as K);
  }
}

// A `Set` of types, keyed by their ids.
export class TypeSet<K extends Type> {
  private table = new Set<usize>();

  constructor(types?: Iterable<K>) {
    if (types) for (const t of types) this.add(t);
  }

  get size(): usize {
    return this.table.size;
  }

  has(type: K): boolean {
    return this.table.has(idOf(type));
  }

  add(type: K): this {
    this.table.add(idOf(type));
    return this;
  }

  delete(type: K): boolean {
    return this.table.delete(idOf(type));
  }

  clear(): void {
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
export type InteriorType = TypeId<InteriorRecord>;

// Whether an interior type is laid out as a lock word, then what it holds.
export const isLock = (r: Ref<InteriorRecord>) => r.which === "Lock" || r.which === "RwLock";

// `shared<T>`: a counted pointer to a block holding the count, a lock word and the value, so
// every clone is the same value, read and changed from any thread.
export type SharedRecord = { kind: "shared"; of: Type; fields: Field[] };
export type SharedType = TypeId<SharedRecord>;

// `Dyn<I>`: a value of any type implementing interface I, owned in a heap block, with a vtable
// of what that type does: drop it, clone it, and each of I's members.
// A stored callable written with other parameter names is its own DynType, `shown` as written,
// for the same interface and key, which `lower` gives.
export type DynRecord = { kind: "dyn"; of: InterfaceType; fields: Field[]; shown?: string };
export type DynType = TypeId<DynRecord>;

// `Semaphore`, its `Permit` and `Channel<T>`: each a pointer to a counted block in the runtime,
// which tasks wait on without holding a thread. A Permit holds a count on its Semaphore. An
// `AbortController` and its `AbortSignal`s are handles to one block.
// A FileJob is a file read or write handed to the runtime's blocking pool.
// A JsValue is a value of the JS engine, which Fish holds without knowing its type.
export type BlockRecord = { kind: "block"; which: "Semaphore" | "Permit" | "Channel" | "AbortController" | "AbortSignal" | "TcpListener" | "TcpStream" | "UnixListener" | "UnixStream" | "UdpSocket" | "FileJob" | "JsValue"; of: Type; fields: Field[] };
export type BlockType = TypeId<BlockRecord>;

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
export type HandleType = TypeId<HandleRecord>;

// An async function's future, a `Promise<T>`: what it gives once awaited, what it may throw,
// its parameters, which say what it borrows, and the frame its state lives in, as a
// generator's. Polled where it lives and never moved after its first poll. One per async
// instance, so `===` is nominal identity; it has no properties.
export type FutureRecord = { kind: "future"; name: string; gives: Type; throws?: Type; fields: Field[]; params: Field[]; frame: Field[]; concrete: boolean };
export type FutureType = TypeId<FutureRecord>;

// `sleep(ms)`'s future: its state, then the delay, then the deadline the runtime sets.
const SLEEP_RECORD: FutureRecord = { kind: "future", name: "sleep", gives: "void", fields: [], params: [], frame: [{ name: "state", type: "i32" }, { name: "deadline", type: "i64" }], concrete: true };
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
const YIELD_NOW_RECORD: FutureRecord = { kind: "future", name: "yieldNow", gives: "void", fields: [], params: [], frame: [{ name: "state", type: "i32" }], concrete: true };
export const YIELD_NOW = 22 as FutureType;

// A raw pointer, `Ptr<T>` or `MutPtr<T>`: an address the borrow checker doesn't follow, used
// only inside `unsafe`. It copies like a number and owns nothing.
export type PointerRecord = { kind: "pointer"; to: Type; mutable: boolean; fields: Field[] };
export type PointerType = TypeId<PointerRecord>;

// A regex: its pattern and flags, which fix what each capture may hold. Its value points at a
// compiled program that never changes, so it copies freely and needs no drop.
// \`source\` is how JavaScript shows the pattern; \`pattern\` what is matched, which differ only for
// a \`new RegExp\` whose string held a \`/\` or a line terminator.
export type RegexRecord = { kind: "regex"; source: string; pattern: string; flags: string; captures: { name: string | undefined; optional: boolean }[]; fields: Field[]; any?: true };
export type RegexType = TypeId<RegexRecord>;

// The \`RegExp\` annotation: any regex. A parameter of it is an implicit type parameter, so each
// instance knows its regex; elsewhere it holds one whose pattern isn't known there.
const ANY_REGEX_RECORD: RegexRecord = { kind: "regex", source: "", pattern: "", flags: "", captures: [], fields: [], any: true };
export const ANY_REGEX = 23 as RegexType;

// Where a type leads back to itself, as `next` does in `type Node = { next: Node | null }`: a
// pointer to a block holding `of`, the type it stands for, which is set once that is made. It
// is that type everywhere but in its layout, and every walk over types stops at it.
// `args` are the alias's type arguments, so one made from type parameters is remade for what
// they stand for.
export type RecursiveRecord = { kind: "recursive"; name: string; args: Type[]; of: Type; fields: Field[] };
export type RecursiveType = TypeId<RecursiveRecord>;

// A generator: what it yields, its parameters, which say what it borrows, and the frame its
// state lives in, filled once the body is checked. It has no properties, so `fields` stays
// empty. One per generator instance, so `===` is nominal identity. An async one's `next()` gives
// a future, and its body may await between yields. `throws` is what advancing it may throw, and
// `sends` what `next(x)` gives the `yield` it resumes at.
export type GeneratorRecord = { kind: "generator"; name: string; yields: Type; fields: Field[]; params: Field[]; frame: Field[]; concrete: boolean; async?: boolean; throws?: Type; sends?: Type };
export type GeneratorType = TypeId<GeneratorRecord>;

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
  // Every record of this program, the type with id `id` at `id - 21`: the module constants'
  // first, which every program shares, then those it makes.
  private arena: TypeRecord[] = [SLEEP_RECORD, YIELD_NOW_RECORD, ANY_REGEX_RECORD];

  // The record a type that isn't a primitive stands for, which its changes are made through.
  rec<T extends Exclude<Type, string>>(t: T): RecordOf<T> {
    return this.arena[t - 21] as RecordOf<T>;
  }

  // The record of a type that isn't a primitive, or undefined for a primitive or no type.
  recOf<T extends Type>(t: T | undefined) {
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
      const { bits, signed } = INTEGERS[t];
      const n = BigInt(text);
      return signed ? n >= -(1n << BigInt(bits - 1)) && n < 1n << BigInt(bits - 1) : n >= 0n && n < 1n << BigInt(bits);
    }
    // As TypeScript's `${number}`: any text JavaScript reads as a finite number.
    if (isFloat(t)) return text.trim() !== "" && Number.isFinite(Number(text));
    if (typeof t === "string") return false;
    const r = this.rec(t);
    if (r.kind === "literal") return !r.owner && String(r.value) === text;
    if (r.kind === "union") return r.members.some((m) => this.textFits(text, m));
    if (r.kind === "pattern") {
      const parts = splitTemplate(text, r.quasis);
      return parts !== undefined && parts.every((p, i) => this.textFits(p, r.holes[i]!));
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
    if (!t || !this.isOption(t) || this.rec(t).members.length !== 2) return undefined;
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
  unequal(t: Type, eq: (t: ClassType | VariantType) => boolean, seen: TypeSet<Type> = new TypeSet<Type>()): Type | undefined {
    if (typeof t === "string" || seen.has(t)) return undefined;
    seen.add(t);
    const part = (u: Type) => this.unequal(u, eq, seen);
    const r = this.rec(t);
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
        const of = this.recOf(r.of);
        return (of?.kind === "union" ? of.members : [t])
          .flatMap((v) => { const w = this.recOf(v); return w?.kind === "variant" ? w.fields : []; })
          .map((f) => part(f.type)).find((p) => p !== undefined);
      }
      default:
        return t;
    }
  }

  // The part of a type that `console.log` can't print as Node's util.inspect would, or undefined:
  // every value but functions, handles and other runtime objects prints, a type parameter in each
  // instance once it is concrete.
  uninspectable(t: Type, seen: TypeSet<Type> = new TypeSet<Type>()): Type | undefined {
    if (typeof t === "string") return t === "void" ? t : undefined;
    if (seen.has(t)) return undefined;
    seen.add(t);
    const part = (u: Type) => this.uninspectable(u, seen);
    const first = (parts: Type[]) => parts.map(part).find((p) => p !== undefined);
    const r = this.rec(t);
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
        const of = this.recOf(r.of);
        return first((of?.kind === "union" ? of.members : [t]).flatMap((v) => { const w = this.recOf(v); return w?.kind === "variant" ? w.fields.map((f) => f.type) : []; }));
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
    if (r?.kind === "variant" && r.of) return r.of;
    return r?.kind === "literal" && r.owner?.of ? r.owner.of : t;
  }

  // A `let` holds its literal's whole type too, as in TypeScript: `let s = "a"` is a string.
  widenLet(t: Type): Type {
    const r = this.recOf(t);
    if (r?.kind === "literal" && !r.owner && typeof r.value === "string") return "string";
    // A \`let\` may later hold another regex, so it holds any.
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
    for (let x: ClassType | undefined = this.recOf(t)?.kind === "class" ? (t as ClassType) : undefined; x; x = this.rec(x).base) if (x === c) return true;

    return false;
  }

  isCopy(t: Type): boolean {
    if (typeof t === "string") return true;
    const r = this.rec(t);
    if (r.kind === "literal" || r.kind === "pattern" || r.kind === "ref" || r.kind === "pointer" || r.kind === "regex") return true;
    // A closure copies when what it captures does, and it changes nothing through it.
    if (r.kind === "closure") return r.fields.every((f) => this.isCopy(f.type) && !this.holdsMut(f.type));
    // A parameter of a generic function type holds a generic function value, which captures nothing.
    if (r.kind === "param" && r.bound) {
      const bound = this.rec(r.bound);
      if (bound.kind === "function" && bound.generic) return true;
    }
    // A fixed array copies when its elements do, as Rust's `[T; N]` does.
    if (r.kind === "fixed") return this.isCopy(r.element) && !this.holdsMut(r.element);
    // A tuple copies when everything in it does, as a union does.
    // A copy of a mutable reference would be a second one, so a tuple holding one moves.
    if (r.kind === "object" && r.tuple === true) return r.fields.every((f) => this.isCopy(f.type) && !this.holdsMut(f.type));
    return r.kind === "union" && r.members.every((t) => this.isCopy(t));
  }

  // Whether a value of `t` holds a mutable reference anywhere, which a copy would alias.
  holdsMut(t: Type, seen: TypeSet<Type> = new TypeSet<Type>()): boolean {
    if (typeof t === "string" || seen.has(t)) return false;
    seen.add(t);
    const inner = (u: Type) => this.holdsMut(u, seen);
    const r = this.rec(t);
    if (r.kind === "ref") return r.mutable;
    if (r.kind === "recursive") return this.holdsPart(r.of, (u) => { const v = this.recOf(u); return v?.kind === "ref" && v.mutable; });
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
  holdsPart(t: Type, found: (t: Type) => boolean, throughRefs = false, seen: TypeSet<Type> = new TypeSet<Type>()): boolean {
    const holds = (u: Type) => this.holdsPart(u, found, throughRefs, seen);
    if (found(t)) return true;
    if (typeof t === "string") return false;
    // A type that holds itself, through an array of itself, is looked into once.
    if (seen.has(t)) return false;
    seen.add(t);
    const r = this.rec(t);
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
  holdsHandle(t: Type, throughRefs = false) {
    return this.holdsPart(t, (u) => this.recOf(u)?.kind === "handle", throughRefs);
  }

  // Whether a value changes in place behind a shared reference: it holds an Atomic, a Lock, a
  // shared value, or a Dyn, whose hidden value may hold them. Readers of a shared value borrow
  // such fields without its lock.
  interiorMutable(t: Type) {
    return this.holdsPart(t, (u) => {
    const r = this.recOf(u);
    return r !== undefined && (r.kind === "shared" || r.kind === "dyn" || (r.kind === "interior" && r.which !== "Cell") || (r.kind === "block" && r.which !== "Permit"));
  });
  }

  // The first Atomic, Lock or Cell a value holds, if any.
  holdsInterior(t: Type): InteriorType | undefined {
    let found: InteriorType | undefined;
    this.holdsPart(t, (u) => this.recOf(u)?.kind === "interior" && (found = u as InteriorType) !== undefined);
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
    return r.kind === "param" ? (r.bound ? this.rec(r.bound).fields : []) : r.fields;
  }

  // Every type a type's record names directly, its fields' types included.
  links(t: Type): Type[] {
    if (typeof t === "string") return [];
    const r = this.rec(t);
    const fields = r.fields.map((f) => f.type);
    const methods = (ms: Method[]) => ms.flatMap((m) => [...m.params, m.returns, ...(m.throws === undefined ? [] : [m.throws])]);
    const maybe = (...ts: (Type | undefined)[]) => ts.flatMap((u) => (u === undefined ? [] : [u]));
    switch (r.kind) {
      case "object": return [...fields, ...maybe(r.rest)];
      case "class": return [...fields, ...maybe(r.base), ...(r.generic?.args ?? [])];
      case "interface": return [...fields, ...methods(r.methods), ...(r.generic?.args ?? [])];
      case "param": return maybe(r.bound, r.concrete);
      case "literal": return maybe(r.owner?.of);
      case "union": return r.members;
      case "ref":
      case "pointer": return [r.to];
      case "closure": return [...r.params, r.returns, ...maybe(r.throws), ...fields];
      case "function": return [...r.params, r.returns, ...maybe(r.throws), ...(r.generic?.own ?? [])];
      case "array":
      case "fixed": return [r.element];
      case "map": return [r.key, r.value];
      case "variant": return [...fields, ...r.args, ...maybe(r.of)];
      case "generator": return [r.yields, ...r.params.map((f) => f.type), ...r.frame.map((f) => f.type)];
      case "future": return [r.gives, ...maybe(r.throws), ...r.params.map((f) => f.type), ...r.frame.map((f) => f.type)];
      case "handle": return [r.gives, ...maybe(r.throws, r.joined?.base, r.joined?.panic)];
      case "interior":
      case "shared":
      case "block":
      case "dyn": return [r.of];
      case "recursive": return [...r.args, r.of];
      case "pattern":
      case "regex": return [];
    }
  }

  // A field of an object, or of an instance or the bases it embeds.
  field(t: Exclude<Type, string>, name: string): Field | undefined {
    const r = this.rec(t);
    const own = this.fieldsOf(t).find((f) => f.name === name);
    return own ?? (r.kind === "class" && r.base ? this.field(r.base, name) : undefined);
  }

  // The indices that reach a field inside a value of `t`, through any embedded bases.
  fieldPath(t: ObjectType | ClassType, name: string): usize[] {
    const r = this.rec(t);
    const embeds = r.kind === "class" && r.base;
    const i = r.fields.findIndex((f) => f.name === name);
    if (i >= 0) return [i + (embeds ? 1 : 0)];
    return [0, ...this.fieldPath(this.rec(t as ClassType).base!, name)];
  }

  // Every field of an instance: its bases' first, then its own.
  allFields(t: ClassType): Field[] {
    const r = this.rec(t);
    return [...(r.base ? this.allFields(r.base) : []), ...r.fields];
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
    const key = JSON.stringify([quasis, holes]);
    let t = this.patterns.get(key);
    if (!t) {
      t = this.made<PatternType>({ kind: "pattern", quasis, holes, fields: [] }, `pattern ${key}`);
      this.patterns.set(key, t);
    }
    return t;
  }

  // Whether a pattern is anywhere in `t`, where lowering it to `string` would lose what it asks.
  holdsPattern(this: Mut<this>, t: Type): boolean {
    if (typeof t === "string") return false;
    let found = this.patterned.get(t);
    if (found === undefined) {
      this.patterned.set(t, false);
      const r = this.rec(t);
      const parts = r.kind === "union" ? r.members : r.kind === "array" || r.kind === "fixed" ? [r.element] : r.kind === "map" ? [r.key, r.value] : r.kind === "ref" || r.kind === "pointer" ? [r.to]
        : r.kind === "object" ? r.fields.map((f) => f.type) : r.kind === "class" ? (r.generic?.args ?? []) : r.kind === "param" && r.concrete ? [r.concrete]
        : r.kind === "interior" || r.kind === "shared" || r.kind === "block" ? [r.of] : r.kind === "handle" ? [r.gives, ...(r.throws ? [r.throws] : [])]
        : r.kind === "variant" ? [...r.args, ...r.fields.map((f) => f.type)] : r.kind === "function" || r.kind === "closure" ? [...r.params, r.returns]
        : r.kind === "future" ? [r.gives] : r.kind === "generator" ? [r.yields] : r.kind === "dyn" ? this.rec(r.of).methods.flatMap((m) => [...m.params, m.returns]) : [];
      found = r.kind === "pattern" || parts.some((t) => this.holdsPattern(t));
      this.patterned.set(t, found);
    }
    return found;
  }
  private patterned = new TypeMap<Exclude<Type, string>, boolean>();

  // Whether two types are one once lowered, except where `to` holds a pattern that lowering
  // would make a plain string: then fitting decides, part by part.
  sameLowered(this: Mut<this>, from: Type, to: Type): boolean {
    return this.lower(from) === this.lower(to) && (!this.holdsPattern(to) || this.holdsPattern(from) && this.shapeKey(from) === this.shapeKey(to));
  }

  private interiors = new Map<string, InteriorType>();

  interiorType(this: Mut<this>, which: InteriorRecord["which"], of: Type): InteriorType {
    const key = `${which} ${this.keyOf(of)}`;
    let t = this.interiors.get(key);
    if (!t) {
      t = this.made<InteriorType>({ kind: "interior", which, of, fields: [] }, key);
      this.interiors.set(key, t);
    }
    return t;
  }

  private shareds = new Map<string, SharedType>();

  sharedType(this: Mut<this>, of: Type): SharedType {
    const key = `shared ${this.keyOf(of)}`;
    let t = this.shareds.get(key);
    if (!t) {
      t = this.made<SharedType>({ kind: "shared", of, fields: [] }, key);
      this.shareds.set(key, t);
    }
    return t;
  }

  private dyns = new TypeMap<InterfaceType, DynType>();

  dynType(this: Mut<this>, of: InterfaceType): DynType {
    let t = this.dyns.get(of);
    if (!t) {
      t = this.made<DynType>({ kind: "dyn", of, fields: [] }, `dyn ${this.keyOf(of)}`);
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
  uncrossable(t: Type, within: TypeSet<Type> = new TypeSet<Type>()): string | undefined {
    // An empty array's element type, `never`, holds no value to cross.
    if (t === "string" || t === "boolean" || t === "null" || t === "never" || isNumeric(t)) return undefined;
    if (typeof t === "string") return t === "void" ? "'void' gives no value" : "Fish has no JS form for it";
    // A type holding itself has no JS form yet, as converting it would never end.
    if (within.has(t)) return "a type holding itself has no JS form yet";
    within.add(t);
    const why = this.crossing(t, (u) => this.uncrossable(u, within));
    within.delete(t);
    return why;
  }

  private crossing(t: Exclude<Type, string>, uncrossable: (t: Type) => string | undefined): string | undefined {
    // A callback or a stored Promise crosses on its own, as JS keeps it, not inside another value.
    const kept = (u: Type) => this.recOf(u)?.kind === "dyn" && this.keptByJs(u as DynType);
    const r = this.rec(t);
    switch (r.kind) {
      case "literal":
        return undefined;
      case "param":
        if (r.bound && this.rec(r.bound).kind === "function") return "functions crossing between Fish and JS aren't supported yet";
        return r.concrete === undefined ? "a type parameter's value isn't known here" : uncrossable(r.concrete);
      case "union":
        if (r.members.some(kept)) return "a callback or a Promise in a union, as an optional parameter holds one, isn't supported yet";
        return r.members.map(uncrossable).find((w) => w !== undefined);
      case "array":
      case "fixed":
        if (this.holdsPart(r.element, kept)) return "a callback or a Promise inside an array isn't supported yet; give it on its own";
        return uncrossable(r.element);
      case "object": {
        const parts = r.tuple ? this.elementsOf(t as ObjectType) : r.fields.map((f) => f.type);
        if (parts.some((u) => this.holdsPart(u, kept))) return "a callback or a Promise inside an object isn't supported yet; give it on its own";
        return parts.map(uncrossable).find((w) => w !== undefined);
      }
      case "block":
        return r.which === "JsValue" ? undefined : `a '${r.which}' is Fish's own`;
      case "function":
      case "closure":
        return "functions crossing between Fish and JS aren't supported yet";
      case "future":
      case "handle":
        if (r.kind === "future" && this.leafOf.get(t as FutureType)?.method === "jsAwait") return r.gives === "void" ? undefined : uncrossable(r.gives);
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
          if (fn.throws) return "a callback that throws isn't supported yet; catch inside it";
          return [...fn.params, ...(fn.returns === "void" ? [] : [fn.returns])].map(uncrossable).find((w) => w !== undefined);
        }
        {
          // A Fish future given to JS is a promise of what it gives.
          const promised = this.promiseElement(r.kind === "dyn" ? r.of : t);
          if (promised === undefined) return "Fish has no JS form for it";
          return r.kind === "dyn" ? (promised === "void" ? undefined : uncrossable(promised)) : "Promises crossing between Fish and JS aren't supported yet";
        }
      default:
        return "Fish has no JS form for it";
    }
  }

  // The members of a package's shapes Fish can't type, each with why: refused only where used.
  jsUntyped = new TypeMap<InterfaceType, Map<string, CompileError>>();
  // The refusals of members held aside that are optional, which a value may leave out.
  jsOptional = new WeakSet<CompileError>();
  // The same for a package's function a program imports but doesn't call.
  jsUncalled = new WeakNodeMap<Id, CompileError>();

  // The prelude's JsError, what awaiting a JS promise that rejects throws, once the prelude is read.
  private jsError: Type | undefined;
  setJsError(this: Mut<this>, t: Type | undefined) {
    this.jsError = t;
  }

  // What a declared type is when JS gives it: an object, as a handle of its shape, inside unions,
  // arrays and tuples too, and a promise as a Fish future of what it fulfills with.
  jsView(this: Mut<this>, t: Type): Type {
    if (typeof t === "string") return t;
    const r = this.rec(t);
    const promised = this.promiseElement(r.kind === "dyn" ? r.of : t);
    if (promised !== undefined && this.jsError !== undefined) return this.leafFuture("jsAwait", promised === "void" ? "void" : this.jsView(promised), this.jsError);
    if (r.kind === "object" && !r.tuple) return this.blockType("JsValue", t);
    if (r.kind === "object") return this.retuple(t as ObjectType, (t) => this.jsView(t));
    if (r.kind === "union") return this.unionType(r.members.map((t) => this.jsView(t)));
    if (r.kind === "array") return this.arrayType(this.jsView(r.element));
    return t;
  }

  // What the timer task runs: each timer's callback, wrapped as an async function.
  timerCallback(this: Mut<this>): DynType {
    return this.callableType(this.functionType([], [], this.promiseInterface("void")));
  }

  callableType(this: Mut<this>, fn: FunctionType): DynType {
    return this.callableFrom(this.rec(fn));
  }

  // The stored callable of a signature, which may be one no type has, spelled as a closure was.
  callableFrom(this: Mut<this>, f: FunctionRecord): DynType {
    // In an instance, what its type parameters stand for decides the layout.
    const [params, returns, throws] = [f.params.map((t) => this.lower(t)), this.lower(f.returns), f.throws && this.lower(f.throws)];
    // Keyed by types alone, as parameter names don't make another function type, so
    // `Box<(n: i64) => i64>` and `Box<(m: i64) => i64>` are one class; the first spelling met is shown.
    const key = `${params.map((t) => this.keyOf(t)).join(", ")} => ${this.keyOf(returns)}${throws ? ` throws ${this.keyOf(throws)}` : ""}`;
    let i = this.callables.get(key);
    if (!i) {
      i = this.interfaceType(f.name);
      this.rec(i).methods.push({ name: "call", params, returns, ...(throws && { throws }) });
      this.callables.set(key, i);
      this.callableOf.set(i, this.made<FunctionType>({ ...f, params, returns, throws, fields: [] }));
    }
    if (f.name === this.rec(i).name) return this.dynType(i);
    let spelled = this.spellings.get(`${key} ${f.name}`);
    if (!spelled) {
      spelled = this.made<DynType>({ kind: "dyn", of: i, fields: [], shown: f.name }, this.keys.get(this.dynType(i))!);
      this.spellings.set(`${key} ${f.name}`, spelled);
    }
    return spelled;
  }

  // Whether two stored callables take and give the same types, so either holds the other's value.
  sameCallable(this: Mut<this>, a: Type, b: Type): boolean {
    const [f, g] = [a, b].map((t) => {
      const r = this.recOf(t);
      const fn = r?.kind === "dyn" ? this.callableOf.get(r.of) : undefined;
      return fn && this.rec(fn);
    });
    return f !== undefined && g !== undefined && f.params.length === g.params.length && f.params.every((p, i) => this.lower(p) === this.lower(g.params[i]!)) && this.lower(f.returns) === this.lower(g.returns)
      && (f.throws && this.lower(f.throws)) === (g.throws && this.lower(g.throws));
  }

  // A function type, or a `Promise<T>`, where a value is stored becomes its boxed form, inside
  // arrays too.
  stored(this: Mut<this>, t: Type): Type {
    if (typeof t === "string") return t;
    const r = this.rec(t);
    // A generic function type, like an interface, describes a value without being one.
    if (r.kind === "function" && r.generic) return t;
    if (r.kind === "function") return this.callableType(t as FunctionType);
    // A `Promise<T>` stored holds a future, boxed.
    if (r.kind === "interface" && this.promised.has(t as InterfaceType)) return this.dynType(t as InterfaceType);
    if (r.kind === "array") return this.arrayType(this.stored(r.element));
    if (r.kind === "fixed") return this.fixedType(this.stored(r.element), r.size);
    if (r.kind === "map") return this.mapType(r.key, this.stored(r.value), r.set);
    return t;
  }

  // A type argument holds its values, so a function type or a closure's type given as one is a
  // stored callable, as Rust's `Box<dyn Fn>` is.
  heldArgument(this: Mut<this>, t: Type): Type {
    if (typeof t === "string") return t;
    const r = this.rec(t);
    if ((r.kind !== "function" && r.kind !== "closure") || r.generic) return t;
    if (r.kind === "function") return this.callableType(t as FunctionType);
    // An async closure gives a Promise, as a written `() => Promise<T>` does. One whose future
    // throws has no written form yet, so it stays as it is, for its holder to refuse.
    const gives = this.recOf(r.returns);
    const future = gives?.kind === "future" ? gives : undefined;
    if (future?.throws) return t;
    // What it gives widens as a `let` would, so `() => "a"` and `() => "b"` meet as `() => string`.
    const returns = future ? this.promiseInterface(future.gives) : this.widenLet(r.returns);
    const fn = this.functionType(r.params.map((_, i) => `p${i}`), r.params, returns, r.throws);
    // Shown as the closure was written, with its own parameter names, when that is still its type.
    return returns === r.returns ? this.callableFrom({ ...this.rec(fn), name: r.name }) : this.callableType(fn);
  }

  private blocks = new Map<string, BlockType>();

  // Whether a value crosses between Fish and JS converted on the way: a string, a number, a
  // boolean, empty, a literal, a JS value or handle, and unions, arrays, tuples and objects of them.
  // A Fish type holding itself has no JS form yet, as converting it would never end: `within` is
  // the types the walk is inside.
  jsConverts(t: Type, within: TypeSet<Type> = new TypeSet<Type>()): boolean {
    // An empty array's element type, `never`, holds no value to convert.
    if (t === "string" || t === "boolean" || t === "null" || t === "never" || isNumeric(t)) return true;
    if (typeof t === "string" || within.has(t)) return false;
    const r = this.rec(t);
    if (r.kind === "block") return r.which === "JsValue";
    if (r.kind === "dyn" && this.callableOf.has(r.of)) {
      const fn = this.rec(this.callableOf.get(r.of)!);
      if (fn.throws) return false;
      return [...fn.params, ...(fn.returns === "void" ? [] : [fn.returns])].every((u) => this.jsConverts(u, within));
    }
    if (r.kind === "dyn" && this.promiseElement(r.of) !== undefined) return this.promiseElement(r.of) === "void" || this.jsConverts(this.promiseElement(r.of)!, within);
    if (r.kind === "future") return this.leafOf.get(t as FutureType)?.method === "jsAwait" && (r.gives === "void" || this.jsConverts(r.gives, within));
    const parts = r.kind === "ref" ? [r.to] : r.kind === "param" ? (r.concrete === undefined ? undefined : [r.concrete])
      : r.kind === "union" ? r.members : r.kind === "array" || r.kind === "fixed" ? [r.element] : r.kind === "object" ? r.fields.map((f) => f.type) : r.kind === "literal" ? [] : undefined;
    if (parts === undefined) return false;
    within.add(t);
    const all = parts.every((u) => this.jsConverts(u, within));
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
    if (r.kind === "union") return this.unionType(r.members.map((t) => this.jsTakes(t)));
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
    const reads = (readRec?.kind === "union" ? readRec.members : [read]).filter(kinds);
    if (reads.length === 0) return undefined;
    return reads.length === 1 && kinds(read) ? "one" : "several";
  }

  blockType(this: Mut<this>, which: BlockRecord["which"], of: Type = "void"): BlockType {
    const key = `${which} ${this.keyOf(of)}`;
    let t = this.blocks.get(key);
    if (!t) {
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
      case "next": return [{ name: "generator", type: this.refType(of, true) }];
    }
  }

  // A leaf future: what it gives, what it may throw, and whether it was given an AbortSignal, whose
  // count and waiting flag end its frame.
  leafFuture(this: Mut<this>, method: Leaf, of: Type, given?: Type, signal = false): FutureType {
    // An async generator's `next()` throws what the generator does.
    const generator = method === "next" ? this.recOf(of) : undefined;
    const throws = given ?? (generator?.kind === "generator" ? generator.throws : undefined);
    const key = `${method} ${this.keyOf(of)} ${throws ? this.keyOf(throws) : ""} ${signal}`;
    let t = this.leaves.get(key);
    if (!t) {
      const frame: Field[] = [{ name: "state", type: "i32" }, ...this.leafFrame(method, of)];
      if (signal) frame.push({ name: "signal", type: this.blockType("AbortSignal") }, { name: "waiting", type: "i32" });
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
    const key = `handle ${this.keyOf(gives)} ${throws ? this.keyOf(throws) : ""}`;
    let t = this.handles.get(key);
    if (!t) {
      t = this.made<HandleType>({ kind: "handle", gives, throws, fields: [] }, key);
      this.handles.set(key, t);
    }
    return t;
  }

  // What `handle.join()` gives: the task's handle, awaited as throwing a TaskPanic too.
  joinedType(this: Mut<this>, base: HandleType, panic: Type): HandleType {
    const key = `joined ${this.keyOf(base)} ${this.keyOf(panic)}`;
    let t = this.handles.get(key);
    if (!t) {
      const { gives, throws } = this.rec(base);
      t = this.made<HandleType>({ kind: "handle", gives, throws: throws ? this.unionType([throws, panic]) : panic, fields: [], joined: { base, panic } }, key);
      this.handles.set(key, t);
    }
    return t;
  }

  futureType(this: Mut<this>, name: string, concrete: boolean): FutureType {
    const t = this.made<FutureType>({ kind: "future", name, gives: "void", fields: [], params: [], frame: [], concrete }, `future ${this.declared++}`);
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
    return rejected ? this.unionType([fulfilled, rejected]) : fulfilled;
  }

  settledParts(this: Mut<this>, gives: Type, thrown: Type | undefined): { fulfilled: ObjectType; rejected?: ObjectType } {
    const fulfilled = this.objectType([{ name: "status", type: this.literalType("fulfilled") }, { name: "value", type: gives }]);
    return { fulfilled, rejected: thrown ? this.objectType([{ name: "status", type: this.literalType("rejected") }, { name: "reason", type: thrown }]) : undefined };
  }

  combinedFuture(this: Mut<this>, combined: Combined): FutureType {
    const { kind } = combined;
    const make = (gives: Type, throws: Type | undefined, frame: Field[]) => {
      const params = combined.futures.flatMap((f) => {
        const r = this.rec(f);
        return r.kind === "future" ? r.params.map((p) => ({ ...p })) : [];
      });
      const t = this.made<FutureType>({ kind: "future", name: `Promise.${kind}`, gives, throws, fields: [], params, frame, concrete: true }, `future ${this.declared++}`);
      this.combinedOf.set(t, combined);
      return t;
    };
    if (combined.array) {
      const given = this.givenBy(this.rec(combined.array).element as DynType);
      const kept = kind === "allSettled" ? this.settledType(given, undefined) : given;
      const frame: Field[] = [{ name: "state", type: "i32" }, { name: "futures", type: combined.array }, { name: "values", type: this.arrayType(kept) }, { name: "flags", type: this.arrayType("u8") }];
      return make(kind === "all" || kind === "allSettled" ? this.arrayType(kept) : given, kind === "any" ? combined.aggregate : undefined, frame);
    }
    // Each future's slot keeps its value, its outcome for `allSettled`, or its error for `any`.
    const kept = combined.futures.map((f) => (kind === "allSettled" ? this.settledType(this.givenBy(f), this.thrownBy(f)) : kind === "any" ? (this.thrownBy(f) ?? "null") : this.givenBy(f)));
    const frame: Field[] = [{ name: "state", type: "i32" }];
    combined.futures.forEach((f, i) => frame.push({ name: `future${i}`, type: f }, { name: `value${i}`, type: kept[i]! }, { name: `done${i}`, type: "i32" }));
    const thrown = combined.futures.flatMap((f) => (this.thrownBy(f) ? [this.thrownBy(f)!] : []));
    if (kind === "all") return make(this.tupleType(kept), thrown.length > 0 ? this.unionType(thrown) : undefined, frame);
    if (kind === "allSettled") return make(this.tupleType(kept), undefined, frame);
    const gives = this.unionType(combined.futures.map((t) => this.givenBy(t)));
    if (kind === "race") return make(gives, thrown.length > 0 ? this.unionType(thrown) : undefined, frame);
    return make(gives, combined.aggregate, frame);
  }

  private promises = new Map<string, InterfaceType>();
  private promised = new TypeMap<InterfaceType, Type>();

  // `Promise<T>`: any future giving a `T` once awaited, as TypeScript's type of an async result is.
  promiseInterface(this: Mut<this>, t: Type): InterfaceType {
    let found = this.promises.get(this.keyOf(t));
    if (!found) {
      found = this.interfaceType(`Promise<${this.show(t)}>`);
      this.promises.set(this.keyOf(t), found);
      this.promised.set(found, t);
    }
    return found;
  }

  // The boxed future a Dyn's async method gives: a `Promise<T>` that borrows the Dyn's value, so
  // it holds a reference, which keeps it from outliving the Dyn or crossing threads.
  private lent = new Map<string, InterfaceType>();
  borrowing = new TypeSet<InterfaceType>();

  lentPromise(this: Mut<this>, t: Type): DynType {
    let found = this.lent.get(this.keyOf(t));
    if (!found) {
      found = this.interfaceType(`Promise<${this.show(t)}>`);
      this.lent.set(this.keyOf(t), found);
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
    return !this.promised.has(of) && this.generatorElement(of, true) === undefined && this.rec(of).methods.every((m) => !m.mutable && !m.owned);
  }

  // What a `Promise<T>` gives, when the interface is one.
  promiseElement(t: Type): Type | undefined {
    return this.recOf(t)?.kind === "interface" ? this.promised.get(t as InterfaceType) : undefined;
  }

  private regexes = new Map<string, RegexType>();

  regexType(this: Mut<this>, pattern: string, flags: string, captures: RegexRecord["captures"], source: string = pattern): RegexType {
    const key = `regex ${flags} ${pattern}`;
    let t = this.regexes.get(key);
    if (!t) {
      t = this.made<RegexType>({ kind: "regex", source, pattern, flags, captures, fields: [] }, key);
      this.regexes.set(key, t);
    }
    return t;
  }

  // One per alias instance a program's types lead back to; the checker keeps them by instance.
  recursiveType(this: Mut<this>, name: string, args: Type[]): RecursiveType {
    const t = this.made<RecursiveType>({ kind: "recursive", name, args, of: "never", fields: [] }, `recursive ${this.declared++}`);
    return t;
  }

  // The recursive type standing for a class or an enum instance, made once for it, so the one
  // made for another instance is found from the instance.
  private heldBlocks = new TypeMap<Exclude<Type, string>, RecursiveType>();
  blockFor(this: Mut<this>, t: ClassType | UnionType, args: Type[]): RecursiveType {
    let back = this.heldBlocks.get(t);
    if (!back) {
      this.heldBlocks.set(t, back = this.recursiveType(this.show(t), args));
      this.standsFor(back, t);
    }
    return back;
  }
  holdsBlock(this: Mut<this>, t: UnionType, back: RecursiveType) {
    this.heldBlocks.set(t, back);
  }

  // The same recursive type made with other type arguments, which only the checker can make.
  private recursives: RecursiveMaker | undefined;
  lowersRecursive(this: Mut<this>, maker: RecursiveMaker) {
    this.recursives = maker;
  }
  private instanceRecursive(this: Mut<this>, t: RecursiveType, args: Type[]): RecursiveType {
    return this.recursives ? this.recursives.remakeRecursive(t, args) : t;
  }

  // A recursive type for other type arguments: a class's or an enum's is found from its instance,
  // `of` made with them, which makes the instance without reading its fields; an alias's is
  // remade by the checker.
  private remade(this: Mut<this>, t: RecursiveType, of: () => Type, args: Type[]): RecursiveType {
    const stands = this.rec(t).of;
    const kind = this.recOf(stands)?.kind;
    if (kind === "class" || (kind === "union" && this.heldBlocks.get(stands as UnionType) === t)) {
      const made = of();
      const madeKind = this.recOf(made)?.kind;
      return madeKind === "class" || madeKind === "union" ? this.blockFor(made as ClassType | UnionType, args) : t;
    }
    return this.instanceRecursive(t, args);
  }

  // Whether a value of `type` lent where a type parameter is wanted is a part of a value whose type
  // holds itself, the parameter standing for that type: each instance checks it again.
  partOfItself(this: Mut<this>, type: Type, to: Type): boolean {
    const r = this.recOf(to);
    if (r?.kind !== "param" || r.concrete || r.bound === undefined || this.lower(type) !== this.lower(r.bound)) return false;
    const bound = r.bound;
    return this.ties.has(bound) || this.holdsPart(bound, (u) => { const v = this.recOf(u); return v?.kind === "recursive" && v.of === this.lower(type); });
  }

  // The part of a type that keeps `JSON.stringify` and `JSON.parse` from taking its values, or
  // undefined when every part is Json: booleans, numbers, strings and literals, and objects,
  // tuples, arrays, unions and string-keyed Maps of them, with the classes and data enums that
  // `json` says derive it. A class's `#private` fields aren't written, as in JavaScript.
  unjson(this: Mut<this>, t: Type, json: (t: ClassType | VariantType) => boolean, seen: TypeSet<Type> = new TypeSet<Type>()): Type | undefined {
    // JavaScript throws for a bigint, which JSON has no number for.
    if (typeof t === "string") return t === "void" || t === "never" || t === "bigint" ? t : undefined;
    if (seen.has(t)) return undefined;
    seen.add(t);
    const part = (u: Type) => this.unjson(u, json, seen);
    const first = (parts: Type[]) => parts.map(part).find((p) => p !== undefined);
    const r = this.rec(t);
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
        return r.set || this.lower(r.key) !== "string" ? t : part(r.value);
      case "class":
        return json(t as ClassType) ? first([...(r.base ? [r.base] : []), ...r.fields.filter((f) => !f.name.startsWith("#")).map((f) => f.type)]) : t;
      case "variant": {
        if (!json(t as VariantType)) return t;
        const of = this.recOf(r.of);
        return first((of?.kind === "union" ? of.members : [t]).flatMap((v) => { const w = this.recOf(v); return w?.kind === "variant" ? w.fields.map((f) => f.type) : []; }));
      }
      default:
        return t;
    }
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
    if (!t) {
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
    this.arena.push(record);
    const t = (this.arena.length + 20) as T;
    if (key !== undefined) this.keys.set(t, key);
    return t;
  }

  // The record of the type with id `id`, if this program has one.
  typeOf(id: usize): TypeRecord | undefined {
    return id >= 21 ? this.arena[id - 21] : undefined;
  }

  // A class's key is unique to its declaration, since two programs may reuse a class name.
  classType(this: Mut<this>, name: string, generic?: ClassRecord["generic"]): ClassType {
    const t = this.made<ClassType>({ kind: "class", name, fields: [], generic }, `class ${this.declared++}`);
    return t;
  }

  interfaceType(this: Mut<this>, name: string): InterfaceType {
    const t = this.made<InterfaceType>({ kind: "interface", name, fields: [], methods: [] }, `interface ${this.declared++}`);
    return t;
  }

  generatorType(this: Mut<this>, name: string, concrete: boolean, async = false): GeneratorType {
    const t = this.made<GeneratorType>({ kind: "generator", name, yields: "never", fields: [], params: [], frame: [], concrete, ...(async ? { async } : {}) }, `generator ${this.declared++}`);
    return t;
  }

  // What `receiveFrom()` gives: a datagram's bytes and its sender, named as `sendTo` takes them.
  datagram(this: Mut<this>): ObjectType {
    return this.objectType([{ name: "bytes", type: this.arrayType("u8") }, { name: "host", type: "string" }, { name: "port", type: "i64" }]);
  }

  // What `next()` gives: the next value, or that the generator has finished.
  nextResult(this: Mut<this>, t: Type): Type {
    return this.unionType([this.objectType([{ name: "done", type: this.literalType(false) }, { name: "value", type: t }]), this.objectType([{ name: "done", type: this.literalType(true) }])]);
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
    if (!found) {
      found = this.interfaceType(sends === undefined ? `Generator<${this.show(t)}>` : `Generator<${this.show(t)}, void, ${this.show(sends)}>`);
      this.rec(found).methods.push({ name: "next", params: [], returns: this.nextResult(t) });
      this.generators.set(key, found);
      this.elements.set(found, t);
      if (sends !== undefined) this.sent.set(found, sends);
    }
    return found;
  }

  // `AsyncGenerator<T>`: anything whose awaited `next()` gives `T`s.
  asyncGeneratorInterface(this: Mut<this>, t: Type): InterfaceType {
    let found = this.generators.get(`async ${this.keyOf(t)}`);
    if (!found) {
      found = this.interfaceType(`AsyncGenerator<${this.show(t)}>`);
      this.rec(found).methods.push({ name: "next", params: [], returns: this.promiseInterface(this.nextResult(t)) });
      this.generators.set(`async ${this.keyOf(t)}`, found);
      this.asyncElements.set(found, t);
    }
    return found;
  }

  // What a generator, or a type parameter standing for one or bounded by `Generator<T>`, yields.
  // `async` asks the same of an async generator and `AsyncGenerator<T>`.
  yieldsOf(t: Type, async = false): Type | undefined {
    if (typeof t === "string") return undefined;
    const r = this.rec(t);
    if (r.kind === "generator") return !!r.async === async ? r.yields : undefined;
    if (r.kind === "dyn") return async ? this.generatorElement(r.of, true) : undefined;
    if (r.kind === "param") return r.concrete ? this.yieldsOf(r.concrete, async) : r.bound && this.generatorElement(r.bound, async);
    return this.generatorElement(t, async);
  }

  // What a generator's `next(x)` takes, or a type parameter's standing for one or bounded by
  // `Generator<T, void, N>`.
  generatorSends(t: Type): Type | undefined {
    if (typeof t === "string") return undefined;
    const r = this.rec(t);
    if (r.kind === "generator") return r.sends;
    if (r.kind === "param") return r.concrete ? this.generatorSends(r.concrete) : r.bound && this.generatorSends(r.bound);
    return r.kind === "interface" ? this.sent.get(t as InterfaceType) : undefined;
  }

  // What advancing a generator, or a type parameter standing for one, may throw.
  generatorThrows(t: Type): Type | undefined {
    if (typeof t === "string") return undefined;
    const r = this.rec(t);
    if (r.kind === "generator") return r.throws;
    return r.kind === "param" && r.concrete ? this.generatorThrows(r.concrete) : undefined;
  }

  // What a `Generator<T>`, or with `async` an `AsyncGenerator<T>`, yields, when the interface is one.
  generatorElement(t: Type, async = false): Type | undefined {
    return this.recOf(t)?.kind === "interface" ? (async ? this.asyncElements : this.elements).get(t as InterfaceType) : undefined;
  }

  functionType(this: Mut<this>, names: string[], params: Type[], returns: Type, throws?: Type): FunctionType {
    const t = this.made<FunctionType>({ kind: "function", name: this.signatureName(names, params, returns, throws), names, params, returns, ...(throws && { throws }), fields: [] }, `function ${this.declared++}`);
    return t;
  }

  private signatureName(this: Mut<this>, names: string[], params: Type[], returns: Type, throws: Type | undefined) {
    return `(${params.map((p, i) => `${names[i]}: ${this.show(p)}`).join(", ")}) => ${this.show(returns)}${throws ? ` throws ${this.show(throws)}` : ""}`;
  }

  closureType(this: Mut<this>, names: string[], params: Type[], returns: Type, fields: Field[], once: string | undefined, concrete: boolean, throws?: Type): ClosureType {
    const t = this.made<ClosureType>({ kind: "closure", name: this.signatureName(names, params, returns, throws), params, returns, ...(throws && { throws }), fields, once, concrete }, `closure ${this.declared++}`);
    return t;
  }

  private genericValues = new Map<string, ClosureType>();

  // The one type of a generic function used as a value, by the function's name.
  genericFunctionType(this: Mut<this>, name: string, shown: string): ClosureType {
    let t = this.genericValues.get(name);
    if (!t) {
      t = this.made<ClosureType>({ kind: "closure", name: shown, params: [], returns: "void", fields: [], concrete: true, generic: name }, `generic function ${name}`);
      this.genericValues.set(name, t);
    }
    return t;
  }

  literalType(this: Mut<this>, value: string | bigint | boolean, owner?: LiteralRecord["owner"]): LiteralType {
    const key = `literal ${typeof value} ${value}${owner ? ` of ${owner.enum}.${owner.member} ${owner.id}` : ""}`;
    let t = this.literals.get(key);
    if (!t) {
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
    if (!t) {
      t = this.made<LiteralType>({ kind: "literal", value: key, fields: [] }, at);
      this.literals.set(at, t);
    }
    return t;
  }

  // Members are flattened, deduplicated and kept in one order, so equal unions are one type,
  // and a literal whose base type is also a member adds nothing. A single member is itself.
  // An enum's union carries the enum's name, for messages.
  unionType(this: Mut<this>, parts: Type[], name?: string): Type {
    let flat = parts.flatMap((p) => { const r = this.recOf(p); return r?.kind === "union" ? r.members : [p]; }).filter((p, _, all) => p !== "never" || all.every((q) => q === "never"));
    // Regexes of different patterns are one \`RegExp\`, as every regex is a pointer to a program.
    const isRegex = (p: Type) => this.recOf(p)?.kind === "regex";
    if (new TypeSet(flat.filter(isRegex)).size > 1) flat = flat.map((p) => (isRegex(p) ? ANY_REGEX : p));
    // Members of one value shape, like `{ a?: T }` and `{ a: T | null }`, are one member, spelled
    // as whichever sorts first.
    const seen = new Set<string>();
    const members = [...new TypeSet(flat)]
      .filter((t) => {
        if (typeof t === "string") return true;
        const { kind } = this.rec(t);
        return (kind !== "literal" || !flat.includes(this.baseOf(t as LiteralType)!)) && (kind !== "pattern" || !flat.includes("string"));
      })
      .toSorted((a, b) => (this.keyOf(a) < this.keyOf(b) ? -1 : this.keyOf(a) > this.keyOf(b) ? 1 : 0))
      .filter((t) => {
        const shape = this.shapeKey(t);
        return !seen.has(shape) && seen.add(shape) !== undefined;
      });
    if (members.length === 1) return members[0]!;
    const key = `union ${members.map((t) => this.keyOf(t)).join("|")}`;
    let t = this.unions.get(key);
    if (!t) {
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
    return fitting.length > 0 || !js(type) ? fitting : members.filter(js);
  }

  typeParameter(this: Mut<this>, name: string, bound: Bound | undefined): ParamType {
    const t = this.made<ParamType>({ kind: "param", name, bound, fields: [] }, `param ${this.declared++}`);
    return t;
  }

  refType(this: Mut<this>, to: Type, mutable: boolean, life?: string): RefType {
    const key = `${mutable ? "mut" : "ref"} ${this.keyOf(to)}${life ? ` ${life}` : ""}`;
    let t = this.refs.get(key);
    if (!t) {
      t = this.made<RefType>({ kind: "ref", to, mutable, fields: [], life }, key);
      this.refs.set(key, t);
    }
    return t;
  }

  private refs = new Map<string, RefType>();

  fixedType(this: Mut<this>, element: Type, size: usize): FixedType {
    const key = `fixed ${size} ${this.keyOf(element)}`;
    let t = this.fixeds.get(key);
    if (!t) {
      t = this.made<FixedType>({ kind: "fixed", element, size, fields: [] }, key);
      this.fixeds.set(key, t);
    }
    return t;
  }
  private fixeds = new Map<string, FixedType>();

  arrayType(this: Mut<this>, element: Type): ArrayType {
    const key = `[${this.keyOf(element)}]`;
    let t = this.arrays.get(key);
    if (!t) {
      t = this.made<ArrayType>({ kind: "array", element, fields: [] }, key);
      this.arrays.set(key, t);
    }
    return t;
  }

  private arrays = new Map<string, ArrayType>();

  // Sets the type a recursive type stands for. An array is on the heap already, so where the
  // type reaches itself through one, that array holds the type itself rather than a block, and is
  // the array `Tree[]` means wherever it is written. The type then holds itself, a loop the walks
  // over types stop at by the recursive type kept for it.
  standsFor(this: Mut<this>, back: RecursiveType, of: Type) {
    this.rec(back).of = of;
    // A Map that leads back holds the type inline too, as an array does, so a Map written with
    // the type is the one the type holds.
    const r = this.recOf(of);
    if (typeof of !== "string" && r?.kind !== "map") {
      for (const map of [...this.maps.values()]) {
        const m = this.rec(map);
        if (m.value !== back) continue;
        this.rec(map).value = of;
        this.maps.set(`${m.set ? "Set" : "Map"}<${this.keyOf(m.key)},${this.keyOf(of)}>`, map);
        this.ties.set(of, back);
      }
    }
    const array = this.arrays.get(`[${this.keyOf(back)}]`);
    // A type that is itself an array, as `type T = T[]`, has no other part to hold, so its
    // elements stay blocks.
    if (!array || typeof of === "string" || r?.kind === "array") return;
    this.rec(array).element = of;
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

  mapType(this: Mut<this>, key: Type, value: Type, set = false): MapType {
    const id = `${set ? "Set" : "Map"}<${this.keyOf(key)},${this.keyOf(value)}>`;
    let t = this.maps.get(id);
    if (!t) {
      t = this.made<MapType>({ kind: "map", key, value, set, fields: [] }, id);
      this.maps.set(id, t);
    }
    return t;
  }

  private maps = new Map<string, MapType>();

  // The variant `member` of an enum declaration (by its unique id) with these type arguments.
  variantType(this: Mut<this>, enumName: string, id: usize, member: string, args: Type[], payload: Type[]): VariantType {
    const key = `variant ${id} ${member} <${args.map((t) => this.keyOf(t)).join(",")}>`;
    let t = this.variants.get(key);
    if (!t) {
      const shown = args.length > 0 ? `${enumName}<${args.map((t) => this.show(t)).join(", ")}>` : enumName;
      t = this.made<VariantType>({ kind: "variant", name: `${shown}.${member}`, member, enum: enumName, fields: payload.map((type, i) => ({ name: String(i), type })), args });
      this.variants.set(key, t);
      // A short key of its own, so an enum nested in itself doesn't double its key each level.
      this.keys.set(t, `variant#${this.variants.size}`);
    }
    return t;
  }

  private variants = new Map<string, VariantType>();

  // Whether a value of `t` holds a reference anywhere, which only lifetimes could keep valid. A
  // class met again inside itself adds nothing; one that contains itself is refused elsewhere.
  holdsRef(t: Type, seen: TypeSet<Type> = new TypeSet<Type>()): boolean {
    if (typeof t === "string" || seen.has(t)) return false;
    seen.add(t);
    const holds = (u: Type) => this.holdsRef(u, seen);
    const r = this.rec(t);
    if (r.kind === "ref" || (r.kind === "dyn" && this.borrowing.has(r.of))) return true;
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
  lockCallbacks = new TypeMap<FunctionType, string>();
  sharedCallbacks = new TypeSet<FunctionType>();

  // A type parameter as an instance sees it: standing for `concrete`, which has no type
  // parameter in it.
  wrapped(this: Mut<this>, name: string, bound: Bound | undefined, concrete: Type): ParamType {
    const key = `param ${name} ${bound ? this.keyOf(bound) : ""} as ${this.keyOf(concrete)}`;
    let t = this.wrappers.get(key);
    if (!t) {
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
    if (r.kind === "interface" && r.generic?.args.some((a) => this.lower(a) !== a)) return this.instanceInterface(t as InterfaceType, r.generic.args.map((t) => this.lower(t)));
    if (r.kind === "dyn" && this.rec(r.of).generic?.args.some((a) => this.lower(a) !== a)) return this.dynType(this.lower(r.of) as InterfaceType);
    if (r.kind === "dyn" && r.shown !== undefined) return this.dynType(r.of);
    if (r.kind === "literal" || r.kind === "interface" || r.kind === "closure" || r.kind === "function" || r.kind === "generator" || r.kind === "future" || r.kind === "dyn" || r.kind === "regex") return t;
    if (r.kind === "param") return r.concrete ? this.lower(r.concrete) : t;
    if (r.kind === "pattern") return "string";
    if (r.kind === "pointer") return this.pointerType(this.lower(r.to), r.mutable);
    if (r.kind === "handle") return r.joined ? this.joinedType(this.lower(r.joined.base) as HandleType, r.joined.panic) : this.handleType(this.lower(r.gives), r.throws && this.lower(r.throws));
    if (r.kind === "interior") return this.interiorType(r.which, this.lower(r.of));
    if (r.kind === "shared") return this.sharedType(this.lower(r.of));
    if (r.kind === "block") return this.blockType(r.which, this.lower(r.of));
    if (r.kind === "map") return this.mapType(this.lower(r.key), this.lower(r.value), r.set);
    if (r.kind === "recursive") return r.args.some((a) => this.lower(a) !== a) ? this.remade(t as RecursiveType, () => this.lower(r.of), r.args.map((t) => this.lower(t))) : t;
    // A type holding itself through an array is remade from its type arguments.
    const tied = this.ties.get(t);
    if (tied) {
      const { args } = this.rec(tied);
      if (this.heldBlocks.get(t) !== tied) return args.some((a) => this.lower(a) !== a) ? this.rec(this.instanceRecursive(tied, args.map((t) => this.lower(t)))).of : t;
    }
    const loop = this.members.get(t);
    if (loop && !this.rec(loop).args.some((a) => this.lower(a) !== a)) return t;
    let found = this.lowered.get(t);
    if (!found) {
      if (r.kind === "class") found = r.generic?.args.some((a) => this.lower(a) !== a) ? this.instanceClass(t as ClassType, r.generic.args.map((t) => this.lower(t))) : t;
      else if (r.kind === "ref") found = this.refType(this.lower(r.to), r.mutable, r.life);
      else if (r.kind === "array") found = this.arrayType(this.lower(r.element));
      else if (r.kind === "fixed") found = this.fixedType(this.lower(r.element), r.size);
      else if (r.kind === "variant") found = r.args.some((a) => this.lower(a) !== a) ? this.instanceVariant(t as VariantType, r.args.map((t) => this.lower(t))) : t;
      else if (r.kind === "object" && r.match) found = t;
      else if (r.kind === "object" && r.tuple) found = this.retuple(t as ObjectType, (t) => this.lower(t));
      else found = r.kind === "union" ? this.unionType(r.members.map((t) => this.lower(t)), r.name) : this.objectType(r.fields.map(({ optional: _, ...f }) => ({ ...f, type: this.lower(f.type) })));
      this.lowered.set(t, found);

    }
    return found;
  }

  private lowered = new TypeMap<Exclude<Type, string>, Type>();

  // A type with some of its parts swapped for others, looking inside objects and unions.
  replaced(this: Mut<this>, t: Type, swap: TypeMap<Type, Type>): Type {
    const found = swap.get(t);
    if (found) return found;
    if (typeof t === "string") return t;
    const r = this.rec(t);
    if (r.kind === "class") {
      const args = r.generic?.args.map((a) => this.heldArgument(this.replaced(a, swap)));
      return args && args.some((a, i) => a !== r.generic!.args[i]) ? this.instanceClass(t as ClassType, args) : t;
    }
    if (r.kind === "ref") return this.refType(this.replaced(r.to, swap), r.mutable, r.life);
    if (r.kind === "interface" && r.generic) {
      const args = r.generic.args.map((a) => this.heldArgument(this.replaced(a, swap)));
      return args.some((a, i) => a !== r.generic!.args[i]) ? this.instanceInterface(t as InterfaceType, args) : t;
    }
    if (r.kind === "function") {
      const params = r.params.map((p) => this.replaced(p, swap));
      const returns = this.replaced(r.returns, swap);
      const throws = r.throws && this.replaced(r.throws, swap);
      if (!params.some((p, i) => p !== r.params[i]) && returns === r.returns && throws === r.throws) return t;
      const made = this.functionType(r.names, params, returns, throws);
      // A generic one stays generic, the types around it it was written among replaced too.
      if (r.generic) {
        this.rec(made).name = `<${r.generic.names.join(", ")}>${this.rec(made).name}`;
        this.rec(made).generic = { ...r.generic, scope: new Map([...r.generic.scope].map(([n, x]) => [n, this.replaced(x, swap)])) };
      }
      return made;
    }
    // A stored callable is remade from the function type it was written as.
    const fn = r.kind === "dyn" ? this.callableOf.get(r.of) : undefined;
    if (fn) {
      const made = this.replaced(fn, swap);
      return made === fn ? t : this.callableType(made as FunctionType);
    }
    if (r.kind === "array") return this.arrayType(this.replaced(r.element, swap));
    if (r.kind === "fixed") return this.fixedType(this.replaced(r.element, swap), r.size);
    if (r.kind === "map") return this.mapType(this.replaced(r.key, swap), this.heldArgument(this.replaced(r.value, swap)), r.set);
    // What a lock, a shared value or a channel holds is a type argument, boxed as one.
    if (r.kind === "interior" || r.kind === "shared" || (r.kind === "block" && r.which === "Channel")) {
      const of = this.heldArgument(this.replaced(r.of, swap));
      if (of === r.of) return t;
      return r.kind === "interior" ? this.interiorType(r.which, of) : r.kind === "shared" ? this.sharedType(of) : this.blockType("Channel", of);
    }
    if (r.kind === "variant") {
      const args = r.args.map((a) => this.heldArgument(this.replaced(a, swap)));
      return args.some((a, i) => a !== r.args[i]) ? this.instanceVariant(t as VariantType, args) : t;
    }
    const tied = this.ties.get(t);
    if (tied && this.heldBlocks.get(t as UnionType) !== tied) {
      const tiedArgs = this.rec(tied).args;
      const args = tiedArgs.map((a) => this.replaced(a, swap));
      return args.some((a, i) => a !== tiedArgs[i]) ? this.rec(this.instanceRecursive(tied, args)).of : t;
    }
    if (r.kind === "recursive") {
      const args = r.args.map((a) => this.replaced(a, swap));
      return args.some((a, i) => a !== r.args[i]) ? this.remade(t as RecursiveType, () => this.replaced(r.of, swap), args) : t;
    }
    if (r.kind !== "object" && r.kind !== "union") return t;
    if (r.kind === "object" && r.match) return t;
    if (r.kind === "object" && r.tuple) return this.retuple(t as ObjectType, (e) => this.replaced(e, swap));
    return r.kind === "union" ? this.unionType(r.members.map((m) => this.replaced(m, swap)), r.name) : this.objectType(r.fields.map((f) => ({ ...f, type: this.replaced(f.type, swap) })));
  }

  // The classes, interfaces and variants of generic enums lowering makes for other type
  // arguments, which only the checker can declare.
  private instances: InstanceMaker | undefined;
  lowersInstances(this: Mut<this>, maker: InstanceMaker) {
    this.instances = maker;
  }
  private instanceClass(this: Mut<this>, c: ClassType, args: Type[]): ClassType {
    return this.instances ? this.instances.classInstance(c, args) : c;
  }
  private instanceVariant(this: Mut<this>, v: VariantType, args: Type[]): VariantType {
    return this.instances ? this.instances.variantInstance(v, args) : v;
  }
  private instanceInterface(this: Mut<this>, t: InterfaceType, args: Type[]): InterfaceType {
    return this.instances ? this.instances.interfaceInstance(t, args) : t;
  }

  // A string that is the same exactly when two types are, for keying instances.
  keyOf(t: Type): string {
    return typeof t === "string" ? t : `{${this.keys.get(t)}}`;
  }

  // `[A, B]`: laid out as an object of fields `0` and `1`, but a type of its own.
  tupleType(this: Mut<this>, elements: Type[], required: usize = elements.length, rest?: Type): ObjectType {
    const key = `tuple ${elements.map((t) => this.keyOf(t)).join(",")}${required < elements.length ? `?${required}` : ""}${rest === undefined ? "" : `...${this.keyOf(rest)}`}`;
    let t = this.interned.get(key);
    if (!t) {
      const fields: Field[] = elements.map((type, i) => ({ name: String(i), type }));
      if (rest !== undefined) fields.push({ name: "...", type: this.arrayType(rest) });
      const shape = this.objectType(fields);
      t = this.made<ObjectType>({ kind: "object", fields: this.rec(shape).fields.map((f) => ({ ...f })), tuple: true, shape }, key);
      if (required < elements.length) this.rec(t).required = required;
      if (rest !== undefined) this.rec(t).rest = rest;
      this.interned.set(key, t);
    }
    return t;
  }

  // The same tuple shape over elements mapped by `f`.
  retuple(this: Mut<this>, t: ObjectType, f: (e: Type) => Type): ObjectType {
    const { required, rest } = this.rec(t);
    return this.tupleType(this.elementsOf(t).map(f), required, rest === undefined ? undefined : f(rest));
  }

  // What `re.exec(s)` gives when it matches: the whole match and each capture, a capture that
  // may not take part being `string | null`, then where the match starts, the string matched, and,
  // when the pattern names groups, an object of them.
  matchType(this: Mut<this>, t: RegexType): ObjectType {
    const key = `match ${this.keys.get(t)}`;
    let found = this.interned.get(key);
    if (!found) {
      const maybe = this.unionType(["string", "null"]);
      const { captures } = this.rec(t);
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
        ...(named.length > 0 ? [{ name: "groups", type: this.objectType(named) as Type }] : []),
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
    const key = sorted.map((f) => `${f.readonly ? "readonly " : ""}${JSON.stringify(f.name)}${f.optional ? `?${f.optional}` : ""}:${this.keyOf(f.type)}`).join(",");
    let t = this.interned.get(key);
    if (!t) {
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
      if (r.kind === "object" && r.tuple) found = `[${this.elementsOf(t as ObjectType).map((t) => this.shapeKey(t)).join(",")}${r.required === undefined ? "" : `?${r.required}`}${r.rest === undefined ? "" : `...${this.shapeKey(r.rest)}`}]`;
      else if (r.kind === "object") found = `{${r.fields.map((f) => `${f.readonly ? "readonly " : ""}${JSON.stringify(f.name)}:${this.shapeKey(f.type)}`).join(",")}}`;
      else if (r.kind === "array") found = `${this.shapeKey(r.element)}[]`;
      else if (r.kind === "fixed") found = `FixedArray<${this.shapeKey(r.element)},${r.size}>`;
      else if (r.kind === "map") found = r.set ? `Set<${this.shapeKey(r.key)}>` : `Map<${this.shapeKey(r.key)},${this.shapeKey(r.value)}>`;
      else if (r.kind === "union") found = `(${r.members.map((t) => this.shapeKey(t)).join("|")})`;
      else if (r.kind === "ref") found = `${r.mutable ? "mut" : "ref"} ${this.shapeKey(r.to)}${r.life ? ` ${r.life}` : ""}`;
      // A type parameter standing for a concrete type has that type's shape.
      else if (r.kind === "param" && r.concrete) return this.shapeKey(r.concrete);
      else if (r.kind === "class" && r.generic) found = `${r.generic.name}<${r.generic.args.map((t) => this.shapeKey(t)).join(",")}>`;
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
    return { name, type: held ? written : this.unionType([written, "null"]), optional: held ? "held" : "added" };
  }

  // Whether a value of `from` fits where `to` is declared: the same type, or an object or
  // instance with at least the fields of the object type `to`, each fitting in turn.
  private assumed = new Set<string>();

  fits(this: Mut<this>, from: Type, to: Type): boolean {
    // A string literal fits a pattern it matches; a pattern is a string. Both are strings once
    // lowered, so this comes first.
    const fr = this.recOf(from);
    const tr = this.recOf(to);
    const target = tr?.kind === "param" && tr.concrete ? tr.concrete : to;
    if (from !== target && this.recOf(target)?.kind === "pattern") {
      if (fr?.kind === "union") return fr.members.every((m) => this.fits(m, target));
      return fr?.kind === "literal" && typeof fr.value === "string" && !fr.owner && this.textFits(fr.value, target);
    }
    // In an instance, a type parameter and the concrete type it stands for are one value.
    if (from === to || this.sameLowered(from, to) || from === "never" || this.sameCallable(from, to)) return true;
    // So does a value of a type parameter fit as what it stands for, a literal as its base type.
    if (fr?.kind === "param" && fr.concrete !== undefined && this.fits(fr.concrete, to)) return true;
    // A future fits the `Promise<T>` describing it, as an async function's result.
    if (tr?.kind === "interface" && this.promised.has(to as InterfaceType) && fr?.kind === "future") return !fr.throws && this.lower(fr.gives) === this.lower(this.promised.get(to as InterfaceType)!);
    // A reference reads the value where it lives, so it fits only a reference to the same type;
    // a mutable one also lends itself as shared. Lifetimes are checked on their own.
    // A reference into a recursive type's block is one to the type it stands for.
    if (tr?.kind === "ref") {
      return fr?.kind === "ref" && (fr.mutable || !tr.mutable) && this.lower(this.unfold(fr.to)) === this.lower(tr.to);
    }
    // Any regex is a \`RegExp\`; all of them are the same pointer to a program.
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
    if (tr?.kind === "union") {
      if (fr?.kind === "union") return fr.members.every((m) => this.fits(m, to));
      return tr.members.some((m) => this.fits(from, m));
    }
    // A union fits where every member it may hold does, as an enum fits an i64.
    if (fr?.kind === "union") return fr.members.every((m) => this.fits(m, to));
    if (fr?.kind === "pattern") return to === "string";
    if (fr?.kind === "literal") return this.baseOf(from as LiteralType) === to;
    // A closure fits a function type taking the same parameters, or the first of them, and
    // returning what it returns, or anything when it returns nothing.
    // A parameter of a function type fits through its signature.
    if (tr?.kind === "function") {
      const given = fr?.kind === "param" && fr.bound && this.rec(fr.bound).kind === "function" ? fr.concrete ?? fr.bound : from;
      // A stored callable fits by the function type it was written as.
      const g = this.recOf(given);
      const fn = g?.kind === "dyn" ? this.callableOf.get(g.of) : undefined;
      const callable = fn !== undefined;
      const sig = this.recOf(fn ?? given);
      // A stored callable's call passes all its parameters, so it takes exactly as many.
      if (callable && sig?.kind === "function" && sig.params.length !== tr.params.length) return false;
      // What it throws fits what the type throws, and one throwing nothing fits any.
      const throws = sig?.kind === "closure" || sig?.kind === "function" ? sig.throws : undefined;
      const caught = throws === undefined || (tr.throws !== undefined && this.fits(throws, tr.throws));
      return (sig?.kind === "closure" || sig?.kind === "function") && sig.params.length <= tr.params.length
        && sig.params.every((p, i) => this.lower(p) === this.lower(tr.params[i]!) || this.sameCallable(p, tr.params[i]!)) && (tr.returns === "void" || this.fits(sig.returns, tr.returns)) && caught;
    }
    if (fr?.kind === "ref") return false;
    // A tuple fits only a tuple of its length, element by element.
    if (this.isTuple(from) || this.isTuple(to)) {
      const [a, b] = [this.rec(from as ObjectType), this.rec(to as ObjectType)];
      // A tuple fits one of its shape, giving at least the elements that one requires.
      const shaped = this.isTuple(from) && this.isTuple(to) && a.fields.length === b.fields.length && (a.rest === undefined) === (b.rest === undefined);
      return shaped && (a.required ?? a.fields.length) >= (b.required ?? b.fields.length) && b.fields.every((f) => this.fits(this.field(from as ObjectType, f.name)!.type, f.type));
    }
    // An interface is satisfied by members, which only the checker can look up.
    if (typeof from === "string" || tr?.kind !== "object" || fr?.kind === "interface") return false;
    // A type parameter fits through its bound's fields, as any instance of it would.
    // A value may leave out a field whose type is an Option.
    return tr.fields.every((f) => {
      const found = this.field(from, f.name);
      if (!found) return this.isOption(f.type);
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
      if (!found) continue;
      if (found.readonly && !f.readonly) return `${path}${f.name}`;
      const deeper = this.unlocks(found.type, f.type, `${path}${f.name}.`);
      if (deeper) return deeper;
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
    if (tied) return this.describing ? `part of ${this.rec(tied).name}` : this.rec(tied).name;
    const r = this.rec(t);
    if (r.kind === "literal" && r.owner) return `${r.owner.enum}.${r.owner.member}`;
    if (r.kind === "literal") return typeof r.value === "string" ? JSON.stringify(r.value) : String(r.value);
    if (r.kind === "pattern") {
      const text = (q: string) => q.replaceAll("\\", "\\\\").replaceAll("`", "\\`").replaceAll("${", "\\${");
      return `\`${r.quasis.map((q, i) => (i === 0 ? text(q) : `\${${this.show(r.holes[i - 1]!)}}${text(q)}`)).join("")}\``;
    }
    if (r.kind === "union") return r.name ?? r.members.map((t) => this.show(t)).join(" | ");
    if (r.kind === "ref") return `${r.mutable ? "Mut" : "Ref"}<${this.show(r.to)}>`;
    if (r.kind === "pointer") return `${r.mutable ? "MutPtr" : "Ptr"}<${this.show(r.to)}>`;
    if (r.kind === "regex") return "RegExp";
    if (r.kind === "array") {
      const e = r.element;
      const er = this.recOf(e);
      const wrap = er !== undefined && ((er.kind === "union" && !er.name) || er.kind === "function" || er.kind === "closure" || (er.kind === "dyn" && this.callableOf.has(er.of)));
      return wrap ? `(${this.show(e)})[]` : `${this.show(e)}[]`;
    }
    if (r.kind === "fixed") return `FixedArray<${this.show(r.element)}, ${r.size}>`;
    if (r.kind === "map") return r.set ? `Set<${this.show(r.key)}>` : `Map<${this.show(r.key)}, ${this.show(r.value)}>`;
    if (r.kind === "generator") return `${r.async ? "Async" : ""}Generator<${this.show(r.yields)}>${r.throws ? ` throws ${this.show(r.throws)}` : ""}`;
    if (r.kind === "future") return `Promise<${this.show(r.gives)}>${r.throws ? ` throws ${this.show(r.throws)}` : ""}${this.describing ? ` ${r.name}(${r.frame.map((f) => this.show(f.type)).join(", ")})` : ""}`;
    if (r.kind === "interior") return `${r.which}<${this.show(r.of)}>`;
    if (r.kind === "shared") return `shared<${this.show(r.of)}>`;
    // A JS handle shows the shape its declaration gives it.
    // A package's shape is shown by the name the package gives it, not the one linking gave it.
    if (r.kind === "block") return r.which === "Channel" ? `Channel<${this.show(r.of)}>` : r.which === "JsValue" && r.of !== "void" ? this.show(r.of).replace(/-fsh\d+/g, "") : r.which;
    if (r.kind === "dyn") return !this.describing && (this.callableOf.has(r.of) || this.promised.has(r.of)) ? r.shown ?? this.rec(r.of).name : `Dyn<${this.rec(r.of).name}>`;
    if (r.kind === "recursive" && this.describing) return `recursive ${r.name}`;
    if (r.kind === "handle") return `${r.joined ? "Promise" : "JoinHandle"}<${this.show(r.gives)}>${r.throws ? ` throws ${this.show(r.throws)}` : ""}`;
    if (r.kind !== "object") return r.name;
    if (r.match && !this.describing) return "RegExpExecArray";
    if (r.tuple && !r.match) return `[${[...this.elementsOf(t as ObjectType).map((e, i) => (i < (r.required ?? Infinity) ? this.show(e) : `${this.show(this.withoutNull(e))}?`)), ...(r.rest === undefined ? [] : [`...${this.show(this.arrayType(r.rest))}`])].join(", ")}]`;
    if (r.fields.length === 0) return "{}";
    const name = (n: string) => (/^[A-Za-z_$][\w$]*$/.test(n) ? n : JSON.stringify(n));
    return `{ ${r.fields.map((f) =>
 `${f.readonly ? "readonly " : ""}${name(f.name)}${f.optional && f.optional !== "undefined" ? "?" : ""}: ${this.show(f.optional === "added" ? this.withoutNull(f.type) : f.type)}`).join("; ")} }`;
  }
}

// What makes a recursive type again with other type arguments, for lowering.
export interface RecursiveMaker {
  remakeRecursive(this: Mut<this>, t: RecursiveType, args: Type[]): RecursiveType;
}

// What declares the instances of generic classes, interfaces and enums that lowering needs.
export interface InstanceMaker {
  classInstance(this: Mut<this>, c: ClassType, args: Type[]): ClassType;
  interfaceInstance(this: Mut<this>, t: InterfaceType, args: Type[]): InterfaceType;
  variantInstance(this: Mut<this>, v: VariantType, args: Type[]): VariantType;
}
