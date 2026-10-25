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
export type ObjectType = { kind: "object"; fields: Field[]; tuple?: true; match?: true; required?: number; rest?: Type };

// A class is nominal: one object per declaration, so `===` is identity. Its own fields are in
// declaration order, filled in once resolved, and follow the base it embeds in memory.
// An instance of a generic class also records the class it came from and its type arguments.
export type ClassType = { kind: "class"; name: string; fields: Field[]; base?: ClassType; generic?: { name: string; args: Type[] } };

// An interface is a trait: fields and method signatures that any value with those members
// satisfies. It describes values but is never one, so it never reaches codegen. Its members
// are filled in once resolved.
// An interface's method; `mutable` and `owned` when it declares `this: Mut<this>` or
// `this: Own<this>`, which a call through a Dyn must allow for.
// A generic method, `map<U>(f: (x: T) => U): U`, keeps its type parameters' names and the node it
// was written as, as a generic function type does, each call resolving it.
export type Method = { name: string; params: Type[]; returns: Type; mutable?: boolean; owned?: boolean; generic?: Family };
// A generic interface's instance knows the interface and the type arguments it was made from.
export type InterfaceType = { kind: "interface"; name: string; fields: Field[]; methods: Method[]; generic?: { name: string; args: Type[] } };

// A type parameter: it stands for any type satisfying its bound, and offers only the bound's
// fields. At the definition it stands for nothing in particular. In an instance it also holds
// the concrete type it stands for, so the instance checks exactly as the definition did while
// codegen lays the value out as its concrete type; `lower` removes it before codegen.
export type ParamType = { kind: "param"; name: string; bound: Bound | undefined; fields: Field[]; concrete?: Type };

// A literal type has one value, known at compile time, so on its own it takes no space: it
// has no fields. An integer or boolean literal fits its base type; a string literal has none yet.
// An enum's member is a literal that knows its enum, so a plain literal is never one.
export type LiteralType = {
  kind: "literal"; value: string | bigint | boolean; fields: Field[];
  // For an enum's member: the enum, unique to its declaration, and the enum's own type.
  owner?: { enum: string; member: string; id: number; of?: Type };
};

// A union holds a value of one of its members: a tag naming which, then that member's value.
// It has no fields; reaching into one takes narrowing to a member first.
export type UnionType = { kind: "union"; members: Type[]; fields: Field[]; name?: string };

// A borrow of a value that lives elsewhere: `Ref<T>` shared, `Mut<T>` mutable. It is a pointer
// to the value, reads through to it, and copies like a pointer. A written lifetime names the
// function's lifetime parameter it lives for; it is checked, then erased.
export type RefType = { kind: "ref"; to: Type; mutable: boolean; fields: Field[]; life?: string };

// A member of a data-carrying enum: a nominal value holding positional fields named `0`, `1`,
// ..., laid out as an object's. One per enum instance and member, so `===` is identity. A
// generic enum's variant knows the enum's type arguments, to be made again from lowered ones.
export type VariantType = {
  kind: "variant"; name: string; member: string; enum: string; fields: Field[]; args: Type[];
  // The enum it belongs to, a union of its variants, once the enum is made.
  of?: Type;
};

// An owned array of elements of one type, growable like Rust's Vec. One per element type, so
// `===` is identity. It has no fields; its length and elements are reached by name and index.
export type ArrayType = { kind: "array"; element: Type; fields: Field[] };

// `FixedArray<T, N>`: exactly `size` elements stored inline, laid out as `[size x T]`; interned,
// so `===` is identity.
export type FixedType = { kind: "fixed"; element: Type; size: number; fields: Field[] };
// `Map<K, V>` and `Set<T>` (a Set's value is `void`): a pointer to an owned hash table in the
// runtime, its entries kept in insertion order.
export type MapType = { kind: "map"; key: Type; value: Type; set: boolean; fields: Field[] };

// A closure: an arrow function and what it captures. Each arrow, in each instance of the body
// it is written in, is its own type, so `===` is identity. Its value is its captures, laid out
// as its fields, which are never read by name.
// A closure that moves a captured value out of itself can run only once; `once` names one. A
// closure made in a generic body's definition check is never compiled, so it isn't concrete.
// A generic function used as a value, `generic` naming it, is a closure capturing nothing whose
// calls each instantiate that function, as calls of it by name do.
export type ClosureType = { kind: "closure"; name: string; params: Type[]; returns: Type; fields: Field[]; once?: string; concrete: boolean; generic?: string };

// A function type: the signature a closure must have to be passed where it is declared. Like an
// interface, it describes values without being one, so it never reaches codegen.
// A generic one, `<T>(x: T) => T`, is a family: `generic` holds its type parameters' names and
// the node it was written as, each call resolving it for that call's types.
// The type parameters around it, `scope`, are those it was written among; `own` are its type
// parameters' placeholders, in order, for comparing it with another.
export type Family = { names: string[]; node: unknown; scope: Map<string, Type>; own: Type[] };
export type FunctionType = { kind: "function"; name: string; names: string[]; params: Type[]; returns: Type; fields: Field[]; generic?: Family };

// What a type parameter may be bounded by.
export type Bound = ObjectType | InterfaceType | FunctionType | RegexType;

// The sized numbers. `isize` and `usize` are 64 bits on every target Fish supports.
export type Integer = "i8" | "i16" | "i32" | "i64" | "isize" | "u8" | "u16" | "u32" | "u64" | "usize";
export type Numeric = Integer | "f32" | "f64";

export const INTEGERS: Record<Integer, { bits: number; signed: boolean }> = {
  i8: { bits: 8, signed: true }, i16: { bits: 16, signed: true }, i32: { bits: 32, signed: true },
  i64: { bits: 64, signed: true }, isize: { bits: 64, signed: true },
  u8: { bits: 8, signed: false }, u16: { bits: 16, signed: false }, u32: { bits: 32, signed: false },
  u64: { bits: 64, signed: false }, usize: { bits: 64, signed: false },
};

export const isInteger = (t: Type): t is Integer => typeof t === "string" && t in INTEGERS;

// A template literal type with open holes, like `${number}px`: the strings that match it. Its
// values are strings, so it is a checker type only, which `lower` makes `string`.
export type PatternType = { kind: "pattern"; quasis: string[]; holes: Hole[]; fields: Field[] };
export type Hole = "string" | Numeric;

const patterns = new Map<string, PatternType>();
export function patternType(quasis: string[], holes: Hole[]): Type {
  // `${string}` alone is every string.
  if (holes.length === 1 && holes[0] === "string" && quasis.every((q) => q === "")) return "string";
  const key = JSON.stringify([quasis, holes]);
  let t = patterns.get(key);
  if (!t) {
    t = { kind: "pattern", quasis, holes, fields: [] };
    patterns.set(key, t);
    keys.set(t, `pattern ${key}`);
  }
  return t;
}

// Whether a pattern is anywhere in `t`, where lowering it to `string` would lose what it asks.
export function holdsPattern(t: Type): boolean {
  if (typeof t === "string") return false;
  let found = patterned.get(t);
  if (found === undefined) {
    patterned.set(t, false);
    const parts = t.kind === "union" ? t.members : t.kind === "array" || t.kind === "fixed" ? [t.element] : t.kind === "map" ? [t.key, t.value] : t.kind === "ref" || t.kind === "pointer" ? [t.to]
      : t.kind === "object" ? t.fields.map((f) => f.type) : t.kind === "class" ? (t.generic?.args ?? []) : t.kind === "param" && t.concrete ? [t.concrete]
      : t.kind === "interior" || t.kind === "shared" || t.kind === "block" ? [t.of] : t.kind === "handle" ? [t.gives, ...(t.throws ? [t.throws] : [])]
      : t.kind === "variant" ? [...t.args, ...t.fields.map((f) => f.type)] : t.kind === "function" || t.kind === "closure" ? [...t.params, t.returns]
      : t.kind === "future" ? [t.gives] : t.kind === "generator" ? [t.yields] : t.kind === "dyn" ? t.of.methods.flatMap((m) => [...m.params, m.returns]) : [];
    found = t.kind === "pattern" || parts.some(holdsPattern);
    patterned.set(t, found);
  }
  return found;
}
const patterned = new WeakMap<Exclude<Type, string>, boolean>();

// Whether two types are one once lowered, except where `to` holds a pattern that lowering
// would make a plain string: then fitting decides, part by part.
export function sameLowered(from: Type, to: Type): boolean {
  return lower(from) === lower(to) && (!holdsPattern(to) || holdsPattern(from) && shapeKey(from) === shapeKey(to));
}

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

// Whether a hole of type `t` takes `text`: any text for a string, the text a number of that type
// prints as for a number type, a literal's own text, or for a union, what any member takes.
export function textFits(text: string, t: Type): boolean {
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
  if (t.kind === "literal") return !t.owner && String(t.value) === text;
  if (t.kind === "union") return t.members.some((m) => textFits(text, m));
  if (t.kind === "pattern") {
    const parts = splitTemplate(text, t.quasis);
    return parts !== undefined && parts.every((p, i) => textFits(p, t.holes[i]!));
  }
  return false;
}
export const isFloat = (t: Type): t is "f32" | "f64" => t === "f32" || t === "f64";
export const isNumeric = (t: Type): t is Numeric => isInteger(t) || isFloat(t);

