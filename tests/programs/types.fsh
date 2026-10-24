// case: types_advanced
// mode: parse
type Getters<T> = { [K in keyof T as Prefixed<K>]: () => T[K] }
type Mutable<T> = { -readonly [K in keyof T]-?: T[K] }
type Frozen<T> = { +readonly [K in keyof T]+?: T[K]; }
type Unwrap<T> = T extends Promise<infer U> ? Unwrap<U> : T
type First<T> = T extends [infer H extends string, ...infer _] ? H : never
type Remote = import("./remote").Api<string>
type Module = typeof import("./remote")

function main() {
  type Deep<T> =
    T extends object
      ? { [K in keyof T]: Deep<T[K]> }
      : T
}
// case: types_alias
// mode: parse
type Id = i64
type Pair<T extends Base = Default, const U, in V, out W> = Map<T, U>;
type out = A
type Box<out> = out

function first<T, out K extends Key>(items: List<T>): T {
  type Local = Map<string, T>
  let x: Local = 1
}
// case: types_alias_generic_union
// expect: 1 5
// A generic alias may hold its parameter in a union; each use gives it a type.
type Maybe<T> = T | null;
type M = Maybe<i64>;
function main() { const m: M = null; const n: M = 5; console.log(m ?? 1, n ?? 0); }
// case: types_alias_unused_error
// error: cannot find type 'Nope'
// An unused generic alias is still checked past the type functions it can't compute yet.
type Bad<T> = Partial<T> | Nope;
function main() {}
// case: types_conditional
// expect: hi b 3 yes
// expect: 2 c no
// Conditional types, distributed over a union a type parameter stands for, and the std
// Exclude, Extract and NonNullable, computed while compiling.
type NonNull<T> = T extends null ? never : T;
type IsText<T> = T extends string ? "yes" : "no";
type Name = NonNull<string | null>;
type Letters = "a" | "b" | "c";
type NotA = Exclude<Letters, "a">;
type OnlyC = Extract<Letters, "c" | "z">;
type Count = NonNullable<i64 | null>;
type P<T> = Partial<T>;
type Loose = P<{ id: i64; name: string }>;
type Answer = IsText<"hi">;
type Wide = IsText<i64>;
function greet(n: Name): string { return n; }
function main() {
  const b: NotA = "b";
  const c: OnlyC = "c";
  const n: Count = 3;
  const l: Loose = { id: 2 };
  const yes: Answer = "yes";
  const no: Wide = "no";
  console.log(greet("hi"), b, n, yes);
  console.log(l.id ?? 0, c, no);
}
// case: types_conditional_budget
// error: needed more than 20000 alias instances; a type that branches as it recurses grows exponentially
// A conditional type that branches as it recurses grows exponentially, so it is stopped.
type B<T, U> = T extends (infer E)[] ? B<E, { l: U }> | B<E, { r: U }> : U;
type R = B<i64[][][][][][][][][][][][][][][][][][][][], i64>;
function main() {}
// case: types_conditional_deep
// error: is nested more than 64 alias instances deep while being computed
// A conditional type that keeps growing its argument never reaches a stopping branch.
type Grow<T> = T extends string ? Grow<T[]> : Grow<T[]>;
type G = Grow<string>;
function main() {}
// case: types_conditional_extends_alias
// expect: y n
// A generic alias may test a placeholder on the extends side; each use decides it.
type HasNull<T> = null extends T ? "y" : "n";
type A = HasNull<i64 | null>;
type B = HasNull<i64>;
function main() { const a: A = "y"; const b: B = "n"; console.log(a, b); }
// case: types_conditional_extends_param
// error: a conditional type of the type parameter 'T' isn't supported yet
// A type parameter on the extends side would decide the branch once for every instance.
function f<T>(x: T, y: string extends T ? i64 : boolean): i64 { return 1; }
function main() {}
// case: types_conditional_interface
// expect: yes yes yes p
// A conditional type's extends, and Extract, meet an interface by shape, as in TypeScript.
interface Shape { area(): i64; }
interface Named { name: string; }
class Sq implements Shape { s: i64; constructor(s: i64) { this.s = s; } area(): i64 { return this.s * this.s; } }
class Person { name: string = "p"; }
type Is<T, U> = T extends U ? "yes" : "no";
type OnlyNamed = Extract<Person | Rock, Named>;
class Rock { weight: i64 = 1; }
function main() {
  const a: Is<Sq, Shape> = "yes";
  const b: Is<Person, Named> = "yes";
  const c: Is<{ name: string; age: i64 }, Named> = "yes";
  const p: OnlyNamed = new Person();
  console.log(a, b, c, p.name);
}
// case: types_conditional_param
// error: a conditional type of the type parameter 'T' isn't supported yet
// Inside generic function code, a conditional over the function's own type parameter can't be
// computed, since T is only known per instance.
function first<T>(x: T extends null ? never : T): i64 { return 1; }
function main() {}
// case: types_exclude_refused
// error: type '"a"' is not assignable to type '"b" | "c"'
// Exclude removes the members that fit, so the one it removed is refused.
type NotA = Exclude<"a" | "b" | "c", "a">;
function main() { const x: NotA = "a"; }
// case: types_functions
// mode: parse
type Callback = (error: Error | null, value?: string) => void
type Factory = new (...args: unknown[]) => Widget
type Abstract = abstract new () => object
type Identity = <T>(x: T) => T
type Handler = (this: Window, event: Event) => boolean
type Guard = (x: unknown) => x is string
type Assert = (x: unknown) => asserts x is string
type Truthy = (x: unknown) => asserts x
type Curried = (a: i64) => (b: i64) => i64
type Is = is

