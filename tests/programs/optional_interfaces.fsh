// case: optional_interfaces_functions
interface Shape { area(): f64; name(): string; }
class Sq { constructor(public s: f64) {} area(): f64 { return this.s * this.s; } name(): string { return "sq"; } }
class Circle { constructor(public r: f64) {} area(): f64 { return 3.0 * this.r * this.r; } name(): string { return "circle"; } }
function total(x?: Shape): f64 {
  if (x === undefined) return 0;
  console.log(x.name(), x);
  return x.area();
}
function describe(x?: Shape): string {
  return x === undefined ? "nothing" : x.name();
}
function pass(x?: Shape): string { return describe(x); }
function main(): void {
  console.log(total(new Sq(2)), total(new Circle(1)), total(), total(undefined), total(null));
  const maybe: Sq | null = new Sq(3);
  const none: Circle | null = null;
  console.log(describe(maybe), describe(none), describe());
  console.log(pass(new Circle(2)), pass(), pass(undefined));
}
// expect: sq Sq { s: 2 }
// expect: circle Circle { r: 1 }
// expect: 4 3 0 0 0
// expect: sq nothing nothing
// expect: circle nothing nothing

// case: optional_interfaces_iterable
function sum(xs?: Iterable<i64>): i64 {
  let t = 0;
  if (xs !== undefined) for (const x of xs) t += x;
  return t;
}
function first<T>(xs?: Iterable<T>): T | null {
  if (xs === undefined) return null;
  for (const x of xs) return x;
  return null;
}
function main(): void {
  console.log(sum([1, 2, 3]), sum(new Set<i64>([4, 5])), sum());
  console.log(first(["a", "b"]) ?? "none", first<string>() ?? "none", first<i64>(undefined) ?? 0);
}
// expect: 6 9 0
// expect: a none 0

// case: optional_interfaces_members
interface Shape { area(): f64; }
class Sq { constructor(public s: f64) {} area(): f64 { return this.s * this.s; } }
class Canvas {
  total = 0.0;
  add(this: Mut<this>, x?: Shape): void { if (x !== undefined) this.total += x.area(); }
  static measure(x?: Shape): f64 { return x === undefined ? -1 : x.area(); }
}
class Bag<K> {
  items: K[] = [];
  constructor(entries?: Iterable<K>) {
    if (entries !== undefined) for (const e of entries) this.items.push(e);
  }
  get size(): usize { return this.items.length; }
}
class Pairs<K, V> {
  private table = new Map<K, V>();
  constructor(entries?: Iterable<[K, V]>) {
    if (entries !== undefined) for (const [k, v] of entries) this.table.set(k, v);
  }
  get size(): usize { return this.table.size; }
}
function main(): void {
  let c = new Canvas();
  c.add(new Sq(2));
  c.add();
  console.log(c.total, Canvas.measure(new Sq(3)), Canvas.measure());
  console.log(new Bag<i64>([1, 2, 3]).size, new Bag<string>().size, new Bag<i64>(new Set<i64>([7])).size);
  const m = new Map<string, i64>([["a", 1], ["b", 2]]);
  const list: [string, i64][] = [["x", 1]];
  console.log(new Pairs<string, i64>(m).size, new Pairs<string, i64>(list).size, new Pairs<string, i64>().size);
}
// expect: 4 9 -1
// expect: 3 0 1
// expect: 2 1 0

// case: optional_interfaces_generic
interface Shape { area(): f64; }
class Sq { constructor(public s: f64) {} area(): f64 { return this.s * this.s; } }
function scaled<T>(k: T, x?: Shape): T {
  if (x !== undefined) console.log(x.area());
  return k;
}
function viaDyn(x?: Dyn<Shape>): f64 { return x === undefined ? -1 : x.area(); }
function main(): void {
  console.log(scaled(1, new Sq(2)), scaled("a"), scaled<boolean>(true, undefined));
  const d: Dyn<Shape> = new Sq(5);
  console.log(viaDyn(d), viaDyn());
}
// expect: 4
// expect: 1 a true
// expect: 25 -1

// case: optional_interfaces_release
// mode: release
interface Shape { area(): f64; }
class Sq { constructor(public s: f64) {} area(): f64 { return this.s * this.s; } }
function measure(x?: Shape): f64 { return x === undefined ? -1 : x.area(); }
function sum(xs?: Iterable<i64>): i64 {
  let t = 0;
  if (xs !== undefined) for (const x of xs) t += x;
  return t;
}
function main(): void {
  console.log(measure(new Sq(3)), measure(), sum([1, 2]), sum());
}
// expect: 9 -1 3 0

// case: optional_interfaces_generator
function sum(xs?: Iterable<i64>): i64 {
  let t = 0;
  if (xs !== undefined) for (const x of xs) t += x;
  return t;
}
function* count(n: i64): Generator<i64> {
  for (let i = 1; i <= n; i++) yield i;
}
function main(): void {
  console.log(sum(count(4)));
}
// error: unions holding generators are not supported yet

// case: optional_interfaces_unnarrowed
interface Shape { area(): f64; }
function measure(x?: Shape): f64 { return x.area(); }
function main(): void {
  console.log(measure());
}
// error: 'null | Shape' has no method 'area'

// case: optional_interfaces_unsatisfied
interface Shape { area(): f64; }
function measure(x?: Shape): f64 { return x === undefined ? -1 : x.area(); }
function main(): void {
  console.log(measure(3));
}
// error: argument of type 'i64' is not assignable to parameter of type 'Shape'

// case: optional_interfaces_default
interface Shape { area(): f64; }
class Sq { constructor(public s: f64) {} area(): f64 { return this.s * this.s; } }
function measure(x: Shape = new Sq(1)): f64 { return x.area(); }
function main(): void {
  console.log(measure());
}
// error: defaults on parameters of type 'Shape' are not supported yet

// case: optional_interfaces_passed_on
interface Shape { area(): f64; }
class Sq { constructor(public s: f64) {} area(): f64 { return this.s * this.s; } }
function g(y: Shape): f64 { return y.area(); }
function a(x?: Shape): f64 { if (x !== undefined) return g(x); return -1; }
function b(x?: Shape): f64 { return x === undefined ? -2 : g(x!); }
function main(): void {
  console.log(a(new Sq(2)), a(), b(new Sq(3)), b());
}
// expect: 4 -1 9 -2

// case: optional_interfaces_bang
interface Shape { area(): f64; }
class Sq { constructor(public s: f64) {} area(): f64 { return this.s * this.s; } }
function b(x?: Shape): f64 { return x!.area(); }
function main(): void {
  console.log(b(new Sq(2)));
  console.log(b());
}
// expect: 4
// panic: called `Option::unwrap()` on a `None` value

// case: optional_interfaces_bang_release
// mode: release
interface Shape { area(): f64; }
class Sq { constructor(public s: f64) {} area(): f64 { return this.s * this.s; } }
function b(x?: Shape): f64 { return x!.area(); }
function main(): void {
  console.log(b(new Sq(2)));
  console.log(b());
}
// expect: 4
// panic: called `Option::unwrap()` on a `None` value