// Whether a type is an Option: a union one of whose members is the empty value.
export const isOption = (t: Type): t is UnionType => typeof t !== "string" && t.kind === "union" && t.members.includes("null");

// The values an integer type holds.
export function range(t: Integer): [bigint, bigint] {
  const { bits, signed } = INTEGERS[t];
  return signed ? [-(1n << BigInt(bits - 1)), (1n << BigInt(bits - 1)) - 1n] : [0n, (1n << BigInt(bits)) - 1n];
}

// `null` is the empty Option: `T | null`, `T | undefined` and `x?: T` are all a union holding
// it, which flattening keeps from nesting.
// `never` is the type of an expression that never finishes, like a throw expression; it fits
// anywhere, and a union drops it.
export type Type = Numeric | "boolean" | "void" | "null" | "never" | "string" | ObjectType | ClassType | InterfaceType | ParamType | LiteralType | PatternType | UnionType | RefType | ClosureType | FunctionType | ArrayType | FixedType | MapType | VariantType | GeneratorType | PointerType | FutureType | HandleType | InteriorType | SharedType | BlockType | DynType | RegexType | RecursiveType;

// `Atomic<T>`, `Lock<T>` and `Cell<T>`: a value changed through a shared reference, so a
// `const` or a `Ref` can still change what it holds. An Atomic and a Cell are laid out as what
// they hold, a Lock as its lock word, then what it holds.
export type InteriorType = { kind: "interior"; which: "Atomic" | "Lock" | "Cell"; of: Type; fields: Field[] };

const interiors = new Map<string, InteriorType>();

export function interiorType(which: InteriorType["which"], of: Type): InteriorType {
  const key = `${which} ${keyOf(of)}`;
  let t = interiors.get(key);
  if (!t) {
    t = { kind: "interior", which, of, fields: [] };
    interiors.set(key, t);
    keys.set(t, key);
  }
  return t;
}

// `shared<T>`: a counted pointer to a block holding the count, a lock word and the value, so
// every clone is the same value, read and changed from any thread.
export type SharedType = { kind: "shared"; of: Type; fields: Field[] };

const shareds = new Map<string, SharedType>();

export function sharedType(of: Type): SharedType {
  const key = `shared ${keyOf(of)}`;
  let t = shareds.get(key);
  if (!t) {
    t = { kind: "shared", of, fields: [] };
    shareds.set(key, t);
    keys.set(t, key);
  }
  return t;
}

// `Dyn<I>`: a value of any type implementing interface I, owned in a heap block, with a vtable
// of what that type does: drop it, clone it, and each of I's members.
export type DynType = { kind: "dyn"; of: InterfaceType; fields: Field[] };

const dyns = new Map<InterfaceType, DynType>();

export function dynType(of: InterfaceType): DynType {
  let t = dyns.get(of);
  if (!t) {
    t = { kind: "dyn", of, fields: [] };
    dyns.set(of, t);
    keys.set(t, `dyn ${keyOf(of)}`);
  }
  return t;
}

// A stored callable: a written function type in a field, an element, an annotated variable or
// a return is a Dyn of an interface with one method, `call`, which a closure satisfies by its
// signature. One per function type as written, so messages show its own parameter names;
// those with the same types convert freely (`sameCallable`).
const callables = new Map<string, InterfaceType>();
export const callableOf = new WeakMap<InterfaceType, FunctionType>();

export function callableType(fn: FunctionType): DynType {
  // In an instance, what its type parameters stand for decides the layout.
  const [params, returns] = [fn.params.map(lower), lower(fn.returns)];
  const key = `${fn.name} ${params.map(keyOf).join(", ")} => ${keyOf(returns)}`;
  let i = callables.get(key);
  if (!i) {
    i = interfaceType(fn.name);
    i.methods.push({ name: "call", params, returns });
    callables.set(key, i);
    callableOf.set(i, { ...fn, params, returns });
  }
  return dynType(i);
}

// Whether two stored callables take and give the same types, so either holds the other's value.
export function sameCallable(a: Type, b: Type): boolean {
  const [f, g] = [a, b].map((t) => (typeof t !== "string" && t.kind === "dyn" ? callableOf.get(t.of) : undefined));
  return f !== undefined && g !== undefined && f.params.length === g.params.length && f.params.every((p, i) => lower(p) === lower(g.params[i]!)) && lower(f.returns) === lower(g.returns);
}

// A function type, or a `Promise<T>`, where a value is stored becomes its boxed form, inside
// arrays too.
export function stored(t: Type): Type {
  if (typeof t === "string") return t;
  // A generic function type, like an interface, describes a value without being one.
  if (t.kind === "function" && t.generic) return t;
  if (t.kind === "function") return callableType(t);
  // A `Promise<T>` stored holds a future, boxed.
  if (t.kind === "interface" && promised.has(t)) return dynType(t);
  if (t.kind === "array") return arrayType(stored(t.element));
  if (t.kind === "fixed") return fixedType(stored(t.element), t.size);
  if (t.kind === "map") return mapType(t.key, stored(t.value), t.set);
  return t;
}

// `Semaphore`, its `Permit` and `Channel<T>`: each a pointer to a counted block in the runtime,
// which tasks wait on without holding a thread. A Permit holds a count on its Semaphore. An
// `AbortController` and its `AbortSignal`s are handles to one block.
// A FileJob is a file read or write handed to the runtime's blocking pool.
export type BlockType = { kind: "block"; which: "Semaphore" | "Permit" | "Channel" | "AbortController" | "AbortSignal" | "TcpListener" | "TcpStream" | "FileJob"; of: Type; fields: Field[] };

const blocks = new Map<string, BlockType>();

export function blockType(which: BlockType["which"], of: Type = "void"): BlockType {
  const key = `${which} ${keyOf(of)}`;
  let t = blocks.get(key);
  if (!t) {
    t = { kind: "block", which, of, fields: [] };
    blocks.set(key, t);
    keys.set(t, key);
  }
  return t;
}

// The futures a Semaphore's and a Channel's methods give, and a `sleep` given a signal, polled by
// the runtime: each frame holds its state, a count on the block (or a sleep's deadline), and for
// `send` the value going in. One given an AbortSignal ends with a count on it and whether it is
// waiting on it, and throws the `AbortError` it is given. `leafOf` names each one's method and
// what it carries.
export type Leaf = "acquire" | "send" | "receive" | "sleep" | "bind" | "connect" | "accept" | "read" | "write" | "readFile" | "writeFile";
const leaves = new Map<string, FutureType>();
export const leafOf = new WeakMap<FutureType, { method: Leaf; of: Type; signal: boolean }>();

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
};

// A leaf future: what it gives, what it may throw, and whether it was given an AbortSignal, whose
// count and waiting flag end its frame.
export function leafFuture(method: Leaf, of: Type, throws?: Type, signal = false): FutureType {
  const key = `${method} ${keyOf(of)} ${throws ? keyOf(throws) : ""} ${signal}`;
  let t = leaves.get(key);
  if (!t) {
    const frame: Field[] = [{ name: "state", type: "i32" }, ...LEAF_FRAMES[method](of)];
    if (signal) frame.push({ name: "signal", type: blockType("AbortSignal") }, { name: "waiting", type: "i32" });
    const gives: Type = method === "acquire" ? blockType("Permit") : method === "receive" ? unionType([of, "null"]) : method === "bind" ? blockType("TcpListener")
      : method === "connect" || method === "accept" ? blockType("TcpStream") : method === "read" || method === "readFile" ? arrayType("u8") : "void";
    t = { kind: "future", name: method, gives, throws, fields: [], params: [], frame, concrete: true };
    leaves.set(key, t);
    leafOf.set(t, { method, of, signal });
  }
  return t;
}

// A spawned task's `JoinHandle<T>`: what its future gives and may throw, awaited like it. A
// counted pointer to the task; dropping it detaches the task.
export type HandleType = { kind: "handle"; gives: Type; throws?: Type; fields: Field[] };

const handles = new Map<string, HandleType>();

export function handleType(gives: Type, throws: Type | undefined): HandleType {
  const key = `handle ${keyOf(gives)} ${throws ? keyOf(throws) : ""}`;
  let t = handles.get(key);
  if (!t) {
    t = { kind: "handle", gives, throws, fields: [] };
    handles.set(key, t);
    keys.set(t, key);
  }
  return t;
}

// An async function's future, a `Promise<T>`: what it gives once awaited, what it may throw,
// its parameters, which say what it borrows, and the frame its state lives in, as a
// generator's. Polled where it lives and never moved after its first poll. One per async
// instance, so `===` is nominal identity; it has no properties.
export type FutureType = { kind: "future"; name: string; gives: Type; throws?: Type; fields: Field[]; params: Field[]; frame: Field[]; concrete: boolean };

export function futureType(name: string, concrete: boolean): FutureType {
  const t: FutureType = { kind: "future", name, gives: "void", fields: [], params: [], frame: [], concrete };
  keys.set(t, `future ${declared++}`);
  return t;
}

// `sleep(ms)`'s future: its state, then the delay, then the deadline the runtime sets.
export const SLEEP: FutureType = { kind: "future", name: "sleep", gives: "void", fields: [], params: [], frame: [{ name: "state", type: "i32" }, { name: "deadline", type: "i64" }], concrete: true };

