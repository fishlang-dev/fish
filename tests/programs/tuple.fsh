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
// error: 't.length' can't be used here because 't' was moved
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
