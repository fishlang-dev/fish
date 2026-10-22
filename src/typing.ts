// The checker's types. Object types are interned, so two types are structurally identical,
// the same fields with the same types in any order, exactly when they are the same object.

// A class member that isn't public is reachable only from inside its class, and never
// counts toward a structural fit, as in TypeScript.
export type Access = "public" | "private" | "protected";

// A readonly field can't be written after construction, at any depth.
export type Field = { name: string; type: Type; access?: Access; readonly?: boolean };

// Fields are sorted by name, which is also their order in memory.
export type ObjectType = { kind: "object"; fields: Field[] };

// A class is nominal: one object per declaration, so `===` is identity. Its own fields are in
// declaration order, filled in once resolved, and follow the base it embeds in memory.
// An instance of a generic class also records the class it came from and its type arguments.
export type ClassType = { kind: "class"; name: string; fields: Field[]; base?: ClassType; generic?: { name: string; args: Type[] } };

// An interface is a trait: fields and method signatures that any value with those members
// satisfies. It describes values but is never one, so it never reaches codegen. Its members
// are filled in once resolved.
export type Method = { name: string; params: Type[]; returns: Type };
export type InterfaceType = { kind: "interface"; name: string; fields: Field[]; methods: Method[] };

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

// A closure: an arrow function and what it captures. Each arrow, in each instance of the body
// it is written in, is its own type, so `===` is identity. Its value is its captures, laid out
// as its fields, which are never read by name.
// A closure that moves a captured value out of itself can run only once; `once` names one. A
// closure made in a generic body's definition check is never compiled, so it isn't concrete.
export type ClosureType = { kind: "closure"; name: string; params: Type[]; returns: Type; fields: Field[]; once?: string; concrete: boolean };

// A function type: the signature a closure must have to be passed where it is declared. Like an
// interface, it describes values without being one, so it never reaches codegen.
export type FunctionType = { kind: "function"; name: string; params: Type[]; returns: Type; fields: Field[] };

// What a type parameter may be bounded by.
export type Bound = ObjectType | InterfaceType | FunctionType;

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
export type Type = Numeric | "boolean" | "void" | "null" | "never" | "string" | ObjectType | ClassType | InterfaceType | ParamType | LiteralType | UnionType | RefType | ClosureType | FunctionType | ArrayType | VariantType | GeneratorType | PointerType | FutureType | HandleType | InteriorType | SharedType | BlockType | DynType;

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

// `Semaphore`, its `Permit` and `Channel<T>`: each a pointer to a counted block in the runtime,
// which tasks wait on without holding a thread. A Permit holds a count on its Semaphore. An
// `AbortController` and its `AbortSignal`s are handles to one block.
export type BlockType = { kind: "block"; which: "Semaphore" | "Permit" | "Channel" | "AbortController" | "AbortSignal"; of: Type; fields: Field[] };

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
export type Leaf = "acquire" | "send" | "receive" | "sleep";
const leaves = new Map<string, FutureType>();
export const leafOf = new WeakMap<FutureType, { method: Leaf; of: Type; signal: boolean }>();