function isNode(x: unknown): x is Node {}
function assertNode(x: unknown): asserts x is Node {}
function check(this: Context, value?: i64, ...rest: i64[]): this is Ready {}
function parse(): asserts {}
// case: types_indexed_array
// error: an array type is indexed by 'number', which gives its element type, here 'string'
type Tags = string[];
type First = Tags[0];
function main() {}
// case: types_indexed_missing
// error: 'age' isn't a field of '{ id: i64; name: string }'
// An indexed access type names a field the type has.
type User = { id: i64; name: string };
type Age = User["age"];
function main() {}
// case: types_infer
// expect: 3 hi 7 ann
// expect: 5 ok 2 none
// `infer` names a type matched out of an array, a function, a promise, a generic class, an
// object field or an Option, and the std ReturnType and Awaited.
class Box<T> { v: T; constructor(v: T) { this.v = v; } }
type ElementOf<T> = T extends (infer E)[] ? E : never;
type Ret<F> = F extends (...args: any[]) => infer R ? R : never;
type FirstArg<F> = F extends (x: infer A, y: i64) => i64 ? A : never;
type Inner<T> = T extends Box<infer U> ? U : T;
type FieldOf<T> = T extends { name: infer N } ? N : "none";
type Unwrapped<T> = T extends Option<infer U> ? U : T;
type Small<T> = T extends infer N extends i64 ? N : "big";
type Callback = (n: i64, s: string) => string;
type Num = ElementOf<i64[]>;
type Text = Ret<Callback>;
type Arg = FirstArg<(x: boolean, y: i64) => i64>;
type Boxed = Inner<Box<i64>>;
type Named = FieldOf<{ name: string; age: i64 }>;
type Nameless = FieldOf<{ age: i64 }>;
type Plain = Unwrapped<i64 | null>;
type Ok = ReturnType<() => "ok">;
type Done = Awaited<Promise<Promise<i64>>>;
type Num2 = Small<i64>;
function main() {
  const n: Num = 3;
  const t: Text = "hi";
  const a: Arg = true;
  const b: Boxed = 7;
  const name: Named = "ann";
  const p: Plain = 5;
  const ok: Ok = "ok";
  const d: Done = 2;
  const no: Nameless = "none";
  const s: Num2 = 1;
  console.log(n, t, a ? b : 0, name);
  console.log(p, ok, d + s - 1, no);
}
// case: types_infer_option
// expect: 4 x
// 'Option<infer U>' matches each member of a union as 'U | null' does, so the empty value goes.
type Un<T> = T extends Option<infer U> ? U : "not";
type C = Un<i64 | string | null>;
function main() { const a: C = 4; const b: C = "x"; console.log(a, b); }
// case: types_infer_option_null
// error: type 'null' is not assignable to type 'i64 | string'
type Un<T> = T extends Option<infer U> ? U : "not";
type C = Un<i64 | string | null>;
function main() { const c: C = null; }
// case: types_infer_outside
// error: 'infer U' declares a type only inside a conditional type's 'extends' clause
// `infer` only means something where a conditional type matches a pattern.
type U2 = (infer U)[];
function main() {}
// case: types_infer_rest
// error: rest parameters other than '...args: any[]' in an 'infer' pattern, which need tuple types, are not supported yet
type Params<F> = F extends (...args: infer P) => i64 ? P : never;
type X = Params<() => i64>;
function main() {}
// case: types_infer_string_bound
// expect: 5 7
// A bound taking any string keeps the text, so a digit stays a string literal.
type T<S> = S extends `${infer N extends string | i64}` ? N : "no";
type I<S> = S extends `${infer N extends i64}` ? N : "no";
function main() { const a: T<"5"> = "5"; const b: I<"7"> = 7; console.log(a, b); }
// case: types_infer_union
// error: unions holding 'infer' are not supported yet
type U<T> = T extends (infer U) | null ? U : "no";
type X = U<i64>;
function main() {}
// case: types_infer_unmatched
// error: 'infer V' matched nothing in '{ w: i64 }', since the optional field holding it is missing
type V = string;
type F<T> = T extends { v?: infer V } ? V : i64;
type X = F<{ w: i64 }>;
function main() {}
// case: types_interfaces
// mode: parse
interface Empty {}
interface Point { x: i64; y: i64 }
interface Shape<T extends Unit = Pixels> extends Drawable<T>, Geometry.Sized, Serializable {
  readonly id: string
  name?: string,
  area(): T;
  scale?<U>(factor: U): Shape<U>
  (input: string): boolean
  new (x: i64): Point
  [key: string]: unknown
  readonly [index: number]: string
  [Symbol.iterator](): Iterator<T>
  get size(): i64
  set size(value: i64)
  "quoted-key": i64
  42: boolean
  is(x: unknown): x is Shape<T>
}

function main() {
  interface Local<T> { value: T }
  type Uses = Local<i64>
}
// case: types_intrinsic_string
// error: 'Uppercase' takes string literals, like 'Uppercase<"a" | "b">', not 'string'
type U = Uppercase<string>;
function main() {}
// case: types_keyof_empty
// error: '{}' has no public fields, so 'keyof' of it has no keys
type K = keyof {};
function main() {}
// case: types_keyof_interface
// error: 'keyof' takes an object type or a class, not the interface 'Named'
interface Named { name(): string; }
type K = keyof Named;
function main() {}
// case: types_lib_es5
// mode: parse
// Copied verbatim from TypeScript 7.0.2's lib.es5.d.ts: every utility type alias.


/**
 * Extracts the type of the 'this' parameter of a function type, or 'unknown' if the function type has no 'this' parameter.
 */
type ThisParameterType<T> = T extends (this: infer U, ...args: never) => any ? U : unknown;

