// case: tuple_array
// expect: 1 2
// An array pattern over an array of copies reads each element.
function main() { const xs = [1, 2]; const [a, b] = xs; console.log(a, b); }
// case: tuple_arrow
// expect: 2 h2
// Arrows taking and giving tuples.
function main() { const h = (n: i64): [i64, string] => [n, "h" + n]; const t = h(2); console.log(t[0], t[1]); }
// case: tuple_async
// expect: v4 v5 l1
// expect: 9
// An async function giving a tuple.
async function get(n: i64): Promise<[i64, string]> { return [n, "v" + n]; }
async function run(): Promise<i64> {
  const t = await get(4);
  const [n, s] = await get(5);
  const local: [string, i64] = ["l" + 1, 1];
  await get(6);
  console.log(t[1], s, local[0]);
  return t[0] + n;
}
async function main() { const r = await run(); console.log(r); }
// case: tuple_basics
// expect: 3 2
// expect: n3 6 n3
// expect: 5 b2
// expect: 1 2
// expect: y2
// Tuples as return values, annotations and generic results: elements read and written by
// index, and a tuple of Copy elements copied.
class P { n: i64; constructor(n: i64) { this.n = n; } }
function divmod(a: i64, b: i64): [i64, i64] { return [a / b, a % b]; }
function named(n: i64): [string, i64] { return ["n" + n, n * 2]; }
function pair<T>(x: T, y: T): [T, T] { return [x, y]; }
function main() {
  const r = divmod(17, 5);
  console.log(r[0], r[1]);
  const t: [string, i64] = named(3);
  const u = t;
  console.log(t[0], t[1], u[0]);
  let m: [i64, string] = [1, "a" + 1];
  m[0] = 5;
  m[1] = "b" + 2;
  console.log(m[0], m[1]);
  const pp = pair(new P(1), new P(2));
  console.log(pp[0].n, pp[1].n);
  const ps = pair("x" + 1, "y" + 2);
  console.log(ps[1]);
}
// case: tuple_callable
// expect: 2
// A tuple's callable element is called through its index.
function dbl(x: i64): i64 { return x * 2; }
function main() { const t: [(x: i64) => i64, i64] = [(x: i64): i64 => x * 2, 1]; console.log(t[0](t[1])); }
// case: tuple_closure_arg
// expect: 12
// A tuple literal passed to a closure taking a tuple.
function main() { const g = (x: [i64, i64]): i64 => x[0] * x[1]; console.log(g([3, 4])); }
// case: tuple_comptime
// expect: 3 ct 9
// Top-level consts computed from functions giving tuples.
function mk(): [i64, string] { return [3, "ct"]; }
const T = mk();
const U: [i64, i64] = [4, 5];
function main() { console.log(T[0], T[1], U[0] + U[1]); }
// case: tuple_computed
// error: a tuple's element is named by a number written in place
function main() { const t: [i64, i64] = [1, 2]; let i = 0; console.log(t[i]); }
// case: tuple_destructure
// expect: 3 2
// expect: 2 x1 1 x1
// expect: 4 s1
// expect: 1
// expect: x1 1
// expect: b2 2 10,20
// Destructuring tuples into names, holes skipping elements, and tuples in arrays.
class P { n: i64; constructor(n: i64) { this.n = n; } }
function divmod(a: i64, b: i64): [i64, i64] { return [a / b, a % b]; }
function both(): [P, string] { return [new P(4), "s" + 1]; }
function swap<A, B>(t: [A, B]): [B, A] { const [a, b] = t; return [b, a]; }
function main() {
  const [q, r] = divmod(17, 5);
  console.log(q, r);
  const t: [i64, string] = [1, "x" + 1];
  let [n, s] = t;
  n += 1;
  console.log(n, s, t[0], t[1]);
  const [p, label] = both();
  console.log(p.n, label);
  const [, only] = divmod(9, 4);
  console.log(only);
  const sw = swap<i64, string>(t);
  console.log(sw[0], sw[1]);
  const pairs: [string, i64][] = [["a", 1], ["b" + 2, 2]];
  console.log(pairs[1][0], pairs.length, pairs.map((x) => x[1] * 10).join());
}
// case: tuple_destructure_repeat
// expect: ok
// Destructurings with the same pattern, holes alone, may repeat.
function main() { const t: [i64, i64] = [1, 2]; const [, ] = t; const [] = t; const [,] = t; console.log("ok"); }
// case: tuple_generator
// expect: 1 a1
// expect: 2 b2
// A generator of tuples gives each as a tuple.
function* pairs(): Generator<[i64, string]> {
  yield [1, "a" + 1];
  const t: [i64, string] = [2, "b" + 2];
  yield t;
}
function main() {
  for (const p of pairs()) console.log(p[0], p[1]);
}
// case: tuple_generic
// expect: seven1 7
// A tuple literal passed to a generic function infers its type arguments element by element.
function swap<A, B>(t: [A, B]): [B, A] { return [t[1], t[0]]; } function main() { const s = swap([7, "seven" + 1]); console.log(s[0], s[1]); }
// case: tuple_generic_twice
// expect: 1 s1 true
// A tuple literal passed to a generic function from a generic body checked per instance.
function swap<A, B>(t: [A, B]): [B, A] { return [t[1], t[0]]; }
function g<T>(x: T): [i64, T] { return swap([x, 1]); }
function main() { const a = g("s" + 1); const b = g(true); console.log(a[0], a[1], b[1]); }
// case: tuple_interface
// error: a field can't have the interface type 'Shape'
interface Shape { area(): i64 }
function f(t: [Shape, i64]): i64 { return t[0].area() + t[1]; }
function main() { console.log(1); }
// case: tuple_length
// error: type '[i64, i64]' has 2 elements, but this literal has 3
function main() { const t: [i64, i64] = [1, 2, 3]; }
// case: tuple_longer
// error: tuple type '[i64, i64]' of length 2 has no element at index 2
function main() { const t: [i64, i64] = [1, 2]; const [a, b, c] = t; }
// case: tuple_match_pattern
// error: array patterns over tuples in 'match'
function main() {
  const t: [i64, string] = [1, "m" + 1];
  const r = match (t) {
    case [1, s] => s,
    case _ => "other",
  };
  console.log(r);
}
// case: tuple_moved
// error: 't[1]' can't be used here because 't' was moved
class P { n: i64; constructor(n: i64) { this.n = n; } } function main() { const t: [P, i64] = [new P(1), 2]; const u = t; console.log(t[1]); }
// case: tuple_mut_alias
// error: 's' is borrowed mutably twice in one value, which would let one change what the other reads
function main() { let s = "a" + 1; let t: [Mut<string>, Mut<string>] = [s, s]; t[0] = "x"; console.log(t[1]); }
// case: tuple_mut_moves
// error: 't[0]' can't be used here because 't' was moved
class P { xs: string[]; constructor() { this.xs = ["a" + 1, "b" + 2]; } }
function hold(a: Mut<P>, b: Mut<P>): i64 {
  const first: Ref<string> = a.xs[0];
  while (b.xs.length > 0) b.xs.pop();
  for (let i = 0; i < 100; i++) b.xs.push("junk" + i);
  console.log(first);
  return 0;
}
function main() {
  let o = new P();
  let t: [Mut<P>, i64] = [o, 1];
  let u = t;
  hold(t[0], u[0]);
}
// case: tuple_not_object
// error: type '{ "0": i64; "1": i64 }' is not assignable to type '[i64, i64]'
function main() { const t: [i64, i64] = { 0: 3, 1: 4 }; console.log(t[0]); }
// case: tuple_option
// expect: 3 0
// expect: o1
// Tuples inside Options, as parameters and returns.
function f(o: [i64, i64] | null): i64 { if (o === null) return 0; return o[0] + o[1]; }
function main() { console.log(f([1, 2]), f(null)); const x: Option<[i64, string]> = [1, "o" + 1]; if (x !== null) console.log(x[1]); }
// case: tuple_optional
// expect: 1 1 null 1 null
// expect: [ 1 ]
// expect: [1]
// expect: 2 2 two 2 two
// expect: [ 2, 'two' ]
// expect: [2,"two"]
// expect: 2 3 three 3 three
// expect: [ 3, 'three' ]
// expect: [3,"three"]
// expect: [ 'x', 5 ] 2 ["x",5]
// expect: 1 d
type Pair = [i64, string?];
function show(t: Pair): void {
  const [n, s] = t;
  console.log(t.length, t[0], t[1], n, s);
  console.log(t);
  console.log(JSON.stringify(t));
}
function main(): void {
  const a: Pair = [1];
  show(a);
  show([2, "two"]);
  const full: [i64, string] = [3, "three"];
  show(full);
  const many: [string, i64?, boolean?] = ["x", 5];
  console.log(many, many.length, JSON.stringify(many));
  const [n, s = "d"] = a;
  console.log(n, s);
}
// case: tuple_optional_json
// expect: [ 7 ] 1
// expect: [ 7, 's' ] 2
// expect: expected an array of 1 to 2 at $
// expect: expected an array of 1 to 2 at $
function main(): void throws JsonError {
  const short = JSON.parse<[i64, string?]>("[7]");
  console.log(short, short.length);
  const long = JSON.parse<[i64, string?]>("[7, \"s\"]");
  console.log(long, long.length);
  for (const text of ["[]", "[1, \"a\", 2]"]) {
    try {
      JSON.parse<[i64, string?]>(text);
    } catch (e) {
      console.log(e.message);
    }
  }
}
// case: tuple_optional_write
// expect: [ 1, 'x' ] 2
// expect: 1
// expect: [ [ 1 ], [ 2, 'b' ] ] [ 1, 2 ] 2
function main(): void {
  let t: [i64, string?] = [1];
  t[1] = "x";
  console.log(t, t.length);
  t[1] = null;
  console.log(t.length);
  const xs: [i64, string?][] = [[1], [2, "b"]];
  const plain: [i64, i64] = [1, 2];
  console.log(xs, xs.map((x) => x.length), plain.length);
}
// case: tuple_optional_order
// error: a required element can't follow an optional one; move it before the optional elements
function main() { const t: [i64, string?, boolean] = [1, "a", true]; }
// case: tuple_optional_count
// error: type '[i64, string?]' has 1 to 2 elements, but this literal has 3
function main() { const t: [i64, string?] = [1, "a", "b"]; }
// case: tuple_optional_narrow
// error: type '[i64, string?]' is not assignable to type '[i64, string]'
function main() { const t: [i64, string?] = [1]; const u: [i64, string] = t; }
// case: tuple_optional_moved
// error: 't' was moved, so it can't be used here
class C { constructor(public n: i64) {} }
function main() { const t: [i64, C?] = [1, new C(2)]; const u = t; console.log(u.length, t.length); }
// case: tuple_past
// error: tuple type '[i64, i64]' of length 2 has no element at index 2
function main() { const t: [i64, i64] = [1, 2]; console.log(t[2]); }
// case: tuple_shared
// expect: 1 s1
// A shared tuple's elements are read under its lock.
type S = { t: [i64, i64] };
async function main() {
  const g = shared<[i64, string]>([1, "s" + 1]);
  console.log(g[0], g[1]);
}
// case: tuple_shared_update
// expect: 5 1
// A tuple's element is assigned inside a shared value's update.
async function main() {
  const g = shared<[i64, Atomic<i64>]>([1, new Atomic(0)]);
  g.update((s) => s[0] = 5);
  g[1].add(1);
  console.log(g.update((s) => s[0]), g[1].load());
}
// case: tuple_rest
// expect: [ 'a' ] 1 a ["a"]
// expect: [ 'b', 1, 2, 3 ] 4 b ["b",1,2,3]
// expect: 1 3
// expect: b 1 [ 2, 3 ]
// expect: a []
// expect: [ 4, 5 ] 2 [4,5]
// expect: [ 'c', 7, 8, 9 ]
// expect: [ 1, 5 ] 1 5
type Row = [string, ...i64[]];
function show(t: Row): void {
  console.log(t, t.length, t[0], JSON.stringify(t));
}
function main(): void {
  const a: Row = ["a"];
  const b: Row = ["b", 1, 2, 3];
  show(a.clone());
  show(b.clone());
  console.log(b[1], b[3]);
  const [name, first, ...others] = b;
  console.log(name, first, others);
  const [n, ...all] = a;
  console.log(n, all);
  const nums: [...i64[]] = [4, 5];
  console.log(nums, nums.length, JSON.stringify(nums));
  const xs = [7, 8];
  const c: Row = ["c", ...xs, 9];
  console.log(c);
  let t: [i64, ...i64[]] = [1, 2];
  t[1] = 5;
  const [x, y] = t;
  console.log(t, x, y);
}
// case: tuple_rest_json
// expect: [ 'p', 1, 2 ] [ 'q' ]
// expect: expected an array of at least 1 at $
// expect: expected i64 at $[1]
function main(): void throws JsonError {
  console.log(JSON.parse<[string, ...i64[]]>("[\"p\", 1, 2]"), JSON.parse<[string, ...i64[]]>("[\"q\"]"));
  for (const text of ["[]", "[\"x\", \"y\"]"]) {
    try {
      JSON.parse<[string, ...i64[]]>(text);
    } catch (e) {
      console.log(e.message);
    }
  }
}
// case: tuple_rest_instances
// expect: 1 2 2
// expect: [ 2 ]
class C { constructor(public n: i64) {} }
function main(): void {
  const t: [i64, ...C[]] = [1, new C(1), new C(2)];
  const [a, ...r] = t;
  console.log(a, r.length, r[1].n);
  const u: [i64, ...C[]] = [2];
  console.log(u);
}
// case: tuple_rest_past
// panic: index out of bounds: the len is 2 but the index is 2
function main() { const t: [i64, ...i64[]] = [1, 2]; console.log(t[2]); }
// case: tuple_rest_moved
// error: 'b[1]' can't be used here because 'b' was moved
function main() { const b: [string, ...i64[]] = ["b", 1]; const c = b; console.log(c, b[1]); }
// case: tuple_rest_leading
// error: rest elements before the end of a tuple type are not supported yet
function main() { const t: [...i64[], string] = ["a"]; }
// case: tuple_rest_optional
// error: tuple types with both optional and rest elements are not supported yet
function main() { const t: [i64, string?, ...i64[]] = [1]; }
// case: tuple_rest_not_array
// error: a tuple's rest element is an array type, like '...string[]'
function main() { const t: [i64, ...string] = [1]; }
// case: tuple_rest_short
// error: type '[i64, i64, ...string[]]' has at least 2 elements, but this literal has 1
function main() { const t: [i64, i64, ...string[]] = [1]; }
// case: tuple_rest_element_type
// error: type 'i64' is not assignable to type 'string'
function main() { const t: [i64, ...string[]] = [1, 2]; }
// case: tuple_rest_pattern_late
// error: rest patterns after names taken from rest elements whose type doesn't copy are not supported yet
class C { constructor(public n: i64) {} }
function main() { const t: [i64, ...C[]] = [1, new C(1), new C(2)]; const [a, b, ...r] = t; }
// case: tuple_rest_move_out
// error: 't[1]' can't be moved out of its array; use 't[1].clone()' to take a copy, or 'pop()' to take the last element out
class C { constructor(public n: i64) {} }
function main() { const t: [i64, ...C[]] = [1, new C(1)]; const [a, b] = t; }
// case: tuple_rest_fits
// error: argument of type '[i64, i64]' is not assignable to parameter of type '[i64, ...i64[]]'
function f(t: [i64, ...i64[]]): void {}
function main() { const p: [i64, i64] = [1, 2]; f(p); }
// case: tuple_optional_fits_required
// error: type '[i64, i64?]' is not assignable to type '[i64, i64 | null]'
function main() { const a: [i64, i64?] = [1]; const b: [i64, i64 | null] = a; }
// case: tuple_shapes_comptime
// expect: true true 2 2
// expect: 1 1 3 3
function two(): boolean { const t: [i64, i64] = [1, 2]; return t.length === 2; }
function sum(): i64 { const t: [i64, i64] = [1, 2]; let n = 0; for (let i: usize = 0; i < t.length; i++) n++; return n; }
function short(): usize { const t: [i64, string?] = [1]; return t.length; }
function rest(): usize { const t: [string, ...i64[]] = ["a", 1, 2]; return t.length; }
const A = comptime two();
const B = comptime sum();
const S = comptime short();
const R = comptime rest();
function main() { console.log(two(), A, sum(), B); console.log(short(), S, rest(), R); }
// case: tuple_rest_comptime_past
// error: this comptime code panicked: index out of bounds: the len is 1 but the index is 1
function past(): i64 { const t: [string, ...i64[]] = ["c"]; return t[1]; }
const P = comptime past();
function main() { console.log(P); }
// case: tuple_shapes_generic
// expect: 1 3 2
// expect: [ 4 ] 1
// expect: [ 5, 6 ] 2
// expect: [ 4, 5 ]
// expect: [ 'a', 1, 2 ] 3
function first<T>(t: [T, ...T[]]): T { return t[0]; }
function len<T>(t: [string, ...T[]]): usize { return t.length; }
function opt<T>(t: [T, T?]): void { console.log(t, t.length); }
function all<T>(t: [T, ...T[]]): void { console.log(t); }
function tail<T>(t: [string, ...T[]]): void { console.log(t, t.length); }
function main() {
  const p: [i64, ...i64[]] = [1, 2];
  const q: [string, ...boolean[]] = ["b", true];
  const r: [string, ...i64[]] = ["a", 1, 2];
  console.log(first(p), len(r), len(q));
  opt<i64>([4]);
  opt([5, 6]);
  all<i64>([4, 5]);
  tail(["a", 1, 2]);
}
// case: tuple_rest_map
// error: 'new Map' takes an array of key and value pairs, as in 'new Map([["a", 1]])', not '[string, ...i64[]][]'
function main() { const xs: [string, ...i64[]][] = [["a", 1]]; const m = new Map(xs); }
// case: tuple_rest_default
// expect: a 5
// expect: b 1 2 []
function main() {
  const t: [string, ...i64[]] = ["a"];
  const [a, b = 5] = t;
  console.log(a, b);
  const u: [string, ...i64[]] = ["b", 1, 2];
  const [p, q = 0, r = 3, ...more] = u;
  console.log(p, q, r, more);
}
// case: tuple_rest_default_moves
// error: a default past a tuple's fixed elements would take a 'C' out of the tuple's rest when it is there, leaving a hole; destructure without the default, or index it and clone
class C { constructor(public n: i64) {} }
function main() { const u: [i64, ...C[]] = [1]; const [x, y = new C(9)] = u; }
// case: tuple_rest_generic_empty
// expect: [ 'a' ]
// expect: [ 'b', 1 ]
// expect: 1 2
function f<T>(t: [string, ...T[]]): usize { console.log(t); return t.length; }
function main() { console.log(f<i64>(["a"]), f(["b", 1])); }
// case: tuple_length_after_part_moved
// error: 't' can't be used as a whole here because 't[1]' was moved out of it
class C { constructor(public n: i64) {} }
function main() { const t: [i64, C?] = [1, new C(2)]; const [a, b] = t; console.log(t.length, b); }
// case: tuple_rest_assign_const
// error: cannot assign to 't[1]' because 't' is a constant
function main() { const t: [i64, ...i64[]] = [1, 2]; t[1] = 5; }
// case: tuple_rest_moved_out
// error: 't' can't be used as a whole here because 't[1...]' was moved out of it
class C { constructor(public n: i64) {} }
function main() { const t: [i64, ...C[]] = [1, new C(1)]; const [a, ...r] = t; console.log(a, r, t); }
// case: tuple_array_in_union_param
// expect: [ [ 'a', 1 ], [ 'b', 2 ] ]
// expect: s
function f(x: string | [string, i64][]): void { console.log(x); }
function main() { f([["a", 1], ["b", 2]]); f("s"); }
// case: tuple_array_in_union_let
// expect: [ [ 'a', 1 ] ]
function main() {
  const v: string | [string, i64][] = [["a", 1]];
  console.log(v);
}
// case: tuple_or_array_union
// expect: [ 1, 2, 3 ]
// expect: [ 'a', 'b' ]
function g(x: i64[] | [string, string]): void { console.log(x); }
function main() { g([1, 2, 3]); g(["a", "b"]); }
// case: tuple_array_in_union_no_fit
// error: type 'i64' is not assignable to type '[string, i64]'
function f(x: string | [string, i64][]): void { console.log(x); }
function main() { f([1, 2]); }
// case: tuple_readonly
// expect: 1 x [ 1, 'x' ]
// expect: [ 1, 'x' ] [ 1, 'x' ]
// expect: 4 q
// expect: [ 'z', 1 ]
function f(p: readonly [i64, string]): void { console.log(p[0], p[1], p); }
function pair<A, B>(t: readonly [A, B]): [B, A] { return [t[1], t[0]]; }
function main(): void {
  const t: [i64, string] = [1, "x"];
  f(t);
  const r: readonly [i64, string] = t;
  let back: [i64, string] = r;
  back[0] = 2;
  console.log(r, t);
  const q: readonly [i64, string] = [4, "q"];
  const [a, b] = q;
  console.log(a, b);
  console.log(pair([1, "z"]));
}
// case: tuple_readonly_write
// error: cannot assign to 'r[0]' because 'r' is a 'readonly [i64, string]', whose elements are read-only
function main(): void { let r: readonly [i64, string] = [1, "x"]; r[0] = 2; }
// case: tuple_readonly_deep
// error: cannot assign to 'r[0].n' because 'r' is a 'readonly [C, string]', whose elements are read-only
class C { constructor(public n: i64) {} }
function main(): void { let r: readonly [C, string] = [new C(1), "x"]; r[0].n = 3; }
// case: tuple_readonly_lent_mutably
// error: '0' is read-only here, so it can't be lent mutably as '[i64, string]', which could change it
function g(p: Mut<[i64, string]>): void { p[0] = 5; }
function main(): void { let r: readonly [i64, string] = [1, "x"]; g(r); }
// case: tuple_readonly_as_const
// error: cannot assign to 'c[1]' because 'c' is a 'readonly [1, "a"]', whose elements are read-only
function main(): void { let c = [1, "a"] as const; c[1] = "a"; }
// case: tuple_readonly_iterable_entries
// expect: Map(2) { 'a' => 1, 'b' => 2 }
// expect: Map(1) { 'c' => 3 }
// expect: 0
// expect: a 2
class Table<K, V> {
  m: Map<K, V> = new Map();
  constructor(entries?: Iterable<readonly [K, V]>) {
    if (entries !== undefined) for (const [k, v] of entries) this.m.set(k, v);
  }
}
function first<K, V>(xs: Iterable<readonly [K, V]>): K | null { for (const [k, _v] of xs) return k; return null; }
function main(): void {
  const pairs: [string, i64][] = [["a", 1], ["b", 2]];
  console.log(new Table(pairs).m);
  console.log(new Table(new Map<string, i64>([["c", 3]])).m);
  console.log(new Table<string, i64>().m.size);
  const ps: [i64, string][] = [[2, "b"]];
  console.log(first(new Map([["a", 1]])), first(ps));
}
// case: tuple_length_literal
// expect: 2 2 2 2 3
type P = [i64, string];
type L = P["length"];
function count(t: readonly [i64, i64, i64]): 3 { return t.length; }
function main(): void {
  const x: L = 2;
  const t: P = [1, "x"];
  const n: 2 = t.length;
  const u: usize = t.length;
  const w: L = t.length;
  console.log(x, n, u, w, count([1, 2, 3]));
}
// case: tuple_length_literal_optional
// error: type 'usize' is not assignable to type '2'
function main(): void { const t: [i64, string?] = [1]; const n: 2 = t.length; }
// case: tuple_length_literal_wrong
// error: type 'usize' is not assignable to type '3'
function main(): void { const t: [i64, string] = [1, "a"]; const n: 3 = t.length; }
// case: tuple_spread_args
// expect: 1 x
// expect: [ 'x', 1 ]
// expect: 6 6 12
// expect: 6
// expect: 4 null
// expect: 1 x 1 x
// expect: 3
// expect: 7 r
// expect: 1 x
class C { constructor(public n: i64) {} }
function add(a: i64, b: string): void { console.log(a, b); }
function gen<A, B>(a: A, b: B): [B, A] { return [b, a]; }
function sum(...xs: i64[]): i64 { let s = 0; for (const x of xs) s += x; return s; }
function opt(a: i64, b?: string): void { console.log(a, b); }
class P { constructor(public a: i64, public b: string) {} show(x: i64, y: string): void { console.log(this.a, this.b, x, y); } }
function own(a: C, b: C): void { console.log(a.n + b.n); }
function main(): void {
  const t: [i64, string] = [1, "x"];
  add(...t);
  console.log(gen(...t));
  const n: [i64, i64, i64] = [1, 2, 3];
  console.log(sum(...n), sum(0, ...n), sum(...n, ...n));
  const r: [i64, ...i64[]] = [1, 2, 3];
  console.log(sum(...r));
  const o: [i64, string?] = [4];
  opt(...o);
  const p = new P(...t);
  p.show(...t);
  const cs: [C, C] = [new C(1), new C(2)];
  own(...cs);
  const ro: readonly [i64, string] = [7, "r"];
  add(...ro);
  const lent: Ref<[i64, string]> = t;
  add(...lent);
}
// case: tuple_spread_moves
// error: 'cs[0].n' can't be used here because 'cs[0]' was moved
class C { constructor(public n: i64) {} }
function own(a: C, b: C): void { console.log(a.n + b.n); }
function main(): void { const cs: [C, C] = [new C(1), new C(2)]; own(...cs); console.log(cs[0].n); }
// case: tuple_spread_unnamed
// error: a tuple spreads into parameters from a variable, as in 'const t = pair(); f(...t)'
function add(a: i64, b: string): void { console.log(a, b); }
function pair(): [i64, string] { return [1, "x"]; }
function main(): void { add(...pair()); }
// case: tuple_spread_count
// error: expected 1 argument, but got 2
function add(a: i64): void { console.log(a); }
function main(): void { const t: [i64, string] = [1, "x"]; add(...t); }
// case: tuple_spread_type
// error: argument of type 'string' is not assignable to parameter of type 'i64'
function add(a: i64, b: i64): void { console.log(a + b); }
function main(): void { const t: [i64, string] = [1, "x"]; add(...t); }
// case: tuple_for_of
// expect: 1
// expect: 2
// expect: 3
// expect: 1
// expect: a
// expect: true
// expect: 7
// expect: 8
// expect: 7
// expect: 1
// expect: r
// expect: 9
// expect: 10
// expect: 1 1
// expect: 2 1
// expect: 9
// expect: 9
// expect: 5
// expect: 6
// expect: 4
// expect: g
// expect: 1 p
// expect: 2 q
// expect: 7
class C { constructor(public n: i64) {} }
class H { pair: [i64, i64] = [5, 6]; show(): void { for (const x of this.pair) console.log(x); } }
function* gen(t: [string, string]): Generator<string> { for (const x of t) yield x; }
function main(): void {
  const t: [i64, i64, i64] = [1, 2, 3];
  for (const x of t) console.log(x);
  const m: [i64, string, boolean] = [1, "a", true];
  for (const x of m) console.log(x);
  const cs: [C, C] = [new C(7), new C(8)];
  for (const c of cs) console.log(c.n);
  console.log(cs[0].n);
  const o: [i64, string?] = [1];
  for (const x of o) console.log(x);
  const r: [string, ...i64[]] = ["r", 9, 10];
  for (const x of r) console.log(x);
  outer: for (const a of t) {
    for (const b of t) {
      if (b === 2) continue outer;
      if (a === 3) break outer;
      console.log(a, b);
    }
  }
  for (const x of t) { if (x === 2) continue; const x = 9; console.log(x); }
  new H().show();
  for (const s of gen(["4", "g"])) console.log(s);
  const pairs: [[i64, string], [i64, string]] = [[1, "p"], [2, "q"]];
  for (const [k, v] of pairs) console.log(k, v);
  const ro: readonly [i64, i64] = [3, 4];
  let sum = 0;
  for (const x of ro) sum += x;
  console.log(sum);
}
// case: tuple_for_of_comptime
// expect: 6
function total(t: [i64, i64, i64]): i64 { let s = 0; for (const x of t) s += x; return s; }
const T = comptime total([1, 2, 3]);
function main(): void { console.log(T); }
// case: tuple_for_of_mixed_owned
// error: 'for...of' loops over a tuple whose elements differ in type and don't all copy are not supported yet
class C { constructor(public n: i64) {} }
function main(): void { const t: [C, string] = [new C(1), "a"]; for (const x of t) console.log(x); }
// case: tuple_for_of_unnamed
// error: a 'for...of' over a tuple reads it once per element, so it needs a name; give the value one first, as in 'const t = ...;'
function pair(): [i64, i64] { return [1, 2]; }
function main(): void { for (const x of pair()) console.log(x); }
// case: tuple_for_of_borrows
// error: cannot change 'cs' while 'c' borrows 'cs[1]' and is used later
class C { constructor(public n: i64) {} }
function main(): void { let cs: [C, C] = [new C(1), new C(2)]; for (const c of cs) { cs = [new C(3), new C(4)]; console.log(c.n); } }
