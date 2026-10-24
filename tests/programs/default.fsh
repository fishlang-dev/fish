// case: default_alias_nullable
// error: a parameter that may be null can have only 'null' as its default so far
function f(a: Option<i64> = 3): i64 { return a ?? 0; } function main() {}
// case: default_before_required
// error: a parameter with a default has to come after the required ones, since Fish calls leave out only trailing arguments
function f(a = 1, b: i64): i64 { return a + b; } function main() {}
// case: default_callback
// error: 'map' always passes its callback this argument, so the parameter can't be optional or have a default
function main() { const ys = [1, 2, 3].map((x, i = 0) => x + i); }
// case: default_closure_null
// error: this parameter has a default, so it takes a value, not null or an Option; leave the argument out to use the default
function main() { const a = (x: i64 = 1) => x; console.log(a(null)); }
// case: default_forms
// expect: 3 4
// expect: none none x
// expect: 1 1
// expect: 1 a1
// Defaults typed by an expected literal, a null default on an Option, an instance default, and
// defaults in a generator and an async function.
class P { n: i64 = 1; }
function f(xs: string[] = [], n: u8 = 3): usize { return xs.length + (n as usize); }
function g(a: string | null = null): string { return a ?? "none"; }
function h(p: P = new P()): i64 { return p.n; }
function* count(n: i64 = 2): Generator<i64> { for (let i = 0; i < n; i++) yield i; }
async function later(s: string = "a" + 1): Promise<string> { return s; }
async function main() {
  console.log(f(), f(["a"]));
  console.log(g(), g(null), g("x"));
  console.log(h(), h(new P()));
  let t = 0;
  for (const x of count()) t += x;
  const s = await later();
  console.log(t, s);
}
// case: default_function_type
// error: defaults on parameters of type '(n: i64) => i64' are not supported yet
function f(cb: (n: i64) => i64 = (n) => n): i64 { return cb(1); } function main() {}
// case: default_later_param
// error: cannot find name 'b'
function f(a: i64 = b, b: i64 = 1): i64 { return a; } function main() { f(); }
// case: default_more
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
// case: default_null_arg
// error: this parameter has a default, so it takes a value, not null or an Option; leave the argument out to use the default
function f(a: i64, b = 1): i64 { return a + b; } function main() { console.log(f(1, null)); }
// case: default_nullable
// error: a parameter that may be null can have only 'null' as its default so far
function f(a: string | null = "d"): string { return a ?? "none"; } function main() {}
// case: default_option_arg
// error: this parameter has a default, so it takes a value, not null or an Option; leave the argument out to use the default
function f(a: i64 = 1): i64 { return a; } function main() { const o: i64 | null = null; console.log(f(o)); }
// case: default_optional
// error: a parameter can't be both optional and have a default; the default already lets callers leave it out
function f(x?: i64 = 1): i64 { return 1; } function main() {}
// case: default_params
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
// case: default_setter
// error: a setter's parameter can't have a default; an assignment always gives it a value
class C { set v(x: i64 = 5) {} } function main() {}
// case: default_stored_closure
// error: a closure with default parameter values can't be stored as a value yet, since calls through it pass every argument; give the parameters no defaults
function main() { const o = { f: (x: i64 = 1) => x }; console.log(o.f(null)); }
// case: default_too_many
// error: expected 1-2 arguments, but got 3
function f(a: i64, b = 1): i64 { return a + b; } function main() { console.log(f(1, 2, 3)); }
// case: default_untyped
// error: parameter 'b' needs a type: its default isn't a literal that says one, so write it, as in 'b: T = ...'
function f(b = []): i64 { return 1; } function main() {}
// case: default_wrong_arg
// error: argument of type '"x"' is not assignable to parameter of type 'i64'
function f(a: i64, b = 1): i64 { return a + b; } function main() { console.log(f(1, "x")); }
// case: default_wrong_type
// error: a default of type '"x"' is not assignable to parameter of type 'i64'
function f(b: i64 = "x"): i64 { return b; } function main() { f(); }