/**
 * Removes the 'this' parameter from a function type.
 */
type OmitThisParameter<T> = unknown extends ThisParameterType<T> ? T : T extends (...args: infer A) => infer R ? (...args: A) => R : T;
/**
 * Recursively unwraps the "awaited type" of a type. Non-promise "thenables" should resolve to `never`. This emulates the behavior of `await`.
 */
type Awaited<T> = T extends null | undefined ? T : // special case for `null | undefined` when not in `--strictNullChecks` mode
    T extends object & { then(onfulfilled: infer F, ...args: infer _): any; } ? // `await` only unwraps object types with a callable `then`. Non-object types are not unwrapped
        F extends ((value: infer V, ...args: infer _) => any) ? // if the argument to `then` is callable, extracts the first argument
            Awaited<V> : // recursively unwrap the value
        never : // the argument to `then` was not callable
    T; // non-object or non-thenable
/**
 * Make all properties in T optional
 */
type Partial<T> = {
    [P in keyof T]?: T[P];
};

/**
 * Make all properties in T required
 */
type Required<T> = {
    [P in keyof T]-?: T[P];
};

/**
 * Make all properties in T readonly
 */
type Readonly<T> = {
    readonly [P in keyof T]: T[P];
};

/**
 * From T, pick a set of properties whose keys are in the union K
 */
type Pick<T, K extends keyof T> = {
    [P in K]: T[P];
};

/**
 * Construct a type with a set of properties K of type T
 */
type Record<K extends keyof any, T> = {
    [P in K]: T;
};

/**
 * Exclude from T those types that are assignable to U
 */
type Exclude<T, U> = T extends U ? never : T;

/**
 * Extract from T those types that are assignable to U
 */
type Extract<T, U> = T extends U ? T : never;

/**
 * Construct a type with the properties of T except for those in type K.
 */
type Omit<T, K extends keyof any> = Pick<T, Exclude<keyof T, K>>;

/**
 * Exclude null and undefined from T
 */
type NonNullable<T> = T & {};

/**
 * Obtain the parameters of a function type in a tuple
 */
type Parameters<T extends (...args: any) => any> = T extends (...args: infer P) => any ? P : never;

/**
 * Obtain the parameters of a constructor function type in a tuple
 */
type ConstructorParameters<T extends abstract new (...args: any) => any> = T extends abstract new (...args: infer P) => any ? P : never;

/**
 * Obtain the return type of a function type
 */
type ReturnType<T extends (...args: any) => any> = T extends (...args: any) => infer R ? R : any;

/**
 * Obtain the return type of a constructor function type
 */
type InstanceType<T extends abstract new (...args: any) => any> = T extends abstract new (...args: any) => infer R ? R : any;

/**
 * Convert string literal type to uppercase
 */
type Uppercase<S extends string> = intrinsic;

/**
 * Convert string literal type to lowercase
 */
type Lowercase<S extends string> = intrinsic;

/**
 * Convert first character of string literal type to uppercase
 */
type Capitalize<S extends string> = intrinsic;

/**
 * Convert first character of string literal type to lowercase
 */
type Uncapitalize<S extends string> = intrinsic;

/**
 * Marker for non-inference type position
 */
type NoInfer<T> = intrinsic;
// case: types_mapped
// expect: 1 none 2 bob 9
// expect: 4 x 5 7 ann
// User-written mapped types: modifiers with + and -, a homomorphic one keeping optional and
// readonly fields, and 'as' renaming keys or dropping those renamed to never.
type User = { id: i64; name: string; nick?: string; readonly born: i64 };
type MyPartial<T> = { [K in keyof T]?: T[K] };
type MyRequired<T> = { [K in keyof T]-?: T[K] };
type MyReadonly<T> = { readonly [K in keyof T]: T[K] };
type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type Same<T> = { [K in keyof T]: T[K] };
type Public<T> = { [K in keyof T as K extends "born" ? never : K]: T[K] };
type Renamed<T> = { [K in keyof T as K extends "id" ? "key" : K]: T[K] };
type Flags = { [K in "a" | "b"]: boolean };
type Boxed<T> = { [K in keyof T]: T[K][] };
function main() {
  const p: MyPartial<User> = { id: 1 };
  const r: MyRequired<User> = { id: 2, name: "bob", nick: "b", born: 9 };
  const s: Same<User> = { id: 3, name: "c", born: 1 };
  console.log(p.id ?? 0, p.name ?? "none", r.id, r.name, r.born);
  let m: Mutable<User> = { id: 4, name: "d", born: 0 };
  m.born = 7;
  const pub: Public<User> = { id: 5, name: "ann" };
  const f: Flags = { a: true, b: false };
  const re: Renamed<User> = { key: 5, name: "e", born: 2 };
  const b: Boxed<{ x: i64 }> = { x: [7] };
  console.log(m.id, s.nick ?? "x", re.key, f.a ? b.x[0] : 0, pub.name);
}
// case: types_mapped_clash
// error: two keys of this mapped type are both renamed 'same'
type Clash = { [K in "a" | "b" as "same"]: i64 };
function main() {}
// case: types_mapped_keys
// error: a mapped type takes keys written as string literals, like '"a" | "b"', not 'string'
type Bad = { [K in string]: i64 };
function main() {}
// case: types_mapped_param
// error: 'keyof' of the type parameter 'T' isn't supported yet
// Inside generic function code, a mapped type over the function's own type parameter can't be
// computed, since T is only known per instance.
function f<T>(x: T, y: { [K in keyof T]: T[K] }): i64 { return 1; }
function main() {}
// case: types_mapped_readonly
// error: cannot assign to 'born' because it is a read-only property
type User = { id: i64; born: i64 };
type MyReadonly<T> = { readonly [K in keyof T]: T[K] };
function main() { let u: MyReadonly<User> = { id: 1, born: 2 }; u.born = 3; }
// case: types_never
// expect: 1
// `never` drops out of a union, and Exclude of every member is `never`, which no value has.
type Same = Exclude<"a", "a"> | i64;
function main() { const x: Same = 1; console.log(x); }
// case: types_objects
// mode: parse
type Point = { x: i64; y: i64 }
type Commas = { x: i64, y: i64, }
type Lines = {
  readonly id: string
  name?: string
  greet(other: Person): string
  find?<T>(key: K): T
  (input: string): boolean
  new (x: i64): Point
  [key: string]: unknown
  readonly [index: number]: string
  [Symbol.iterator](): Iterator<T>
  get size(): i64
  set size(value: i64)
  "quoted-key": i64
  42: boolean
  new: T; default: U; get: V; set: W; readonly: X
  get(): T
}
type Pair = [i64, string]
type Named = [first: i64, second?: string, ...rest: boolean[]]
type Optional = [A?, ...B[]]
type Nested = { inner: { deeper: [A, { b: B }] } }[]
// case: types_operators
// mode: parse
type Union = A | B | null | undefined
type Lines =
  | A
  | B