// A future awaiting several at once in its task, made for one `Promise.all` or `Promise.race`
// call: `all` gives each one's value as a tuple, `race` the first to settle's. Its frame is its
// state, then for each future the future, its value, and how far it got: 0 not yet polled, 1
// waiting, 2 done. A future giving nothing gives null here.
// Over an array of `Promise<T>` values, `array` is its type, and the frame holds the array, the
// values and a flag per future instead. `aggregate` is the AggregateError an `any` throws when
// every future fails.
export type Combined = { kind: "all" | "race" | "allSettled" | "any"; futures: (FutureType | HandleType | DynType)[]; array?: ArrayType; aggregate?: ClassType; at: { start: number; end: number } };
export const combinedOf = new WeakMap<FutureType, Combined>();

// What a future in a combined one gives, null for nothing, and what it throws.
function givenBy(f: FutureType | HandleType | DynType): Type {
  const gives = f.kind === "dyn" ? promiseElement(f.of)! : f.gives;
  return gives === "void" ? "null" : gives;
}
const thrownBy = (f: FutureType | HandleType | DynType): Type | undefined => (f.kind === "dyn" ? undefined : f.throws);

// An `allSettled` outcome, as JavaScript gives it: fulfilled with the value, or, for a future that
// can throw, rejected with what it threw.
export function settledType(gives: Type, thrown: Type | undefined): Type {
  const { fulfilled, rejected } = settledParts(gives, thrown);
  return rejected ? unionType([fulfilled, rejected]) : fulfilled;
}

export function settledParts(gives: Type, thrown: Type | undefined): { fulfilled: ObjectType; rejected?: ObjectType } {
  const fulfilled = objectType([{ name: "status", type: literalType("fulfilled") }, { name: "value", type: gives }]);
  return { fulfilled, rejected: thrown ? objectType([{ name: "status", type: literalType("rejected") }, { name: "reason", type: thrown }]) : undefined };
}

