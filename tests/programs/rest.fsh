// case: rest_arrow
// error: rest parameters on arrow functions are not supported yet
function main() { const f = (...xs: i64[]) => xs.length; }
// case: rest_forms
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
// case: rest_function_type
// error: rest parameters in function types are not supported yet
type F = (...xs: i64[]) => usize; function main() {}
// case: rest_interface
// error: rest parameters in interface methods are not supported yet
interface Sum { add(...xs: i64[]): i64; } function main() {}
// case: rest_not_last
// error: a rest parameter has to be the last one, since it takes every argument after those before it
function f(...xs: i64[], y: i64): i64 { return y; } function main() {}
// case: rest_parameter
function f(...xs: i64) {}

function main() {}
// error: a rest parameter takes an array of the values, as in '...xs: i64[]'
// error: function f(...xs: i64) {}
// error:                   ^^^
// case: rest_params
// expect: 0 1 6 6 16 3
// expect: a: b:x,y1 c:p,q
// expect: 2 1 0
// expect: 2 1 3 0
// Rest parameters on functions, generic functions, constructors, methods and statics, filled by
// trailing arguments and spread arguments.
class P { n: i64; constructor(n: i64) { this.n = n; } }
function sum(...xs: i64[]): i64 { let t = 0; for (const x of xs) t += x; return t; }
function tagged(label: string, ...rest: string[]): string { return label + ":" + rest.join(","); }
function count<T>(...xs: T[]): usize { return xs.length; }
class Bag { items: P[]; constructor(...items: P[]) { this.items = items; } add(...more: P[]): usize { return more.length; } static of(...ns: i64[]): usize { return ns.length; } }
function main() {
  const xs = [1, 2, 3];
  console.log(sum(), sum(1), sum(1, 2, 3), sum(...xs), sum(0, ...xs, 10), xs.length);
  console.log(tagged("a"), tagged("b", "x", "y" + 1), tagged("c", ...["p", "q"]));
  console.log(count(1, 2), count("a"), count<string>());
  const b = new Bag(new P(1), new P(2));
  console.log(b.items.length, b.add(new P(3)), Bag.of(1, 2, 3), new Bag().items.length);
}
// case: rest_too_few
// error: expected at least 1 argument, but got 0
function f(a: i64, ...xs: i64[]): usize { return xs.length; } function main() { console.log(f()); }
