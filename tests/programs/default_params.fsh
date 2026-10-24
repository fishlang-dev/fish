// expect: Hello, a 1 Hi, b 2 Yo, c 9 Hello, d 3
// expect: 1 4
// expect: 7 2 21 3
// expect: 11 3
// expect: x1 y2
// Defaults on functions, constructors, methods, statics, arrows and generics, each run only
// when its argument is left out, reading earlier parameters.
class P { n: i64; constructor(n: i64 = 7) { this.n = n; } get(k: i64 = 1): i64 { return this.n * k; } static make(n = 3): P { return new P(n); } }
const calls = new Atomic<i64>(0);
function count(): i64 { return calls.add(1) + 1; }
function greet(name: string, greeting = "Hello", n: i64 = count()): string { return `${greeting}, ${name} ${n}`; }
function span(a: i64, b: i64 = a + 1): i64 { return b - a; }
function first<T>(xs: Ref<T[]>, at: usize = 0): T { return xs[at].clone(); }
function main() {
  console.log(greet("a"), greet("b", "Hi"), greet("c", "Yo", 9), greet("d"));
  console.log(span(5), span(5, 9));
  const p = new P();
  console.log(p.n, new P(2).get(), p.get(3), P.make().n);
  const add = (a: i64, b = 10) => a + b;
  console.log(add(1), add(1, 2));
  console.log(first(["x" + 1, "y"]), first(["x", "y" + 2], 1));
}
