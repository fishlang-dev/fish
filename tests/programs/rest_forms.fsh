// expect: 1 4
// expect: 0 0 2
// expect: 2 s1,s1 2
// expect: 3 2 a1
// expect: 2
// Rest parameters filled through super(...), an inherited constructor, after an optional
// parameter, in generic functions with and without trailing arguments, and on a generic class.
class A { xs: i64[]; constructor(...xs: i64[]) { this.xs = xs; } }
class B extends A { constructor(a: i64) { super(a); } }
class C extends A {}
class P { n: i64; constructor(n: i64) { this.n = n; } }
class Bag<T> { items: T[]; constructor(...items: T[]) { this.items = items; } }
function f(a?: i64, ...xs: i64[]): usize { return xs.length; }
function dup<T>(xs: Ref<T[]>): T[] { return [...xs, ...xs]; }
function wrap<T>(x: T, ...more: T[]): T[] { return [x, ...more]; }
function main() {
  console.log(new B(7).xs.length, new C(1, 2, 3, 4).xs.length);
  console.log(f(), f(5), f(5, 6, 7));
  const a = [new P(1)];
  console.log(dup(a).length, dup(["s" + 1]).join(), dup([1]).length);
  console.log(wrap(1, 2, 3).length, wrap(new P(1), new P(2)).length, wrap("a" + 1).join());
  console.log(new Bag<string>("a" + 1, "b").items.length);
}