export function leafFuture(method: Leaf, of: Type, abort?: Type): FutureType {
  const key = `${method} ${keyOf(of)} ${abort ? keyOf(abort) : ""}`;
  let t = leaves.get(key);
  if (!t) {
    const target: Type = method === "sleep" ? "i64" : blockType(method === "acquire" ? "Semaphore" : "Channel", method === "acquire" ? "void" : of);
    const frame: Field[] = [{ name: "state", type: "i32" }, { name: "block", type: target }, ...(method === "send" ? [{ name: "value", type: of }] : [])];
    if (abort) frame.push({ name: "signal", type: blockType("AbortSignal") }, { name: "waiting", type: "i32" });
    const gives = method === "acquire" ? blockType("Permit") : method === "receive" ? unionType([of, "null"]) : "void";
    t = { kind: "future", name: method, gives, throws: abort, fields: [], params: [], frame, concrete: true };
    leaves.set(key, t);
    leafOf.set(t, { method, of, signal: abort !== undefined });
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

// What a `Promise<T>` gives, when the interface is one.
export function promiseElement(t: Type): Type | undefined {
  return typeof t !== "string" && t.kind === "interface" ? promised.get(t) : undefined;
}

// A raw pointer, `Ptr<T>` or `MutPtr<T>`: an address the borrow checker doesn't follow, used
// only inside `unsafe`. It copies like a number and owns nothing.
export type PointerType = { kind: "pointer"; to: Type; mutable: boolean; fields: Field[] };

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
  const t: FunctionType = { kind: "function", name: `(${params.map((p, i) => `${names[i]}: ${show(p)}`).join(", ")}) => ${show(returns)}`, params, returns, fields: [] };
  keys.set(t, `function ${declared++}`);
  return t;
}

export function closureType(names: string[], params: Type[], returns: Type, fields: Field[], once: string | undefined, concrete: boolean): ClosureType {
  const t: ClosureType = { kind: "closure", name: `(${params.map((p, i) => `${names[i]}: ${show(p)}`).join(", ")}) => ${show(returns)}`, params, returns, fields, once, concrete };
  keys.set(t, `closure ${declared++}`);
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

// Members are flattened, deduplicated and kept in one order, so equal unions are one type,
// and a literal whose base type is also a member adds nothing. A single member is itself.
// An enum's union carries the enum's name, for messages.
export function unionType(parts: Type[], name?: string): Type {
  const flat = parts.flatMap((p) => (typeof p !== "string" && p.kind === "union" ? p.members : [p])).filter((p, _, all) => p !== "never" || all.every((q) => q === "never"));
  const members = [...new Set(flat)]
    .filter((t) => typeof t === "string" || t.kind !== "literal" || !flat.includes(baseOf(t)!))
    .toSorted((a, b) => (keyOf(a) < keyOf(b) ? -1 : keyOf(a) > keyOf(b) ? 1 : 0));
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
export function isCopy(t: Type): boolean {
  if (typeof t === "string" || t.kind === "literal" || t.kind === "ref" || t.kind === "pointer") return true;
  // A closure copies when what it captures does, and it changes nothing through it.
  if (t.kind === "closure") return t.fields.every((f) => isCopy(f.type) && !holdsMut(f.type));
  return t.kind === "union" && t.members.every(isCopy);
}

// Whether a value of `t` holds a mutable reference anywhere, which a copy would alias.
export function holdsMut(t: Type): boolean {
  if (typeof t === "string") return false;
  if (t.kind === "ref") return t.mutable;
  if (t.kind === "param") return t.concrete ? holdsMut(t.concrete) : t.bound !== undefined && holdsMut(t.bound);
  if (t.kind === "union") return t.members.some(holdsMut);
  if (t.kind === "array") return holdsMut(t.element);
  if (t.kind === "variant") return t.fields.some((f) => holdsMut(f.type));
  if (t.kind === "class") return t.fields.some((f) => holdsMut(f.type)) || (t.base !== undefined && holdsMut(t.base));
  if (t.kind === "generator" || t.kind === "future") return t.params.some((f) => holdsMut(f.type));
  return (t.kind === "object" || t.kind === "closure") && t.fields.some((f) => holdsMut(f.type));
}

// Whether a value of `t` holds a reference anywhere, which only lifetimes could keep valid.
export function holdsRef(t: Type): boolean {
  if (typeof t === "string") return false;
  if (t.kind === "ref") return true;
  // A type parameter holds references when what it stands for, or its bound, does.
  if (t.kind === "param") return t.concrete ? holdsRef(t.concrete) : t.bound !== undefined && holdsRef(t.bound);
  if (t.kind === "union") return t.members.some(holdsRef);
  if (t.kind === "array") return holdsRef(t.element);
  if (t.kind === "variant") return t.fields.some((f) => holdsRef(f.type));
  if (t.kind === "class") return t.fields.some((f) => holdsRef(f.type)) || (t.base !== undefined && holdsRef(t.base));
  // A generator borrows what its parameters do; its frame's own references point into itself.
  if (t.kind === "generator" || t.kind === "future") return t.params.some((f) => holdsRef(f.type));
  return (t.kind === "object" || t.kind === "closure") && t.fields.some((f) => holdsRef(f.type));
}

// Whether a value has a part `found` picks anywhere in it, or with `throughRefs` also behind a
// reference it holds. What a `shared` holds isn't its own part: copies of it are the same value.
export function holdsPart(t: Type, found: (t: Type) => boolean, throughRefs = false): boolean {
  const holds = (u: Type) => holdsPart(u, found, throughRefs);
  if (found(t)) return true;
  if (typeof t === "string") return false;
  if (t.kind === "ref") return throughRefs && holds(t.to);
  if (t.kind === "param") return t.concrete !== undefined && holds(t.concrete);
  if (t.kind === "union") return t.members.some(holds);
  if (t.kind === "array") return holds(t.element);
  if (t.kind === "interior") return holds(t.of);
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

// Whether a value changes in place behind a shared reference: it holds an Atomic, a Lock or a
// shared value. Readers of a shared value borrow such fields without its lock.
export const interiorMutable = (t: Type) => holdsPart(t, (u) => typeof u !== "string" && (u.kind === "shared" || (u.kind === "interior" && u.which !== "Cell") || (u.kind === "block" && u.which !== "Permit")));

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
  if (typeof t === "string" || t.kind === "literal" || t.kind === "interface" || t.kind === "closure" || t.kind === "function" || t.kind === "generator" || t.kind === "future" || t.kind === "dyn") return t;
  if (t.kind === "param") return t.concrete ?? t;
  if (t.kind === "pointer") return pointerType(lower(t.to), t.mutable);
  if (t.kind === "handle") return handleType(lower(t.gives), t.throws && lower(t.throws));
  if (t.kind === "interior") return interiorType(t.which, lower(t.of));
  if (t.kind === "shared") return sharedType(lower(t.of));
  if (t.kind === "block") return blockType(t.which, lower(t.of));
  let found = lowered.get(t);
  if (!found) {
    if (t.kind === "class") found = t.generic?.args.some((a) => lower(a) !== a) ? instanceClass(t, t.generic.args.map(lower)) : t;
    else if (t.kind === "ref") found = refType(lower(t.to), t.mutable, t.life);
    else if (t.kind === "array") found = arrayType(lower(t.element));
    else if (t.kind === "variant") found = t.args.some((a) => lower(a) !== a) ? instanceVariant(t, t.args.map(lower)) : t;
    else found = t.kind === "union" ? unionType(t.members.map(lower), t.name) : objectType(t.fields.map((f) => ({ ...f, type: lower(f.type) })));
    lowered.set(t, found);
  }
  return found;
}

const lowered = new WeakMap<ObjectType | UnionType | ClassType | RefType | ArrayType | VariantType, Type>();

// A type with some of its parts swapped for others, looking inside objects and unions.
export function replaced(t: Type, swap: Map<Type, Type>): Type {
  const found = swap.get(t);
  if (found) return found;
  if (typeof t !== "string" && t.kind === "class") {
    const args = t.generic?.args.map((a) => replaced(a, swap));
    return args && args.some((a, i) => a !== t.generic!.args[i]) ? instanceClass(t, args) : t;
  }
  if (typeof t !== "string" && t.kind === "ref") return refType(replaced(t.to, swap), t.mutable, t.life);
  if (typeof t !== "string" && t.kind === "array") return arrayType(replaced(t.element, swap));
  if (typeof t !== "string" && t.kind === "variant") {
    const args = t.args.map((a) => replaced(a, swap));
    return args.some((a, i) => a !== t.args[i]) ? instanceVariant(t, args) : t;
  }
  if (typeof t === "string" || (t.kind !== "object" && t.kind !== "union")) return t;
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
export function lowersVariants(f: typeof instanceVariant) {
  instanceVariant = f;
}

// A string that is the same exactly when two types are, for keying instances.
export function keyOf(t: Type): string {
  return typeof t === "string" ? t : `{${keys.get(t)}}`;
}

export function objectType(fields: Field[]): ObjectType {
  const sorted = fields.toSorted((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  // A nested key is braced, so `{ a: { x }; y }` and `{ a: { x; y } }` get different keys.
  const key = sorted.map((f) => `${f.readonly ? "readonly " : ""}${JSON.stringify(f.name)}:${keyOf(f.type)}`).join(",");
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
export function fits(from: Type, to: Type): boolean {
  // In an instance, a type parameter and the concrete type it stands for are one value.
  if (from === to || lower(from) === lower(to) || from === "never") return true;
  // A reference reads the value where it lives, so it fits only a reference to the same type;
  // a mutable one also lends itself as shared. Lifetimes are checked on their own.
  if (typeof to !== "string" && to.kind === "ref") {
    return typeof from !== "string" && from.kind === "ref" && (from.mutable || !to.mutable) && lower(from.to) === lower(to.to);
  }
  // A `MutPtr<T>` may be used as a `Ptr<T>`, as Rust's `*mut T` coerces to `*const T`.
  if (typeof to !== "string" && to.kind === "pointer") {
    return typeof from !== "string" && from.kind === "pointer" && (from.mutable || !to.mutable) && lower(from.to) === lower(to.to);
  }
  if (typeof to !== "string" && to.kind === "union") {
    if (typeof from !== "string" && from.kind === "union") return from.members.every((m) => fits(m, to));
    return to.members.some((m) => fits(from, m));
  }
  // A union fits where every member it may hold does, as an enum fits an i64.
  if (typeof from !== "string" && from.kind === "union") return from.members.every((m) => fits(m, to));
  if (typeof from !== "string" && from.kind === "literal") return baseOf(from) === to;
  // A closure fits a function type taking the same parameters, or the first of them, and
  // returning what it returns, or anything when it returns nothing.
  // A parameter of a function type fits through its signature.
  if (typeof to !== "string" && to.kind === "function") {
    const sig = typeof from !== "string" && from.kind === "param" && from.bound?.kind === "function" ? from.concrete ?? from.bound : from;
    return typeof sig !== "string" && (sig.kind === "closure" || sig.kind === "function") && sig.params.length <= to.params.length
      && sig.params.every((p, i) => lower(p) === lower(to.params[i]!)) && (to.returns === "void" || fits(sig.returns, to.returns));
  }
  if (typeof from !== "string" && from.kind === "ref") return false;
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
  if (t.kind === "literal" && t.owner) return `${t.owner.enum}.${t.owner.member}`;
  if (t.kind === "literal") return typeof t.value === "string" ? JSON.stringify(t.value) : String(t.value);
  if (t.kind === "union") return t.name ?? t.members.map(show).join(" | ");
  if (t.kind === "ref") return `${t.mutable ? "Mut" : "Ref"}<${show(t.to)}>`;
  if (t.kind === "pointer") return `${t.mutable ? "MutPtr" : "Ptr"}<${show(t.to)}>`;
  if (t.kind === "array") {
    const e = t.element;
    const wrap = typeof e !== "string" && ((e.kind === "union" && !e.name) || e.kind === "function" || e.kind === "closure");
    return wrap ? `(${show(e)})[]` : `${show(e)}[]`;
  }
  if (t.kind === "generator") return `Generator<${show(t.yields)}>`;
  if (t.kind === "future") return `Promise<${show(t.gives)}>${t.throws ? ` throws ${show(t.throws)}` : ""}`;
  if (t.kind === "interior") return `${t.which}<${show(t.of)}>`;
  if (t.kind === "shared") return `shared<${show(t.of)}>`;
  if (t.kind === "block") return t.which === "Channel" ? `Channel<${show(t.of)}>` : t.which;
  if (t.kind === "dyn") return `Dyn<${t.of.name}>`;
  if (t.kind === "handle") return `JoinHandle<${show(t.gives)}>${t.throws ? ` throws ${show(t.throws)}` : ""}`;
  if (t.kind !== "object") return t.name;
  if (t.fields.length === 0) return "{}";
  const name = (n: string) => (/^[A-Za-z_$][\w$]*$/.test(n) ? n : JSON.stringify(n));
  return `{ ${t.fields.map((f) => `${f.readonly ? "readonly " : ""}${name(f.name)}: ${show(f.type)}`).join("; ")} }`;
}