export function combinedFuture(combined: Combined): FutureType {
  const { kind } = combined;
  const make = (gives: Type, throws: Type | undefined, frame: Field[]) => {
    const params = combined.futures.flatMap((f) => (f.kind === "future" ? f.params : []));
    const t: FutureType = { kind: "future", name: `Promise.${kind}`, gives, throws, fields: [], params, frame, concrete: true };
    keys.set(t, `future ${declared++}`);
    combinedOf.set(t, combined);
    return t;
  };
  if (combined.array) {
    const given = givenBy(combined.array.element as DynType);
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

// `yieldNow()`'s future, which is pending once, then done.
export const YIELD_NOW: FutureType = { kind: "future", name: "yieldNow", gives: "void", fields: [], params: [], frame: [{ name: "state", type: "i32" }], concrete: true };

const promises = new Map<string, InterfaceType>();
const promised = new WeakMap<InterfaceType, Type>();

// `Promise<T>`: any future giving a `T` once awaited, as TypeScript's type of an async result is.
export function promiseInterface(t: Type): InterfaceType {
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
export const borrowing = new WeakSet<InterfaceType>();

export function lentPromise(t: Type): DynType {
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
export function sharesDyn(t: DynType): boolean {
  return !promised.has(t.of) && t.of.methods.every((m) => !m.mutable && !m.owned);
}

// What a `Promise<T>` gives, when the interface is one.
export function promiseElement(t: Type): Type | undefined {
  return typeof t !== "string" && t.kind === "interface" ? promised.get(t) : undefined;
}

// A raw pointer, `Ptr<T>` or `MutPtr<T>`: an address the borrow checker doesn't follow, used
// only inside `unsafe`. It copies like a number and owns nothing.
export type PointerType = { kind: "pointer"; to: Type; mutable: boolean; fields: Field[] };

// A regex: its pattern and flags, which fix what each capture may hold. Its value points at a
// compiled program that never changes, so it copies freely and needs no drop.
// \`source\` is how JavaScript shows the pattern; \`pattern\` what is matched, which differ only for
// a \`new RegExp\` whose string held a \`/\` or a line terminator.
export type RegexType = { kind: "regex"; source: string; pattern: string; flags: string; captures: { name: string | undefined; optional: boolean }[]; fields: Field[]; any?: true };

// The \`RegExp\` annotation: any regex. A parameter of it is an implicit type parameter, so each
// instance knows its regex; elsewhere it holds one whose pattern isn't known there.
export const ANY_REGEX: RegexType = { kind: "regex", source: "", pattern: "", flags: "", captures: [], fields: [], any: true };

const regexes = new Map<string, RegexType>();

export function regexType(pattern: string, flags: string, captures: RegexType["captures"], source = pattern): RegexType {
  const key = `regex ${flags} ${pattern}`;
  let t = regexes.get(key);
  if (!t) {
    t = { kind: "regex", source, pattern, flags, captures, fields: [] };
    regexes.set(key, t);
    keys.set(t, key);
  }
  return t;
}

// Where a type leads back to itself, as `next` does in `type Node = { next: Node | null }`: a
// pointer to a block holding `of`, the type it stands for, which is set once that is made. It
// is that type everywhere but in its layout, and every walk over types stops at it.
// `args` are the alias's type arguments, so one made from type parameters is remade for what
// they stand for.
export type RecursiveType = { kind: "recursive"; name: string; args: Type[]; of: Type; fields: Field[] };

// One per alias instance a program's types lead back to; the checker keeps them by instance.
export function recursiveType(name: string, args: Type[]): RecursiveType {
  const t: RecursiveType = { kind: "recursive", name, args, of: "never", fields: [] };
  keys.set(t, `recursive ${declared++}`);
  return t;
}

// The recursive type standing for a class or an enum instance, made once for it, so the one
// made for another instance is found from the instance.
const heldBlocks = new WeakMap<Exclude<Type, string>, RecursiveType>();
export function blockFor(t: ClassType | UnionType, args: Type[]): RecursiveType {
  let back = heldBlocks.get(t);
  if (!back) {
    heldBlocks.set(t, back = recursiveType(show(t), args));
    standsFor(back, t);
  }
  return back;
}
export function holdsBlock(t: UnionType, back: RecursiveType) {
  heldBlocks.set(t, back);
}

// The same recursive type made with other type arguments, which only the checker can make.
let instanceRecursive = (t: RecursiveType, _args: Type[]): RecursiveType => t;
export function lowersRecursive(f: typeof instanceRecursive) {
  instanceRecursive = f;
}

// A recursive type for other type arguments: a class's or an enum's is found from its instance,
// `of` made with them, which makes the instance without reading its fields; an alias's is
// remade by the checker.
function remade(t: RecursiveType, of: () => Type, args: Type[]): RecursiveType {
  const kind = typeof t.of !== "string" ? t.of.kind : undefined;
  if (kind === "class" || (kind === "union" && heldBlocks.get(t.of as UnionType) === t)) {
    const made = of();
    return typeof made !== "string" && (made.kind === "class" || made.kind === "union") ? blockFor(made, args) : t;
  }
  return instanceRecursive(t, args);
}

// Whether a value of `type` lent where a type parameter is wanted is a part of a value whose type
// holds itself, the parameter standing for that type: each instance checks it again.
export function partOfItself(type: Type, to: Type): boolean {
  if (typeof to === "string" || to.kind !== "param" || to.concrete || to.bound === undefined || lower(type) !== lower(to.bound)) return false;
  const bound = to.bound;
  return ties.has(bound) || holdsPart(bound, (u) => typeof u !== "string" && u.kind === "recursive" && u.of === lower(type));
}

// The part of a type that keeps `===` from comparing its values, or undefined when every part
// compares: primitives, strings and literals, and objects, tuples, arrays and unions of them. A
// class compares through its `equals`, and a data enum when it derives Eq; `eq` says which do.
export function unequal(t: Type, eq: (t: ClassType | VariantType) => boolean, seen = new Set<Type>()): Type | undefined {
  if (typeof t === "string" || seen.has(t)) return undefined;
  seen.add(t);
  const part = (u: Type) => unequal(u, eq, seen);
  switch (t.kind) {
    case "literal":
    case "pattern":
    case "pointer":
      return undefined;
    case "ref":
      return part(t.to);
    case "recursive":
      return part(t.of);
    // An open type parameter is judged in each instance, where it is concrete.
    case "param":
      return t.concrete ? part(t.concrete) : undefined;
    case "union":
      return t.members.map(part).find((p) => p !== undefined);
    case "array":
    case "fixed":
      return part(t.element);
    case "object":
      return t.match ? t : t.fields.map((f) => part(f.type)).find((p) => p !== undefined);
    case "class":
      return eq(t) ? undefined : t;
    case "variant":
      if (!eq(t)) return t;
      return (t.of && typeof t.of !== "string" && t.of.kind === "union" ? t.of.members : [t])
        .flatMap((v) => (typeof v !== "string" && v.kind === "variant" ? v.fields : []))
        .map((f) => part(f.type)).find((p) => p !== undefined);
    default:
      return t;
  }
}

// The part of a type that `console.log` can't print as Node's util.inspect would, or undefined:
// every value but functions, handles and other runtime objects prints, a type parameter in each
// instance once it is concrete.
export function uninspectable(t: Type, seen = new Set<Type>()): Type | undefined {
  if (typeof t === "string") return t === "void" ? t : undefined;
  if (seen.has(t)) return undefined;
  seen.add(t);
  const part = (u: Type) => uninspectable(u, seen);
  const first = (parts: Type[]) => parts.map(part).find((p) => p !== undefined);
  switch (t.kind) {
    case "literal":
    case "pattern":
      return undefined;
    case "ref":
      return part(t.to);
    case "recursive":
      return part(t.of);
    case "param":
      return t.concrete ? part(t.concrete) : undefined;
    case "union":
      return first(t.members);
    case "array":
    case "fixed":
      return part(t.element);
    case "map":
      return first(t.set ? [t.key] : [t.key, t.value]);
    case "object":
      return t.match ? t : first(t.fields.map((f) => f.type));
    case "class":
      // The prelude's Error prints its cause through what ErrorLike gives.
      if ((t.name === "Error" && !t.generic) || t.generic?.name === "AggregateError") return t.generic ? part(t.generic.args[0]!) : undefined;
      return first([...(t.base ? [t.base] : []), ...t.fields.filter((f) => !f.name.startsWith("#")).map((f) => f.type)]);
    case "variant":
      return first((t.of && typeof t.of !== "string" && t.of.kind === "union" ? t.of.members : [t]).flatMap((v) => (typeof v !== "string" && v.kind === "variant" ? v.fields.map((f) => f.type) : [])));
    default:
      return t;
  }
}

// The part of a type that keeps `JSON.stringify` and `JSON.parse` from taking its values, or
// undefined when every part is Json: booleans, numbers, strings and literals, and objects,
// tuples, arrays, unions and string-keyed Maps of them, with the classes and data enums that
// `json` says derive it. A class's `#private` fields aren't written, as in JavaScript.
export function unjson(t: Type, json: (t: ClassType | VariantType) => boolean, seen = new Set<Type>()): Type | undefined {
  if (typeof t === "string") return t === "void" || t === "never" ? t : undefined;
  if (seen.has(t)) return undefined;
  seen.add(t);
  const part = (u: Type) => unjson(u, json, seen);
  const first = (parts: Type[]) => parts.map(part).find((p) => p !== undefined);
  switch (t.kind) {
    case "literal":
    case "pattern":
      return undefined;
    case "ref":
      return part(t.to);
    case "recursive":
      return part(t.of);
    case "param":
      return t.concrete ? part(t.concrete) : undefined;
    case "union":
      return first(t.members);
    case "array":
    case "fixed":
      return part(t.element);
    case "object":
      return t.match ? t : first(t.fields.map((f) => f.type));
    case "map":
      return t.set || lower(t.key) !== "string" ? t : part(t.value);
    case "class":
      return json(t) ? first([...(t.base ? [t.base] : []), ...t.fields.filter((f) => !f.name.startsWith("#")).map((f) => f.type)]) : t;
    case "variant":
      if (!json(t)) return t;
      return first((t.of && typeof t.of !== "string" && t.of.kind === "union" ? t.of.members : [t]).flatMap((v) => (typeof v !== "string" && v.kind === "variant" ? v.fields.map((f) => f.type) : [])));
    default:
      return t;
  }
}

// The type a recursive type stands for, or the type itself.
export const unfold = (t: Type): Type => (typeof t !== "string" && t.kind === "recursive" ? t.of : t);

// What reading a place of `t` gives: a recursive type, or a union's recursive members, as the
// types they stand for, held in a value of their own rather than in a block.
export function unfolded(t: Type): Type {
  if (typeof t !== "string" && t.kind === "union" && t.members.some((m) => typeof m !== "string" && m.kind === "recursive")) return unionType(t.members.map(unfold), t.name);
  return unfold(t);
}

const pointers = new Map<string, PointerType>();

export function pointerType(to: Type, mutable: boolean): PointerType {
  const key = `${mutable ? "mutptr" : "ptr"} ${keyOf(to)}`;
  let t = pointers.get(key);
  if (!t) {
    t = { kind: "pointer", to, mutable, fields: [] };
    pointers.set(key, t);
    keys.set(t, key);
  }
  return t;
}

// A generator: what it yields, its parameters, which say what it borrows, and the frame its
// state lives in, filled once the body is checked. It has no properties, so `fields` stays
// empty. One per generator instance, so `===` is nominal identity.
export type GeneratorType = { kind: "generator"; name: string; yields: Type; fields: Field[]; params: Field[]; frame: Field[]; concrete: boolean };

const interned = new Map<string, ObjectType>();
const literals = new Map<string, LiteralType>();
const unions = new Map<string, UnionType>();
const keys = new Map<Exclude<Type, string>, string>();
let declared = 0;

// A class's key is unique to its declaration, since two programs may reuse a class name.
export function classType(name: string, generic?: ClassType["generic"]): ClassType {
  const t: ClassType = { kind: "class", name, fields: [], generic };
  keys.set(t, `class ${declared++}`);
  return t;
}

export function interfaceType(name: string): InterfaceType {
  const t: InterfaceType = { kind: "interface", name, fields: [], methods: [] };
  keys.set(t, `interface ${declared++}`);
  return t;
}

export function generatorType(name: string, concrete: boolean): GeneratorType {
  const t: GeneratorType = { kind: "generator", name, yields: "never", fields: [], params: [], frame: [], concrete };
  keys.set(t, `generator ${declared++}`);
  return t;
}

// What `next()` gives: the next value, or that the generator has finished.
export function nextResult(t: Type): Type {
  return unionType([objectType([{ name: "done", type: literalType(false) }, { name: "value", type: t }]), objectType([{ name: "done", type: literalType(true) }])]);
}

const generators = new Map<string, InterfaceType>();
const elements = new WeakMap<InterfaceType, Type>();

// `Generator<T>`: anything whose `next()` gives `T`s, as TypeScript's type of a generator is.
export function generatorInterface(t: Type): InterfaceType {
  let found = generators.get(keyOf(t));
  if (!found) {
    found = interfaceType(`Generator<${show(t)}>`);
    found.methods.push({ name: "next", params: [], returns: nextResult(t) });
    generators.set(keyOf(t), found);
    elements.set(found, t);
  }
  return found;
}

// What a generator, or a type parameter standing for one or bounded by `Generator<T>`, yields.
export function yieldsOf(t: Type): Type | undefined {
  if (typeof t === "string") return undefined;
  if (t.kind === "generator") return t.yields;
  if (t.kind === "param") return t.concrete ? yieldsOf(t.concrete) : t.bound && generatorElement(t.bound);
  return generatorElement(t);
}

// What a `Generator<T>` yields, when the interface is one.
export function generatorElement(t: Type): Type | undefined {
  return typeof t !== "string" && t.kind === "interface" ? elements.get(t) : undefined;
}

export function functionType(names: string[], params: Type[], returns: Type): FunctionType {
  const t: FunctionType = { kind: "function", name: `(${params.map((p, i) => `${names[i]}: ${show(p)}`).join(", ")}) => ${show(returns)}`, names, params, returns, fields: [] };
  keys.set(t, `function ${declared++}`);
  return t;
}

export function closureType(names: string[], params: Type[], returns: Type, fields: Field[], once: string | undefined, concrete: boolean): ClosureType {
  const t: ClosureType = { kind: "closure", name: `(${params.map((p, i) => `${names[i]}: ${show(p)}`).join(", ")}) => ${show(returns)}`, params, returns, fields, once, concrete };
  keys.set(t, `closure ${declared++}`);
  return t;
}

const genericValues = new Map<string, ClosureType>();

// The one type of a generic function used as a value, by the function's name.
export function genericFunctionType(name: string, shown: string): ClosureType {
  let t = genericValues.get(name);
  if (!t) {
    t = { kind: "closure", name: shown, params: [], returns: "void", fields: [], concrete: true, generic: name };
    keys.set(t, `generic function ${name}`);
    genericValues.set(name, t);
  }
  return t;
}

export function literalType(value: string | bigint | boolean, owner?: LiteralType["owner"]): LiteralType {
  const key = `literal ${typeof value} ${value}${owner ? ` of ${owner.enum}.${owner.member} ${owner.id}` : ""}`;
  let t = literals.get(key);
  if (!t) {
    t = { kind: "literal", value, fields: [], owner };
    literals.set(key, t);
    keys.set(t, key);
  }
  return t;
}

// A literal standing for a comptime value that isn't a string, number or boolean, such as a
// tag's strings: interned by `key`, and never equal to an ordinary literal.
export function standInLiteral(key: string): LiteralType {
  const at = `stand-in ${key}`;
  let t = literals.get(at);
  if (!t) {
    t = { kind: "literal", value: key, fields: [] };
    literals.set(at, t);
    keys.set(t, at);
  }
  return t;
}

// Members are flattened, deduplicated and kept in one order, so equal unions are one type,
// and a literal whose base type is also a member adds nothing. A single member is itself.
// An enum's union carries the enum's name, for messages.
export function unionType(parts: Type[], name?: string): Type {
  let flat = parts.flatMap((p) => (typeof p !== "string" && p.kind === "union" ? p.members : [p])).filter((p, _, all) => p !== "never" || all.every((q) => q === "never"));
  // Regexes of different patterns are one \`RegExp\`, as every regex is a pointer to a program.
  if (new Set(flat.filter((p) => typeof p !== "string" && p.kind === "regex")).size > 1) flat = flat.map((p) => (typeof p !== "string" && p.kind === "regex" ? ANY_REGEX : p));
  // Members of one value shape, like `{ a?: T }` and `{ a: T | null }`, are one member, spelled
  // as whichever sorts first.
  const seen = new Set<string>();
  const members = [...new Set(flat)]
    .filter((t) => typeof t === "string" || (t.kind !== "literal" || !flat.includes(baseOf(t)!)) && (t.kind !== "pattern" || !flat.includes("string")))
    .toSorted((a, b) => (keyOf(a) < keyOf(b) ? -1 : keyOf(a) > keyOf(b) ? 1 : 0))
    .filter((t) => {
      const shape = shapeKey(t);
      return !seen.has(shape) && seen.add(shape) !== undefined;
    });
  if (members.length === 1) return members[0]!;
  const key = `union ${members.map(keyOf).join("|")}`;
  let t = unions.get(key);
  if (!t) {
    t = { kind: "union", members, fields: [], name };
    unions.set(key, t);
    keys.set(t, key);
  }
  return t;
}

// The members of `union` a value of `type` can go into: the one it is, or else every one it
// fits. The checker allows exactly one.
export function membersFor(type: Type, union: UnionType): Type[] {
  return union.members.includes(type) ? [type] : union.members.filter((m) => fits(type, m));
}

// An enum's member widens to its enum where TypeScript widens it: a `let`, a field, a type
// argument or a property, since the place may later hold another member.
export function widenEnum(t: Type): Type {
  if (typeof t !== "string" && t.kind === "variant" && t.of) return t.of;
  return typeof t !== "string" && t.kind === "literal" && t.owner?.of ? t.owner.of : t;
}

// A `let` holds its literal's whole type too, as in TypeScript: `let s = "a"` is a string.
export function widenLet(t: Type): Type {
  if (typeof t !== "string" && t.kind === "literal" && !t.owner && typeof t.value === "string") return "string";
  // A \`let\` may later hold another regex, so it holds any.
  if (typeof t !== "string" && t.kind === "regex") return ANY_REGEX;
  return widenEnum(t);
}

// The type a literal's value belongs to, if Fish has it yet.
export function baseOf(t: LiteralType): "i64" | "boolean" | "string" {
  return typeof t.value === "bigint" ? "i64" : typeof t.value === "boolean" ? "boolean" : "string";
}

export function typeParameter(name: string, bound: Bound | undefined): ParamType {
  const t: ParamType = { kind: "param", name, bound, fields: bound?.fields ?? [] };
  keys.set(t, `param ${declared++}`);
  return t;
}

export function refType(to: Type, mutable: boolean, life?: string): RefType {
  const key = `${mutable ? "mut" : "ref"} ${keyOf(to)}${life ? ` ${life}` : ""}`;
  let t = refs.get(key);
  if (!t) {
    t = { kind: "ref", to, mutable, fields: [], life };
    refs.set(key, t);
    keys.set(t, key);
  }
  return t;
}

const refs = new Map<string, RefType>();

export function fixedType(element: Type, size: number): FixedType {
  const key = `fixed ${size} ${keyOf(element)}`;
  let t = fixeds.get(key);
  if (!t) {
    t = { kind: "fixed", element, size, fields: [] };
    fixeds.set(key, t);
    keys.set(t, key);
  }
  return t;
}
const fixeds = new Map<string, FixedType>();

export function arrayType(element: Type): ArrayType {
  const key = `[${keyOf(element)}]`;
  let t = arrays.get(key);
  if (!t) {
    t = { kind: "array", element, fields: [] };
    arrays.set(key, t);
    keys.set(t, key);
  }
  return t;
}

const arrays = new Map<string, ArrayType>();

// Sets the type a recursive type stands for. An array is on the heap already, so where the
// type reaches itself through one, that array holds the type itself rather than a block, and is
// the array `Tree[]` means wherever it is written. The type then holds itself, a loop the walks
// over types stop at by the recursive type kept for it.
export function standsFor(back: RecursiveType, of: Type) {
  back.of = of;
  // A Map that leads back holds the type inline too, as an array does, so a Map written with
  // the type is the one the type holds.
  if (typeof of !== "string" && of.kind !== "map") {
    for (const map of [...maps.values()]) {
      if (map.value !== back) continue;
      map.value = of;
      maps.set(`${map.set ? "Set" : "Map"}<${keyOf(map.key)},${keyOf(of)}>`, map);
      ties.set(of, back);
    }
  }
  const array = arrays.get(`[${keyOf(back)}]`);
  // A type that is itself an array, as `type T = T[]`, has no other part to hold, so its
  // elements stay blocks.
  if (!array || typeof of === "string" || of.kind === "array") return;
  array.element = of;
  arrays.set(`[${keyOf(of)}]`, array);
  ties.set(of, back);
  // Its members stay as they are too, so one narrowed to is still a member of it.
  if (of.kind === "union") for (const m of of.members) if (typeof m !== "string" && m.kind === "object") members.set(m, back);
}

// The type holding itself that each member of its union belongs to.
const members = new WeakMap<Exclude<Type, string>, RecursiveType>();

const ties = new WeakMap<Exclude<Type, string>, RecursiveType>();

// The recursive type a type holding itself through an array was made with.
export const tiedBy = (t: Type): RecursiveType | undefined => (typeof t === "string" ? undefined : ties.get(t));

export function mapType(key: Type, value: Type, set = false): MapType {
  const id = `${set ? "Set" : "Map"}<${keyOf(key)},${keyOf(value)}>`;
  let t = maps.get(id);
  if (!t) {
    t = { kind: "map", key, value, set, fields: [] };
    maps.set(id, t);
    keys.set(t, id);
  }
  return t;
}

const maps = new Map<string, MapType>();

// The variant `member` of an enum declaration (by its unique id) with these type arguments.
export function variantType(enumName: string, id: number, member: string, args: Type[], payload: Type[]): VariantType {
  const key = `variant ${id} ${member} <${args.map(keyOf).join(",")}>`;
  let t = variants.get(key);
  if (!t) {
    const shown = args.length > 0 ? `${enumName}<${args.map(show).join(", ")}>` : enumName;
    t = { kind: "variant", name: `${shown}.${member}`, member, enum: enumName, fields: payload.map((type, i) => ({ name: String(i), type })), args };
    variants.set(key, t);
    // A short key of its own, so an enum nested in itself doesn't double its key each level.
    keys.set(t, `variant#${variants.size}`);
  }
  return t;
}

const variants = new Map<string, VariantType>();

// Primitives, literals, references, and unions of nothing else are copied; objects,
// instances, interface values and type parameters move. A closure copies like what it holds. A mutable reference passed on is
// lent again rather than moved, so it copies too.
// Whether a type is the class `c`, or a class extending it: what `instanceof c` tests.
export function isSubclass(t: Type, c: Type): boolean {
  for (let x: Type | undefined = t; typeof x !== "string" && x?.kind === "class"; x = x.base) if (x === c) return true;
  return false;
}

export function isCopy(t: Type): boolean {
  if (typeof t === "string" || t.kind === "literal" || t.kind === "pattern" || t.kind === "ref" || t.kind === "pointer" || t.kind === "regex") return true;
  // A closure copies when what it captures does, and it changes nothing through it.
  if (t.kind === "closure") return t.fields.every((f) => isCopy(f.type) && !holdsMut(f.type));
  // A parameter of a generic function type holds a generic function value, which captures nothing.
  if (t.kind === "param" && t.bound?.kind === "function" && t.bound.generic) return true;
  // A fixed array copies when its elements do, as Rust's `[T; N]` does.
  if (t.kind === "fixed") return isCopy(t.element) && !holdsMut(t.element);
  // A tuple copies when everything in it does, as a union does.
  // A copy of a mutable reference would be a second one, so a tuple holding one moves.
  if (isTuple(t)) return (t as ObjectType).fields.every((f) => isCopy(f.type) && !holdsMut(f.type));
  return t.kind === "union" && t.members.every(isCopy);
}

// Whether a value of `t` holds a mutable reference anywhere, which a copy would alias.
export function holdsMut(t: Type, seen = new Set<Type>()): boolean {
  if (typeof t === "string" || seen.has(t)) return false;
  seen.add(t);
  const inner = (u: Type) => holdsMut(u, seen);
  if (t.kind === "ref") return t.mutable;
  if (t.kind === "recursive") return holdsPart(t.of, (u) => typeof u !== "string" && u.kind === "ref" && u.mutable);
  if (t.kind === "param") return t.concrete ? inner(t.concrete) : t.bound !== undefined && inner(t.bound);
  if (t.kind === "union") return t.members.some(inner);
  if (t.kind === "array" || t.kind === "fixed") return inner(t.element);
  if (t.kind === "map") return inner(t.value);
  if (t.kind === "variant") return t.fields.some((f) => inner(f.type));
  if (t.kind === "class") return t.fields.some((f) => inner(f.type)) || (t.base !== undefined && inner(t.base));
  if (t.kind === "generator" || t.kind === "future") return t.params.some((f) => inner(f.type));
  return (t.kind === "object" || t.kind === "closure") && t.fields.some((f) => inner(f.type));
}

// Whether a value of `t` holds a reference anywhere, which only lifetimes could keep valid. A
// class met again inside itself adds nothing; one that contains itself is refused elsewhere.
export function holdsRef(t: Type, seen = new Set<Type>()): boolean {
  if (typeof t === "string" || seen.has(t)) return false;
  seen.add(t);
  const holds = (u: Type) => holdsRef(u, seen);
  if (t.kind === "ref" || (t.kind === "dyn" && borrowing.has(t.of))) return true;
  // A type parameter holds references when what it stands for, or its bound, does.
  if (t.kind === "param") return t.concrete ? holds(t.concrete) : t.bound !== undefined && holds(t.bound);
  if (t.kind === "union") return t.members.some(holds);
  if (t.kind === "recursive") return holds(t.of);
  if (t.kind === "array" || t.kind === "fixed") return holds(t.element);
  if (t.kind === "map") return holds(t.value);
  if (t.kind === "variant") return t.fields.some((f) => holds(f.type));
  if (t.kind === "class") return t.fields.some((f) => holds(f.type)) || (t.base !== undefined && holds(t.base));
  // A generator borrows what its parameters do; its frame's own references point into itself.
  if (t.kind === "generator" || t.kind === "future") return t.params.some((f) => holds(f.type));
  return (t.kind === "object" || t.kind === "closure") && t.fields.some((f) => holds(f.type));
}

// Whether a value has a part `found` picks anywhere in it, or with `throughRefs` also behind a
// reference it holds. What a `shared` holds isn't its own part: copies of it are the same value.
export function holdsPart(t: Type, found: (t: Type) => boolean, throughRefs = false, seen = new Set<Type>()): boolean {
  const holds = (u: Type) => holdsPart(u, found, throughRefs, seen);
  if (found(t)) return true;
  if (typeof t === "string") return false;
  // A type that holds itself, through an array of itself, is looked into once.
  if (seen.has(t)) return false;
  seen.add(t);
  if (t.kind === "ref") return throughRefs && holds(t.to);
  if (t.kind === "param") return t.concrete !== undefined && holds(t.concrete);
  if (t.kind === "union") return t.members.some(holds);
  if (t.kind === "array" || t.kind === "fixed") return holds(t.element);
  if (t.kind === "map") return holds(t.key) || holds(t.value);
  if (t.kind === "interior" || t.kind === "recursive") return holds(t.of);
  if (t.kind === "class") return t.fields.some((f) => holds(f.type)) || (t.base !== undefined && holds(t.base));
  if (t.kind === "generator" || t.kind === "future") return [...t.params, ...t.frame].some((f) => holds(f.type));
  return (t.kind === "object" || t.kind === "closure" || t.kind === "variant") && t.fields.some((f) => holds(f.type));
}

// Whether a value owns a JoinHandle, or with `throughRefs` borrows one: only one place may
// await a task's result.
export const holdsHandle = (t: Type, throughRefs = false) => holdsPart(t, (u) => typeof u !== "string" && u.kind === "handle", throughRefs);

export const INTERIORS = new Set(["Atomic", "Lock", "Cell"]);

// The signatures of callbacks that run while a lock is held, so their bodies can't await; and
// of those changing a shared value, whose interior-mutable parts others borrow unlocked.
export const lockCallbacks = new WeakSet<FunctionType>();
export const sharedCallbacks = new WeakSet<FunctionType>();

// Whether a value changes in place behind a shared reference: it holds an Atomic, a Lock, a
// shared value, or a Dyn, whose hidden value may hold them. Readers of a shared value borrow
// such fields without its lock.
export const interiorMutable = (t: Type) => holdsPart(t, (u) => typeof u !== "string" && (u.kind === "shared" || u.kind === "dyn" || (u.kind === "interior" && u.which !== "Cell") || (u.kind === "block" && u.which !== "Permit")));

// The first Atomic, Lock or Cell a value holds, if any.
export function holdsInterior(t: Type): InteriorType | undefined {
  let found: InteriorType | undefined;
  holdsPart(t, (u) => typeof u !== "string" && u.kind === "interior" && (found = u) !== undefined);
  return found;
}

// A type parameter as an instance sees it: standing for `concrete`, which has no type
// parameter in it.
export function wrapped(name: string, bound: Bound | undefined, concrete: Type): ParamType {
  const key = `param ${name} ${bound ? keyOf(bound) : ""} as ${keyOf(concrete)}`;
  let t = wrappers.get(key);
  if (!t) {
    t = { kind: "param", name, bound, fields: bound?.fields ?? [], concrete };
    wrappers.set(key, t);
    keys.set(t, key);
  }
  return t;
}

const wrappers = new Map<string, ParamType>();

// A type with each instance's type parameter replaced by the concrete type it stands for. A
// generic class made from one becomes the class made from what it stands for.
export function lower(t: Type): Type {
  // A generic interface made from type parameters is the one made from what they stand for.
  if (typeof t !== "string" && t.kind === "interface" && t.generic?.args.some((a) => lower(a) !== a)) return instanceInterface(t, t.generic.args.map(lower));
  if (typeof t !== "string" && t.kind === "dyn" && t.of.generic?.args.some((a) => lower(a) !== a)) return dynType(lower(t.of) as InterfaceType);
  if (typeof t === "string" || t.kind === "literal" || t.kind === "interface" || t.kind === "closure" || t.kind === "function" || t.kind === "generator" || t.kind === "future" || t.kind === "dyn" || t.kind === "regex") return t;
  if (t.kind === "param") return t.concrete ? lower(t.concrete) : t;
  if (t.kind === "pattern") return "string";
  if (t.kind === "pointer") return pointerType(lower(t.to), t.mutable);
  if (t.kind === "handle") return handleType(lower(t.gives), t.throws && lower(t.throws));
  if (t.kind === "interior") return interiorType(t.which, lower(t.of));
  if (t.kind === "shared") return sharedType(lower(t.of));
  if (t.kind === "block") return blockType(t.which, lower(t.of));
  if (t.kind === "map") return mapType(lower(t.key), lower(t.value), t.set);
  if (t.kind === "recursive") return t.args.some((a) => lower(a) !== a) ? remade(t, () => lower(t.of), t.args.map(lower)) : t;
  // A type holding itself through an array is remade from its type arguments.
  const tied = ties.get(t);
  if (tied && heldBlocks.get(t) !== tied) return tied.args.some((a) => lower(a) !== a) ? instanceRecursive(tied, tied.args.map(lower)).of : t;
  const loop = members.get(t);
  if (loop && !loop.args.some((a) => lower(a) !== a)) return t;
  let found = lowered.get(t);
  if (!found) {
    if (t.kind === "class") found = t.generic?.args.some((a) => lower(a) !== a) ? instanceClass(t, t.generic.args.map(lower)) : t;
    else if (t.kind === "ref") found = refType(lower(t.to), t.mutable, t.life);
    else if (t.kind === "array") found = arrayType(lower(t.element));
    else if (t.kind === "fixed") found = fixedType(lower(t.element), t.size);
    else if (t.kind === "variant") found = t.args.some((a) => lower(a) !== a) ? instanceVariant(t, t.args.map(lower)) : t;
    else if (t.kind === "object" && t.match) found = t;
    else if (t.kind === "object" && t.tuple) found = retuple(t, lower);
    else found = t.kind === "union" ? unionType(t.members.map(lower), t.name) : objectType(t.fields.map(({ optional: _, ...f }) => ({ ...f, type: lower(f.type) })));
    lowered.set(t, found);
  }
  return found;
}

const lowered = new WeakMap<ObjectType | UnionType | ClassType | RefType | ArrayType | FixedType | VariantType, Type>();

// A type with some of its parts swapped for others, looking inside objects and unions.
export function replaced(t: Type, swap: Map<Type, Type>): Type {
  const found = swap.get(t);
  if (found) return found;
  if (typeof t !== "string" && t.kind === "class") {
    const args = t.generic?.args.map((a) => replaced(a, swap));
    return args && args.some((a, i) => a !== t.generic!.args[i]) ? instanceClass(t, args) : t;
  }
  if (typeof t !== "string" && t.kind === "ref") return refType(replaced(t.to, swap), t.mutable, t.life);
  if (typeof t !== "string" && t.kind === "interface" && t.generic) {
    const args = t.generic.args.map((a) => replaced(a, swap));
    return args.some((a, i) => a !== t.generic!.args[i]) ? instanceInterface(t, args) : t;
  }
  if (typeof t !== "string" && t.kind === "function") {
    const params = t.params.map((p) => replaced(p, swap));
    const returns = replaced(t.returns, swap);
    if (!params.some((p, i) => p !== t.params[i]) && returns === t.returns) return t;
    const made = functionType(t.names, params, returns);
    // A generic one stays generic, the types around it it was written among replaced too.
    if (t.generic) {
      made.name = `<${t.generic.names.join(", ")}>${made.name}`;
      made.generic = { ...t.generic, scope: new Map([...t.generic.scope].map(([n, x]) => [n, replaced(x, swap)])) };
    }
    return made;
  }
  if (typeof t !== "string" && t.kind === "array") return arrayType(replaced(t.element, swap));
  if (typeof t !== "string" && t.kind === "fixed") return fixedType(replaced(t.element, swap), t.size);
  if (typeof t !== "string" && t.kind === "map") return mapType(replaced(t.key, swap), replaced(t.value, swap), t.set);
  if (typeof t !== "string" && t.kind === "variant") {
    const args = t.args.map((a) => replaced(a, swap));
    return args.some((a, i) => a !== t.args[i]) ? instanceVariant(t, args) : t;
  }
  const tied = typeof t !== "string" ? ties.get(t) : undefined;
  if (tied && heldBlocks.get(t as UnionType) !== tied) {
    const args = tied.args.map((a) => replaced(a, swap));
    return args.some((a, i) => a !== tied.args[i]) ? instanceRecursive(tied, args).of : t;
  }
  if (typeof t !== "string" && t.kind === "recursive") {
    const args = t.args.map((a) => replaced(a, swap));
    return args.some((a, i) => a !== t.args[i]) ? remade(t, () => replaced(t.of, swap), args) : t;
  }
  if (typeof t === "string" || (t.kind !== "object" && t.kind !== "union")) return t;
  if (t.kind === "object" && t.match) return t;
  if (t.kind === "object" && t.tuple) return retuple(t, (e) => replaced(e, swap));
  return t.kind === "union" ? unionType(t.members.map((m) => replaced(m, swap)), t.name) : objectType(t.fields.map((f) => ({ ...f, type: replaced(f.type, swap) })));
}

// The class a generic class's type arguments make, which only the checker can declare.
let instanceClass = (c: ClassType, _args: Type[]): ClassType => c;
export function lowersClasses(f: typeof instanceClass) {
  instanceClass = f;
}

// The same variant of a generic enum made with other type arguments, which only the checker
// can make.
let instanceVariant = (v: VariantType, _args: Type[]): VariantType => v;
let instanceInterface = (t: InterfaceType, _args: Type[]): InterfaceType => t;
export function lowersInterfaces(f: typeof instanceInterface) {
  instanceInterface = f;
}
export function lowersVariants(f: typeof instanceVariant) {
  instanceVariant = f;
}

// A string that is the same exactly when two types are, for keying instances.
export function keyOf(t: Type): string {
  return typeof t === "string" ? t : `{${keys.get(t)}}`;
}

// `[A, B]`: laid out as an object of fields `0` and `1`, but a type of its own.
export function tupleType(elements: Type[], required = elements.length, rest?: Type): ObjectType {
  const key = `tuple ${elements.map(keyOf).join(",")}${required < elements.length ? `?${required}` : ""}${rest === undefined ? "" : `...${keyOf(rest)}`}`;
  let t = interned.get(key);
  if (!t) {
    const fields: Field[] = elements.map((type, i) => ({ name: String(i), type }));
    if (rest !== undefined) fields.push({ name: "...", type: arrayType(rest) });
    t = { kind: "object", fields: objectType(fields).fields, tuple: true };
    if (required < elements.length) t.required = required;
    if (rest !== undefined) t.rest = rest;
    interned.set(key, t);
    keys.set(t, key);
  }
  return t;
}

// The same tuple shape over elements mapped by `f`.
export const retuple = (t: ObjectType, f: (e: Type) => Type): ObjectType => tupleType(elementsOf(t).map(f), t.required, t.rest === undefined ? undefined : f(t.rest));

// A tuple's element types, in order.
export function elementsOf(t: ObjectType): Type[] {
  return t.fields.filter((f) => /^\d+$/.test(f.name)).toSorted((a, b) => Number(a.name) - Number(b.name)).map((f) => f.type);
}

// What `re.exec(s)` gives when it matches: the whole match and each capture, a capture that
// may not take part being `string | null`, then where the match starts, the string matched, and,
// when the pattern names groups, an object of them.
export function matchType(t: RegexType): ObjectType {
  const key = `match ${keys.get(t)}`;
  let found = interned.get(key);
  if (!found) {
    const maybe = unionType(["string", "null"]);
    const names = [...new Set(t.captures.flatMap((c) => (c.name === undefined ? [] : [c.name])))];
    // A name shared by groups in different alternatives holds whichever took part.
    const named = names.map((name) => {
      const groups = t.captures.filter((c) => c.name === name);
      return { name, type: groups.length === 1 && !groups[0]!.optional ? "string" as Type : maybe };
    });
    const fields: Field[] = [
      { name: "0", type: "string" },
      ...t.captures.map((c, i) => ({ name: String(i + 1), type: c.optional ? maybe : "string" as Type })),
      { name: "index", type: "i64" },
      { name: "input", type: "string" },
      ...(named.length > 0 ? [{ name: "groups", type: objectType(named) as Type }] : []),
    ];
    found = { kind: "object", fields: objectType(fields).fields, tuple: true, match: true };
    interned.set(key, found);
    keys.set(found, key);
  }
  return found;
}

// Why a generic function type can't be held where it is: as `where` it would be boxed, and a box
// holds one function, where a generic one is a family made one per call.
export function familyHeld(where: string): string {
  return `${where} can't hold a generic function type: that would box it in a Dyn, whose table holds one function, and a generic function is a family made one per call; give it one type, as '(x: i64) => i64', or take it as a parameter`;
}

export const isTuple = (t: Type): boolean => typeof t !== "string" && t.kind === "object" && t.tuple === true;

export function objectType(fields: Field[]): ObjectType {
  const sorted = fields.toSorted((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  // A nested key is braced, so `{ a: { x }; y }` and `{ a: { x; y } }` get different keys.
  const key = sorted.map((f) => `${f.readonly ? "readonly " : ""}${JSON.stringify(f.name)}${f.optional ? `?${f.optional}` : ""}:${keyOf(f.type)}`).join(",");
  let t = interned.get(key);
  if (!t) {
    t = { kind: "object", fields: sorted };
    interned.set(key, t);
    keys.set(t, key);
  }
  return t;
}

// A field of an object, or of an instance or the bases it embeds.
export function field(t: Exclude<Type, string>, name: string): Field | undefined {
  const own = t.fields.find((f) => f.name === name);
  return own ?? (t.kind === "class" && t.base ? field(t.base, name) : undefined);
}

// The indices that reach a field inside a value of `t`, through any embedded bases.
export function fieldPath(t: ObjectType | ClassType, name: string): number[] {
  const embeds = t.kind === "class" && t.base;
  const i = t.fields.findIndex((f) => f.name === name);
  if (i >= 0) return [i + (embeds ? 1 : 0)];
  return [0, ...fieldPath((t as ClassType).base!, name)];
}

// A key that is the same exactly when two types' values have one shape: like `keyOf`, but
// blind to which fields are marked optional, so `{ a?: T }` and `{ a: T | null }` share one.
export function shapeKey(t: Type): string {
  if (typeof t === "string") return t;
  if (ties.has(t)) return keyOf(t);
  let found = shapeKeys.get(t);
  if (found === undefined) {
    if (t.kind === "object" && t.tuple) found = `[${elementsOf(t).map(shapeKey).join(",")}${t.required === undefined ? "" : `?${t.required}`}${t.rest === undefined ? "" : `...${shapeKey(t.rest)}`}]`;
    else if (t.kind === "object") found = `{${t.fields.map((f) => `${f.readonly ? "readonly " : ""}${JSON.stringify(f.name)}:${shapeKey(f.type)}`).join(",")}}`;
    else if (t.kind === "array") found = `${shapeKey(t.element)}[]`;
    else if (t.kind === "fixed") found = `FixedArray<${shapeKey(t.element)},${t.size}>`;
    else if (t.kind === "map") found = t.set ? `Set<${shapeKey(t.key)}>` : `Map<${shapeKey(t.key)},${shapeKey(t.value)}>`;
    else if (t.kind === "union") found = `(${t.members.map(shapeKey).join("|")})`;
    else if (t.kind === "ref") found = `${t.mutable ? "mut" : "ref"} ${shapeKey(t.to)}${t.life ? ` ${t.life}` : ""}`;
    // A type parameter standing for a concrete type has that type's shape.
    else if (t.kind === "param" && t.concrete) return shapeKey(t.concrete);
    else if (t.kind === "class" && t.generic) found = `${t.generic.name}<${t.generic.args.map(shapeKey).join(",")}>`;
    else found = keyOf(t);
    shapeKeys.set(t, found);
  }
  return found;
}
const shapeKeys = new WeakMap<Exclude<Type, string>, string>();

// A type without the empty value an optional field adds.
export function withoutNull(t: Type): Type {
  return typeof t !== "string" && t.kind === "union" ? unionType(t.members.filter((m) => m !== "null")) : t;
}

// A field written `name?: T`: its type holds the empty value, and it remembers whether `?` added it.
export function optionalField(name: string, written: Type): Field {
  const held = written === "null" || (typeof written !== "string" && written.kind === "union" && written.members.includes("null"));
  return { name, type: held ? written : unionType([written, "null"]), optional: held ? "held" : "added" };
}

// Every field of an instance: its bases' first, then its own.
export function allFields(t: ClassType): Field[] {
  return [...(t.base ? allFields(t.base) : []), ...t.fields];
}

// Whether `t` embeds `base`, directly or through another base.
export function derives(t: ClassType, base: ClassType): boolean {
  return t.base !== undefined && (t.base === base || derives(t.base, base));
}

// Whether a value of `from` fits where `to` is declared: the same type, or an object or
// instance with at least the fields of the object type `to`, each fitting in turn.
const assumed = new Set<string>();

export function fits(from: Type, to: Type): boolean {
  // A string literal fits a pattern it matches; a pattern is a string. Both are strings once
  // lowered, so this comes first.
  const target = typeof to !== "string" && to.kind === "param" && to.concrete ? to.concrete : to;
  if (from !== target && typeof target !== "string" && target.kind === "pattern") {
    if (typeof from !== "string" && from.kind === "union") return from.members.every((m) => fits(m, target));
    return typeof from !== "string" && from.kind === "literal" && typeof from.value === "string" && !from.owner && textFits(from.value, target);
  }
  // In an instance, a type parameter and the concrete type it stands for are one value.
  if (from === to || sameLowered(from, to) || from === "never" || sameCallable(from, to)) return true;
  // A future fits the `Promise<T>` describing it, as an async function's result.
  if (typeof to !== "string" && to.kind === "interface" && promised.has(to) && typeof from !== "string" && from.kind === "future") return !from.throws && lower(from.gives) === lower(promised.get(to)!);
  // A reference reads the value where it lives, so it fits only a reference to the same type;
  // a mutable one also lends itself as shared. Lifetimes are checked on their own.
  // A reference into a recursive type's block is one to the type it stands for.
  if (typeof to !== "string" && to.kind === "ref") {
    return typeof from !== "string" && from.kind === "ref" && (from.mutable || !to.mutable) && lower(unfold(from.to)) === lower(to.to);
  }
  // Any regex is a \`RegExp\`; all of them are the same pointer to a program.
  if (to === ANY_REGEX) return typeof from !== "string" && (from.kind === "regex" || (from.kind === "param" && from.bound?.kind === "regex"));
  // A `MutPtr<T>` may be used as a `Ptr<T>`, as Rust's `*mut T` coerces to `*const T`.
  if (typeof to !== "string" && to.kind === "pointer") {
    return typeof from !== "string" && from.kind === "pointer" && (from.mutable || !to.mutable) && lower(from.to) === lower(to.to);
  }
  // A recursive type is the type it stands for. Its type holds it again, so a pair being
  // compared is taken to fit while its parts are.
  // A union holding the recursive type itself takes it as it is.
  const held = typeof to !== "string" && to.kind === "union" && to.members.includes(from);
  if (!held && ((typeof from !== "string" && from.kind === "recursive") || (typeof to !== "string" && to.kind === "recursive"))) {
    const pair = `${keyOf(from)} ${keyOf(to)}`;
    if (assumed.has(pair)) return true;
    assumed.add(pair);
    try {
      return fits(unfold(from), unfold(to));
    } finally {
      assumed.delete(pair);
    }
  }
  if (typeof to !== "string" && to.kind === "union") {
    if (typeof from !== "string" && from.kind === "union") return from.members.every((m) => fits(m, to));
    return to.members.some((m) => fits(from, m));
  }
  // A union fits where every member it may hold does, as an enum fits an i64.
  if (typeof from !== "string" && from.kind === "union") return from.members.every((m) => fits(m, to));
  if (typeof from !== "string" && from.kind === "pattern") return to === "string";
  if (typeof from !== "string" && from.kind === "literal") return baseOf(from) === to;
  // A closure fits a function type taking the same parameters, or the first of them, and
  // returning what it returns, or anything when it returns nothing.
  // A parameter of a function type fits through its signature.
  if (typeof to !== "string" && to.kind === "function") {
    const given = typeof from !== "string" && from.kind === "param" && from.bound?.kind === "function" ? from.concrete ?? from.bound : from;
    // A stored callable fits by the function type it was written as.
    const callable = typeof given !== "string" && given.kind === "dyn" && callableOf.has(given.of);
    const sig = callable ? callableOf.get(given.of)! : given;
    // A stored callable's call passes all its parameters, so it takes exactly as many.
    if (callable && typeof sig !== "string" && sig.kind === "function" && sig.params.length !== to.params.length) return false;
    return typeof sig !== "string" && (sig.kind === "closure" || sig.kind === "function") && sig.params.length <= to.params.length
      && sig.params.every((p, i) => lower(p) === lower(to.params[i]!)) && (to.returns === "void" || fits(sig.returns, to.returns));
  }
  if (typeof from !== "string" && from.kind === "ref") return false;
  // A tuple fits only a tuple of its length, element by element.
  if (isTuple(from) || isTuple(to)) {
    const [a, b] = [from as ObjectType, to as ObjectType];
    // A tuple fits one of its shape, giving at least the elements that one requires.
    const shaped = isTuple(from) && isTuple(to) && a.fields.length === b.fields.length && (a.rest === undefined) === (b.rest === undefined);
    return shaped && (a.required ?? a.fields.length) >= (b.required ?? b.fields.length) && b.fields.every((f) => fits(field(a, f.name)!.type, f.type));
  }
  // An interface is satisfied by members, which only the checker can look up.
  if (typeof from === "string" || typeof to === "string" || to.kind !== "object" || from.kind === "interface") return false;
  // A type parameter fits through its bound's fields, as any instance of it would.
  // A value may leave out a field whose type is an Option.
  return to.fields.every((f) => {
    const found = field(from, f.name);
    if (!found) return isOption(f.type);
    return (found.access ?? "public") === "public" && fits(found.type, f.type);
  });
}

// A field, by its path, that a value of `from` holds read-only but `to` lets be written: lent
// mutably as a `to`, it could be changed. A readonly field only fits a writable one by copy.
export function unlocks(from: Type, to: Type, path = ""): string | undefined {
  from = lower(from);
  if (typeof from === "string" || typeof to === "string" || (to.kind !== "object" && to.kind !== "interface")) return undefined;
  for (const f of to.fields) {
    const found = field(from, f.name);
    if (!found) continue;
    if (found.readonly && !f.readonly) return `${path}${f.name}`;
    const deeper = unlocks(found.type, f.type, `${path}${f.name}.`);
    if (deeper) return deeper;
  }
  return undefined;
}

// How a type reads in a diagnostic, as TypeScript would print it.
export function show(t: Type): string {
  if (t === "f64") return "number";
  if (typeof t === "string") return t;
  // A type holding itself is shown by its name.
  const tied = ties.get(t);
  if (tied) return tied.name;
  if (t.kind === "literal" && t.owner) return `${t.owner.enum}.${t.owner.member}`;
  if (t.kind === "literal") return typeof t.value === "string" ? JSON.stringify(t.value) : String(t.value);
  if (t.kind === "pattern") {
    const text = (q: string) => q.replaceAll("\\", "\\\\").replaceAll("`", "\\`").replaceAll("${", "\\${");
    return `\`${t.quasis.map((q, i) => (i === 0 ? text(q) : `\${${show(t.holes[i - 1]!)}}${text(q)}`)).join("")}\``;
  }
  if (t.kind === "union") return t.name ?? t.members.map(show).join(" | ");
  if (t.kind === "ref") return `${t.mutable ? "Mut" : "Ref"}<${show(t.to)}>`;
  if (t.kind === "pointer") return `${t.mutable ? "MutPtr" : "Ptr"}<${show(t.to)}>`;
  if (t.kind === "regex") return "RegExp";
  if (t.kind === "array") {
    const e = t.element;
    const wrap = typeof e !== "string" && ((e.kind === "union" && !e.name) || e.kind === "function" || e.kind === "closure" || (e.kind === "dyn" && callableOf.has(e.of)));
    return wrap ? `(${show(e)})[]` : `${show(e)}[]`;
  }
  if (t.kind === "fixed") return `FixedArray<${show(t.element)}, ${t.size}>`;
  if (t.kind === "map") return t.set ? `Set<${show(t.key)}>` : `Map<${show(t.key)}, ${show(t.value)}>`;
  if (t.kind === "generator") return `Generator<${show(t.yields)}>`;
  if (t.kind === "future") return `Promise<${show(t.gives)}>${t.throws ? ` throws ${show(t.throws)}` : ""}`;
  if (t.kind === "interior") return `${t.which}<${show(t.of)}>`;
  if (t.kind === "shared") return `shared<${show(t.of)}>`;
  if (t.kind === "block") return t.which === "Channel" ? `Channel<${show(t.of)}>` : t.which;
  if (t.kind === "dyn") return callableOf.has(t.of) || promised.has(t.of) ? t.of.name : `Dyn<${t.of.name}>`;
  if (t.kind === "handle") return `JoinHandle<${show(t.gives)}>${t.throws ? ` throws ${show(t.throws)}` : ""}`;
  if (t.kind !== "object") return t.name;
  if (t.match) return "RegExpExecArray";
  if (t.tuple) return `[${[...elementsOf(t).map((e, i) => (i < (t.required ?? Infinity) ? show(e) : `${show(withoutNull(e))}?`)), ...(t.rest === undefined ? [] : [`...${show(arrayType(t.rest))}`])].join(", ")}]`;
  if (t.fields.length === 0) return "{}";
  const name = (n: string) => (/^[A-Za-z_$][\w$]*$/.test(n) ? n : JSON.stringify(n));
  return `{ ${t.fields.map((f) => `${f.readonly ? "readonly " : ""}${name(f.name)}${f.optional && f.optional !== "undefined" ? "?" : ""}: ${show(f.optional === "added" ? withoutNull(f.type) : f.type)}`).join("; ")} }`;
}
