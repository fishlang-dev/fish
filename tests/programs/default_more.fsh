// expect: 20 30 4
// expect: 0 1 x 7 2 1 x 7 1 2 y 7 0 3 z 9
// expect: 3 7 8
// expect: 1 4
// Defaults in derived constructors before super, arguments typed by the parameter, null
// defaults through aliases and Options, and a closure with a default called with and without it.
class B { n: i64; constructor(n: i64) { this.n = n; } }
class D extends B { constructor(k: i64 = 2) { super(k * 10); } }
class E extends B { constructor(k: i64, j: i64 = k) { super(k * j); } }
type Opts = { a: i64; b: string };
function f(xs: u8[] = [], o: Opts = { a: 1, b: "x" }, n: u8 = 7): string { return `${xs.length} ${o.a} ${o.b} ${n}`; }
type N = i64 | null;
function g(a: N = null, b: Option<i64> = null): i64 { return (a ?? 1) + (b ?? 2); }
function main() {
  console.log(new D().n, new D(3).n, new E(2).n);
  console.log(f(), f([1, 2]), f([3], { a: 2, b: "y" }), f([], { a: 3, b: "z" }, 9));
  console.log(g(), g(5), g(null, 7));
  const a = (x: i64 = 1) => x;
  console.log(a(), a(4));
}