type Both = A & B | C & D
type Grouped = (A | B)[]
type Literals = 'a' | "b" | -1 | 0 | 42 | true | false
type Keys = keyof T
type Frozen = readonly string[]
type Id = unique symbol
type Lookup = Person["name"]
type Element = T[number][]
type Query = typeof config.server<i64>

function f(a: A | B, b: keyof T): i64 & Brand {
  let x: (A & B)[] = 1
}
// case: types_optional_deep
// expect: 1
// Nested optional fields and unions compile in linear time, not exponential.
type T0 = { a?: i64; s: string | i64 };
type T1 = { x?: T0 | string; y: T0 | i64 | boolean };
type T2 = { x?: T1 | string; y: T1 | i64 | boolean };
type T3 = { x?: T2 | string; y: T2 | i64 | boolean };
type T4 = { x?: T3 | string; y: T3 | i64 | boolean };
type T5 = { x?: T4 | string; y: T4 | i64 | boolean };
type T6 = { x?: T5 | string; y: T5 | i64 | boolean };
type T7 = { x?: T6 | string; y: T6 | i64 | boolean };
type T8 = { x?: T7 | string; y: T7 | i64 | boolean };
type T9 = { x?: T8 | string; y: T8 | i64 | boolean };
type T10 = { x?: T9 | string; y: T9 | i64 | boolean };
type T11 = { x?: T10 | string; y: T10 | i64 | boolean };
type T12 = { x?: T11 | string; y: T11 | i64 | boolean };
type T13 = { x?: T12 | string; y: T12 | i64 | boolean };
type T14 = { x?: T13 | string; y: T13 | i64 | boolean };
function f(t: T14): i64 { return 1; }
function main() { console.log(1); }
// case: types_optional_generic
// expect: xy-1 z3
// A generic class over an object type mixing optional and required fields, in both spellings.
class Box<T> { v: T; constructor(v: T) { this.v = v; } }
type P = { k?: i64; s: string };
function show(b: Ref<Box<P>>): string { return b.v.s + String(b.v.k ?? -1); }
function main() {
  const a: P = { s: "x" + "y" };
  const b = new Box(a);
  const c: Box<{ k: i64 | null; s: string }> = new Box<{ k: i64 | null; s: string }>({ k: 3, s: "z" });
  console.log(show(b), show(c));
}
// case: types_optional_instances
// expect: 1
// Forty instances of one generic class over optional-field objects stay under the limit on
// instantiation: each spelling of a value shape counts once.
class Box<T> { v: T; constructor(v: T) { this.v = v; } }
type W = Box<{ k1?: i64; s: string }> | Box<{ k2?: i64; s: string }> | Box<{ k3?: i64; s: string }> | Box<{ k4?: i64; s: string }> | Box<{ k5?: i64; s: string }> | Box<{ k6?: i64; s: string }> | Box<{ k7?: i64; s: string }> | Box<{ k8?: i64; s: string }> | Box<{ k9?: i64; s: string }> | Box<{ k10?: i64; s: string }> | Box<{ k11?: i64; s: string }> | Box<{ k12?: i64; s: string }> | Box<{ k13?: i64; s: string }> | Box<{ k14?: i64; s: string }> | Box<{ k15?: i64; s: string }> | Box<{ k16?: i64; s: string }> | Box<{ k17?: i64; s: string }> | Box<{ k18?: i64; s: string }> | Box<{ k19?: i64; s: string }> | Box<{ k20?: i64; s: string }> | Box<{ k21?: i64; s: string }> | Box<{ k22?: i64; s: string }> | Box<{ k23?: i64; s: string }> | Box<{ k24?: i64; s: string }> | Box<{ k25?: i64; s: string }> | Box<{ k26?: i64; s: string }> | Box<{ k27?: i64; s: string }> | Box<{ k28?: i64; s: string }> | Box<{ k29?: i64; s: string }> | Box<{ k30?: i64; s: string }> | Box<{ k31?: i64; s: string }> | Box<{ k32?: i64; s: string }> | Box<{ k33?: i64; s: string }> | Box<{ k34?: i64; s: string }> | Box<{ k35?: i64; s: string }> | Box<{ k36?: i64; s: string }> | Box<{ k37?: i64; s: string }> | Box<{ k38?: i64; s: string }> | Box<{ k39?: i64; s: string }> | Box<{ k40?: i64; s: string }> | string;
function f(w: W): i64 { return 1; }
function main() { console.log(f("x")); }
// case: types_optional_spelling
// expect: 2 5
// `{ a?: T }` and `{ a: T | null }` are one type to interface methods, intersections and nested
// unions, as before optional fields were remembered.
type A = { a?: i64 };
type B = { a: i64 | null };
interface H { f(x: A): i64; }
interface J { f(x: B): i64; }
class C implements H { f(x: B): i64 { return 2; } }
type HJ = H & J;
type U = { x: { a?: i64 } } | { x: { a: i64 | null } };
function use(h: H): i64 { return h.f({ a: 1 }); }
function nested(u: U): i64 { return u.x.a ?? 5; }
function main() { console.log(use(new C()), nested({ x: {} })); }
// case: types_optional_spelling_refs
// expect: 2 3
// The two spellings of an optional field are one type through a borrow and a generic class's
// type argument, in interface methods and in intersections.
type A = { a?: i64 };
type B = { a: i64 | null };
class Box<T> { v: T; constructor(v: T) { this.v = v; } }
interface H { f(x: Ref<A>): i64; }
interface J { f(x: Ref<B>): i64; }
interface K { g(x: Box<A>): i64; }
class C implements H { f(x: Ref<B>): i64 { return x.a ?? 2; } }
class D implements K { g(x: Box<B>): i64 { return x.v.a ?? 3; } }
type HJ = H & J;
function useH(h: H): i64 { const a: A = {}; return h.f(a); }
function useK(k: K): i64 { const a: A = {}; return k.g(new Box(a)); }
function main() { console.log(useH(new C()), useK(new D())); }
// case: types_own_partial
// expect: mine 3
// A program's own Partial wins over the std one, everywhere in the program.
type Partial<T> = { mine: T };
function main() {
  const p: Partial<i64> = { mine: 3 };
  console.log("mine", p.mine);
}
// case: types_pattern
// expect: 12px 4 12PX true
// expect: x y-z 42 7 id-9 a
// Pattern types: a string literal fits a template with open holes when it matches, and a
// value of one is a string. Conditional types take string literals apart with 'infer'.
type Px = `${number}px`;
type Id = `id-${i64}`;
type Head<S> = S extends `${infer A}-${infer B}` ? A : never;
type Tail<S> = S extends `${infer A}-${infer B}` ? B : never;
type Num<S> = S extends `n${infer N extends i64}` ? N : never;
type Ev = `on${string}`;
function size(p: Px): string { return p; }
function main() {
  const p: Px = "12px";
  const big = p.toUpperCase();
  const e: Ev = "onclick";
  console.log(size(p), p.length, big, p === "12px");
  const h: Head<"x-y-z"> = "x";
  const t: Tail<"x-y-z"> = "y-z";
  const n: Num<"n42"> = 42;
  const id: Id = "id-9";
  const mixed: `${"a" | "b"}${string}` = "a";
  console.log(h, t, n, e.length - 0, id, mixed);
}
// case: types_pattern_borrow
// error: argument of type 'string' is not assignable to parameter of type 'Ref<`${number}px`>'
type Px = `${number}px`;
function size(r: Ref<Px>): i64 { return 1; }
function f(s: string): i64 { return size(s); }
function main() {}
// case: types_pattern_cell
// error: template literal pattern types in 'Cell' values are not supported yet
// A Cell's methods take and give its value as a plain string, so it can't hold a pattern yet.
type Px = `${number}px`;
function main() { const c = new Cell<Px>("1px"); }
// case: types_pattern_channel
// error: template literal pattern types in channels are not supported yet
type Px = `${number}px`;
async function main() { const ch = new Channel<Px>(2); }
// case: types_pattern_class_field
// error: template literal pattern types in class fields are not supported yet
type Px = `${number}px`;
class C { w: Px = "1px"; }
function main() {}
// case: types_pattern_compare
// expect: true false false true
// A union of a pattern and string literals compares as a string.
type Px = `${number}px`;
function auto(l: Px | "auto"): boolean { return l === "auto"; }
function sized(l: Px | "auto"): boolean { return "auto" !== l; }
function main() { console.log(auto("auto"), auto("1px"), sized("auto"), sized("1px")); }
// case: types_pattern_enum
// error: template literal pattern types in enum members are not supported yet
type Px = `${number}px`;
enum Size { Fixed(Px), Auto }
function main() {}
// case: types_pattern_field_write
// error: type 'string' is not assignable to type '`${number}px`'
// Writing a field declared with a pattern asks the value to match it.
type Px = `${number}px`;
function f(s: string): i64 { let o: { w: Px } = { w: "1px" }; o.w = s; return 1; }
function main() {}
// case: types_pattern_function_type
// error: template literal pattern types in function types are not supported yet
type Px = `${number}px`;
type F = (s: Px) => string;
function main() {}
// case: types_pattern_generic
// error: argument of type 'string' is not assignable to parameter of type '`${number}px`'
// A generic function given a pattern type argument keeps it in its parameters.
type Px = `${number}px`;
function id<T>(x: T): T { return x; }
function f(s: string): Px { return id<Px>(s); }
function main() {}
// case: types_pattern_int
// error: type '"id-1.5"' is not assignable to type '`id-${i64}`'
type Id = `id-${i64}`;
function main() { const x: Id = "id-1.5"; }
// case: types_pattern_interface
// error: template literal pattern types in interface methods are not supported yet
type Px = `${number}px`;
interface Sized { size(): Px; }
function main() {}
// case: types_pattern_nested
// error: is not assignable to type '{ a: `${number}px` }'
// A pattern inside an object still asks its fields to match.
type Px = `${number}px`;
function f(o: { a: string }): i64 { const p: { a: Px } = o; return 1; }
function main() {}
// case: types_pattern_promise
// error: template literal pattern types in promises are not supported yet
type Px = `${number}px`;
async function s(): Promise<Px> { return "1px"; }
async function main() {}
// case: types_pattern_refused
// error: type '"px"' is not assignable to type '`${number}px`'
type Px = `${number}px`;
function main() { const p: Px = "px"; }
// case: types_pattern_string
// error: type 'string' is not assignable to return type '`${number}px`'
// A plain string might not match, so it doesn't fit a pattern.
type Px = `${number}px`;
function f(s: string): Px { return s; }
function main() {}
// case: types_pick_missing
// error: 'age' isn't a field of '{ id: i64; name: string }', so 'Pick' can't keep it
// Pick keeps fields the type has.
type User = { id: i64; name: string };
type P = Pick<User, "age">;
function main() {}
// case: types_pick_nonliteral
// error: 'Pick' takes keys written as string literals, like '"a" | "b"', not 'string'
type User = { id: i64 };
type P = Pick<User, string>;
function main() {}
// case: types_prototype_name
// error: cannot find type 'toString'
// A type name that is also a JavaScript object member is still just an unknown name.
function main() { let y: toString = 1; let z: Partial<{ a: i64 }> = {}; }
// case: types_readonly
// error: cannot assign to 'name' because it is a read-only property
// Readonly makes every field read-only.
type User = { id: i64; name: string };
function main() {
  let u: Readonly<User> = { id: 1, name: "a" };
  u.name = "b";
}
// case: types_record_string
// error: 'Record<string, i64>' is a dictionary whose keys are only known at run time, which needs a Map type
// Record with string keys needs a Map type Fish doesn't have yet.
type Scores = Record<string, i64>;
function main() {}
// case: types_refs
// mode: parse
function f(a: Map<string, Array<i64>>, b: A.B.C<D<E>>): Promise<void> {
  let x: Record<string, Set<i64>> = 1
}
// case: types_required_partial
// expect: 1 ann
// Required<Partial<T>> is T again.
type User = { id: i64; name: string };
type Back = Required<Partial<User>>;
function take(u: User): string { return String(u.id) + " " + u.name; }
function main() {
  const b: Back = { id: 1, name: "ann" };
  console.log(take(b));
}
// case: types_returntype_refused
// error: 'ReturnType' takes a function type, like 'ReturnType<() => i64>' or 'ReturnType<typeof f>', not 'string'
type R = ReturnType<string>;
function main() {}
// case: types_template
// expect: a-1 b-2 ANN Bob
// expect: 3 alice getName true
// Finite template literal types spell the union of their strings, and the intrinsics change
// string literals' case, as in getter keys built by a mapped type's 'as'.
type Ids = `${"a" | "b"}-${1 | 2}`;
type Flag = `is${true | false}`;
type Loud = Uppercase<"ann">;
type Name = Capitalize<"bob">;
type Quiet = Lowercase<"ALICE">;
type Small = Uncapitalize<"Name">;
type Getters<T> = { [K in keyof T as `get${Capitalize<K>}`]: () => T[K] };
type Person = { name: string; age: i64 };
function keyOf(k: keyof Getters<Person>): string { return k; }
function main() {
  const a: Ids = "a-1";
  const b: Ids = "b-2";
  const l: Loud = "ANN";
  const n: Name = "Bob";
  const q: Quiet = "alice";
  const s: Small = "name";
  const f: Flag = "istrue";
  console.log(a, b, l, n);
  console.log(3, q, keyOf("getName"), f === "istrue");
}
// case: types_template_large
// error: this template literal type spells more than 10000 strings, too many for one union
type D = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
type Five = `${D}${D}${D}${D}${D}`;
function main() {}
// case: types_template_more
// expect: 1 true 200 5 5 true
// expect: 1 true false
// A hole of never spells nothing, so a key renamed through one is dropped; boolean holes
// spell true and false; infer takes other integer types and union bounds; a homomorphic mapped
// type over a field holding its own null gives the null '?' added when the new type has none.
type U = { a: i64; b: i64 };
type G<T> = { [K in keyof T as `get${K extends "a" ? never : K}`]: T[K] };
type B = `${boolean}`;
type U8<S> = S extends `${infer N extends u8}` ? N : "no";
type I32<S> = S extends `${infer N extends i32}` ? N : "no";
type Either<S> = S extends `${infer N extends i64 | boolean}` ? N : "no";
type Held = { a?: string | null };
type Arr<X> = { [K in keyof X]: X[K][] };
type Px = `${number}px`;
function wide(o: Px | string): string { return o; }
function main() {
  const g: G<U> = { getb: 1 };
  const b: B = "true";
  const u: U8<"200"> = 200;
  const i: I32<"5"> = 5;
  const n: Either<"5"> = 5;
  const t: Either<"true"> = true;
  console.log(g.getb, b, u, i, n, t);
  const q: Required<Arr<Held>> = { a: [null] };
  console.log(q.a.length, wide("3px") === "3px", "1." === wide("x"));
}
// case: types_template_refused
// error: type '"c-1"' is not assignable to type
type Ids = `${"a" | "b"}-${1 | 2}`;
function main() { const x: Ids = "c-1"; }
// case: types_typeof
// expect: hi 6 4 dev
// `typeof` in a type names a top-level function's or const's type, so ReturnType, Awaited and
// parameters can follow them.
type Config = { port: i64; name: string };
const CONFIG: Config = { port: 8080, name: "dev" };
function greet(n: i64): string { return "hi"; }
function double(n: i64) { return n * 2; }
async function fetchCount(): Promise<i64> { return 4; }
type Greeting = ReturnType<typeof greet>;
type Doubled = ReturnType<typeof double>;
type Count = Awaited<ReturnType<typeof fetchCount>>;
function show(c: Ref<typeof CONFIG>): string { return c.name; }
async function main() {
  const g: Greeting = greet(1);
  const d: Doubled = double(3);
  const c: Count = await fetchCount();
  console.log(g, d, c, show(CONFIG));
}
// case: types_typeof_async_layout
// expect: 0 7
// An async function's written Promise<T> is its type, so a class's own fields may name it.
class Holder { w: i64 = 7; v: Awaited<ReturnType<typeof make>>; constructor() { this.v = 0; } }
async function make(): Promise<i64> { const h = new Holder(); return h.w; }
async function main() { const h = new Holder(); const m = await make(); console.log(h.v, m); }
// case: types_typeof_cast
// error: 'typeof' of the local 'LIMIT' isn't supported yet
// A cast inside a body sees its locals.
const LIMIT: i64 = 5;
function main() { const LIMIT = "t"; const v = 3 as typeof LIMIT; console.log(v, LIMIT); }
// case: types_typeof_closure
// error: 'typeof' of the local 'LIMIT' isn't supported yet
// A closure's parameter annotation sees the locals around it.
const LIMIT: i64 = 5;
function main() { const LIMIT = "t"; const g = (x: typeof LIMIT) => x; console.log(g("s"), LIMIT); }
// case: types_typeof_cycle
// error: 'typeof make' is used in working out make's own type, so that type would depend on itself
function make(x: typeof make): i64 { return 1; }
function main() {}
// case: types_typeof_generic
// error: 'typeof' of the generic function 'id' isn't supported yet
function id<T>(x: T): T { return x; }
type R = ReturnType<typeof id>;
function main() {}
// case: types_typeof_implicit
// expect: 8080 ok
// 'typeof' names a function taking an object type or a borrow with a lifetime by its declared
// signature, though Fish compiles it per argument type.
type Config = { port: i64; name: string };
function portOf(c: Config): i64 { return c.port; }
function pick<A extends Lifetime>(x: Ref<string, A>, y: Ref<string>): Ref<string, A> { return x; }
type Port = ReturnType<typeof portOf>;
type Picked = ReturnType<typeof pick>;
function main() { const p: Port = portOf({ port: 8080, name: "a" }); const s = "ok"; const t = "no"; const q: Picked = pick(s, t); console.log(p, q); }
// case: types_typeof_layout
// error: 'typeof make' needs make's result, worked out from its body, while the field types of 'Holder' are being worked out
class Holder { w: i64 = 7; v: ReturnType<typeof make>; constructor() { this.v = 0; } }
function make() { const h = new Holder(); return h.w; }
function main() {}
// case: types_typeof_local
// error: 'typeof' of the local 'LIMIT' isn't supported yet
// A local shadowing a top-level const isn't what 'typeof' names, so it is refused, not mistaken.
const LIMIT: i64 = 5;
function main() { const LIMIT = "text"; const x: typeof LIMIT = 3; console.log(x, LIMIT); }
// case: types_typeof_missing
// error: 'typeof' in a type names a top-level function or const, and there is none named 'nope'
type R = typeof nope;
function main() {}
// case: types_typeof_order
// expect: 3 t
// A body checked to infer another's result sees only its own names, in either order.
const LIMIT: i64 = 5;
function main() { const LIMIT = "t"; const r: ReturnType<typeof f> = f(); console.log(r, LIMIT); }
function f() { const v = 3 as typeof LIMIT; return v; }
// case: types_typeof_outside
// expect: 9 t 3
// A type written outside a body, in a generic class's field or before a constructor's
// parameters, names the top-level const, though a body needing it has a local of that name.
const LIMIT: i64 = 5;
class B<T> { v: T; k: typeof LIMIT; constructor(v: T) { this.v = v; this.k = 9; } }
class C { k: i64 = 3 as typeof LIMIT; constructor(LIMIT: string) { } }
function main() { const LIMIT = "t"; const b = new B<string>("s"); const c = new C("z"); console.log(b.k, LIMIT, c.k); }
// case: types_typeof_param
// error: 'typeof' of the local 'LIMIT' isn't supported yet
// A parameter shadows a top-level name in its function's own signature.
const LIMIT: i64 = 5;
function f(LIMIT: string): typeof LIMIT { return 1; }
function main() {}
// case: types_typeof_scope
// expect: 5 text 6
// 'typeof' names what is in sight where it is written: another function's local, or a block
// that has closed, doesn't hide a top-level const.
const LIMIT: i64 = 5;
function f(x: typeof LIMIT): i64 { return x; }
function main() {
  const LIMIT = "text";
  if (true) { const inner = 1; }
  const y: ReturnType<typeof f> = 6;
  console.log(f(5), LIMIT, y);
}
// case: types_utility
// expect: key email a 7 13
// expect: bob none
// expect: c@x d ann 4 zoe balance
// keyof, indexed access, Record and the utility types, computed while compiling into ordinary
// object, union and literal types.
type User = { id: i64; name: string; email?: string; tags: string[] };
type Key = keyof User;
type Name = User["name"];
type IdOrName = User["id" | "name"];
type Tags = User["tags"];
type Tag = Tags[number];
type Scores = Record<"math" | "art", i64>;
type Patch = Partial<User>;
type Full = Required<User>;
type Frozen = Readonly<User>;
type Card = Pick<User, "id" | "name">;
type Public = Omit<User, "email" | "tags">;
class Account {
  owner: string;
  balance: i64;
  private pin: i64 = 0;
  constructor(owner: string, balance: i64) { this.owner = owner; this.balance = balance; }
}
type AccountView = Pick<Account, "owner">;
type AccountKey = keyof Account;

function describe(k: Key): string { return "key " + k; }
function first(t: Ref<Tags>): Tag { return t[0]; }
function merge(u: User, p: Patch): User {
  const name = p.name;
  const email = p.email;
  return { id: u.id, name: name ?? u.name, email: email ?? u.email, tags: u.tags };
}
function card(u: Ref<User>): Card { return { id: u.id, name: u.name }; }
function main() {
  const n: Name = "ann";
  const both: IdOrName = 7;
  const s: Scores = { math: 9, art: 4 };
  const u: User = { id: 1, name: n, tags: ["a", "b"] };
  const changed = merge(u.clone(), { name: "bob" });
  console.log(describe("email"), first(u.tags), both, s.math + s.art);
  console.log(changed.name, changed.email ?? "none");
  const full: Full = { id: 2, name: "c", email: "c@x", tags: [] };
  const frozen: Frozen = { id: 3, name: "d", tags: [] };
  const c = card(u);
  const p: Public = { id: 4, name: "e" };
  const v: AccountView = { owner: "zoe" };
  const k: AccountKey = "balance";
  console.log(full.email, frozen.name, c.name, p.id, v.owner, k);
}
// case: types_utility_alias_self
// error: 'Pick' of 'Node' is needed while the field types of 'Node' are being worked out
// An alias over a class can't be used in that class's own fields.
type V = Pick<Node, "a">;
class Node { a: i64 = 1; v: V | null = null; }
function main() {}
// case: types_utility_arity
// error: 'Pick' takes two type arguments, like 'Pick<User, "id">'
type User = { id: i64 };
type P = Pick<User>;
function main() {}
// case: types_utility_classes
// expect: ann 5 3 none
// expect: kim 1
// Utility types over a derived class see the base's fields, over an inferred field see its type,
// and over a class's own `?:` fields know `?` made them nullable.
class Owned {
  owner: string;
  constructor(owner: string) { this.owner = owner; }
}
class Acct extends Owned {
  balance: i64;
  count = 0;
  nick?: string;
  constructor(owner: string, balance: i64) { super(owner); this.balance = balance; }
}
type Summary = Omit<Acct, "count" | "nick">;
type Counted = Pick<Acct, "count">;
type Filled = Required<Pick<Acct, "owner" | "nick">>;
type Loose = Partial<Acct>;
function main() {
  const s: Summary = { owner: "ann", balance: 5 };
  const c: Counted = { count: 3 };
  const l: Loose = { owner: "kim" };
  const f: Filled = { owner: "kim", nick: "k" };
  console.log(s.owner, s.balance, c.count, l.nick ?? "none");
  console.log(f.owner, f.nick.length);
}
// case: types_utility_compose
// expect: 7 none bob
// expect: 1 set
// expect: 0 2 3
// A nullable field stays nullable under Required<Partial<T>>, Partial<T> & Pick<T, K> requires
// the picked keys, `{ a?: T }` and `{ a: T | null }` are interchangeable, and a single-key Record
// and an Omit of every key are object types.
type User = { id: i64; nick: string | null; name: string };
type Back = Required<Partial<User>>;
type Patch = Partial<User> & Pick<User, "id">;
type One = Record<"only", i64>;
type Empty = Omit<User, "id" | "nick" | "name">;
type A = { a?: i64 };
type B = { a: i64 | null };
function patch(p: Patch): i64 { return p.id; }
function count(xs: A[]): i64 { return xs.length as i64; }
function same<T>(x: T, y: T): T { return y; }
function main() {
  const b: Back = { id: 1, nick: null, name: "bob" };
  console.log(patch({ id: 7 }), b.nick ?? "none", b.name);
  const one: One = { only: 1 };
  const bs: B[] = [{ a: 2 }];
  const e: Empty = {};
  console.log(one.only, count(bs) === 1 ? "set" : "unset");
  const either: A | B = { a: 2 };
  const x: A = { a: 9 };
  const y: B = { a: 3 };
  console.log(count([]), either.a ?? 0, same(x, y).a ?? 0);
}
// case: types_utility_enum
// expect: 5 7
// An enum's payload may use a utility type over a class with an inferred field or a base.
class Counter { count = 0; }
class Base { id: i64 = 1; }
class Acct extends Base { owner: string = "o"; }
enum Msg { Got(Pick<Counter, "count">), Kept(Omit<Acct, "owner">), Empty }
function read(m: Msg): i64 {
  return match (m) { case Msg.Got(c) => c.count, case Msg.Kept(k) => k.id, case Msg.Empty => 0 };
}
function main() { console.log(read(Msg.Got({ count: 5 })), read(Msg.Kept({ id: 7 }))); }
// case: types_utility_mutual
// error: 'Pick' of 'A' is needed while the field types of 'A' are being worked out
// Two classes whose fields pick from each other can't be worked out in either order.
class A { y: i64 = 1; b: Pick<B, "x"> | null = null; }
class B { x: i64 = 2; a: Pick<A, "y"> | null = null; }
function main() {}
// case: types_utility_param
// error: 'Partial' of the type parameter 'T' isn't supported yet
// Utility types are computed while compiling from a type known then.
function patch<T>(x: T, p: Partial<T>): T { return x; }
function main() { console.log(patch(1, {})); }
// case: types_utility_self
// error: 'Partial' of 'Node' is needed while the field types of 'Node' are being worked out
// A class's fields aren't known while its own field types are being worked out.
class Node {
  value: i64 = 0;
  patch: Partial<Node> | null = null;
}
function main() {}
