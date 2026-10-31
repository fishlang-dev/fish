// case: overload_functions
// expect: [  ab] [    ab]
// expect: hello
// expect: 404 not found
// expect: 4 3.5
// expect: point list
// expect: 3 a 6
// Calls checked against the first signature their arguments pass for: by count, by type, with
// void signatures, numeric literals, object and array arguments, generics and rest parameters.
function pad(s: string): string;
function pad(s: string, width: i64): string;
function pad(s: string, width?: i64): string {
  let out = s;
  while ((out.length as i64) < (width ?? 4)) out = " " + out;
  return out;
}
function log(msg: string): void;
function log(code: i64, msg: string): void;
function log(a: string | i64, b?: string): void {
  if (typeof a === "string") console.log(a);
  else console.log(a, b ?? "");
}
function next(x: u8): u8;
function next(x: f64): f64;
function next(x: u8 | f64): u8 | f64 {
  if (typeof x === "number") return x;
  return x;
}
type Point = { x: i64; y: i64 };
function describe(p: Point): string;
function describe(xs: i64[]): string;
function describe(v: Point | i64[]): string { return Array.isArray(v) ? "list" : "point"; }
function id<T>(x: T): T;
function id<T>(x: T, times: i64): T;
function id<T>(x: T, times?: i64): T { return x; }
export function sum(...xs: i64[]): i64;
export function sum(...xs: i64[]): i64 { let t = 0; for (const x of xs) t += x; return t; }
function main() {
  console.log(`[${pad("ab")}] [${pad("ab", 6)}]`);
  log("hello");
  log(404, "not found");
  const small: u8 = next(3);
  const big: f64 = next(2.5);
  console.log(small + 1, big + 1);
  console.log(describe({ x: 1, y: 2 }), describe([1]));
  console.log(id(3), id("a", 2), sum(1, 2, 3));
}
// case: overload_narrowing
// expect: hi! 42
// The signature's return type is what the call gives, narrowed from the implementation's union.
function f(x: string): string;
function f(x: i64): i64;
function f(x: string | i64): string | i64 {
  if (typeof x === "string") return x + "!";
  return x * 2;
}
function main() {
  const a: string = f("hi");
  const b: i64 = f(21);
  console.log(a, b);
}
// case: overload_methods
// expect: 7 n=7 0
// expect: v v
// expect: 1
// Instance methods with a mutable receiver, static methods, a generic class's methods and a
// local class's.
class Box {
  n: i64 = 0;
  add(x: i64): i64;
  add(x: string): string;
  add(this: Mut<this>, x: i64 | string): i64 | string {
    if (typeof x === "string") return x + this.n;
    this.n += x;
    return this.n;
  }
  static of(n: i64): Box;
  static of(s: string): Box;
  static of(v: i64 | string): Box {
    let b = new Box();
    if (typeof v !== "string") b.n = v;
    return b;
  }
}
class Slot<T> {
  v: T;
  constructor(v: T) { this.v = v; }
  get(): T;
  get(n: i64): T;
  get(n: i64 = 0): T { return this.v.clone(); }
}
function main() {
  let b = Box.of(5);
  const n: i64 = b.add(2);
  const s: string = b.add("n=");
  console.log(n, s, Box.of("x").n);
  const c = new Slot<string>("v");
  console.log(c.get(), c.get(1));
  class L { m(x: i64): i64; m(x: string): i64; m(x: i64 | string): i64 { return 1; } }
  console.log(new L().m("a"));
}
// case: overload_comptime
// expect: 8 abab
// A top-level const calling an overloaded function runs its signature while compiling.
const K: i64 = twice(4);
function twice(x: i64): i64;
function twice(x: string): string;
function twice(x: i64 | string): i64 | string {
  if (typeof x === "string") return x + x;
  const n: i64 = x * 2;
  return n;
}
function main() { console.log(K, twice("ab")); }
// case: overload_narrowing_panic
// panic: the implementation returned a value this overload signature doesn't declare
function f(x: i64): string;
function f(x: string): i64;
function f(x: i64 | string): i64 | string { return x; }
function main() { const s: string = f(1); console.log(s); }
// case: overload_no_match
// error: no overload of 'f' takes (boolean); its overloads are (x: i64): string, (x: string): string
function f(x: i64): string;
function f(x: string): string;
function f(x: i64 | string): string { return "a"; }
function main() { console.log(f(true)); }
// case: overload_method_no_match
// error: no overload of 'A.m' takes (boolean); its overloads are (x: i64): i64, (x: string): i64
class A { m(x: i64): i64; m(x: string): i64; m(x: i64 | string): i64 { return 1; } }
function main() { const a = new A(); console.log(a.m(true)); }
// case: overload_param_incompatible
// error: this overload signature is not compatible with its implementation: argument of type 'boolean' is not assignable to parameter of type 'i64 | string'
function f(x: boolean): string;
function f(x: i64 | string): string { return "a"; }
function main() {}
// case: overload_arity_incompatible
// error: this overload signature is not compatible with its implementation: expected 1 argument, but got 2
function f(x: i64, y: i64): string;
function f(x: i64): string { return ""; }
function main() {}
// case: overload_return_incompatible
// error: this overload signature is not compatible with its implementation, which returns 'string', never a 'boolean'
function f(x: i64): boolean;
function f(x: i64 | string): string { return "a"; }
function main() {}
// case: overload_no_implementation
// error: 'f' has no implementation; follow its overload signatures with a 'function f' that has a body
function f(x: i64): string;
function main() {}
// case: overload_method_no_implementation
// error: 'm' has no implementation; follow its overload signatures with a 'm' method that has a body
class A { m(x: i64): i64; n(): void {} }
function main() {}
// case: overload_default
// error: an overload signature can't give a parameter a default; give it in the implementation
function f(x: i64 = 1): string;
function f(x: i64): string { return ""; }
function main() {}
// case: overload_return_type
// error: an overload signature needs its return type, as in 'function f(x: string): string;'
function f(x: i64);
function f(x: i64): string { return ""; }
function main() {}
// case: overload_value
// error: 'f' is overloaded, so it can't be used as a value yet; pass an arrow that calls it, as in '(x) => f(x)'
function f(x: i64): string;
function f(x: i64): string { return ""; }
function main() { const g = f; }
// case: overload_spread
// error: spreading arguments into the overloaded 'f' isn't supported yet; pass them one by one
function f(...xs: i64[]): i64;
function f(...xs: i64[]): i64 { return 0; }
function main() { const xs = [1, 2]; f(...xs); }
// case: overload_async
// error: overloads of async functions and generators are not supported yet
async function f(x: i64): Promise<string>;
async function f(x: i64): Promise<string> { return ""; }
function main() {}
// case: overload_static_mixed
// error: the overload signatures of 'm' have to be static or not as its implementation is
class A { static m(x: i64): i64; m(x: i64 | string): i64 { return 1; } }
function main() {}
// case: overload_constructor
// error: constructor overloads are not supported yet
class A { constructor(x: i64); constructor(x: i64 | string) {} }
function main() {}
// case: overload_interface
// error: 'f' is declared twice in interface 'I'; method overloads in interfaces aren't supported yet, so give each signature its own name
interface I { f(x: i64): i64; f(x: string): string; }
function main() {}
// case: overload_literal_types
// expect: one many 1 s
// Numeric and boolean literal-type signatures are taken by a literal of their value.
function f(x: 1): "one";
function f(x: i64): "many";
function f(x: i64): "one" | "many" { if (x === 1) return "one"; return "many"; }
function g(x: true): i64;
function g(x: boolean): string;
function g(x: boolean): i64 | string { if (x) return 1; return "s"; }
function main() { console.log(f(1), f(2), g(true), g(false)); }
// case: overload_literal_range
// expect: small big big
// A numeric literal out of a signature's range or sign falls through to the next one.
function h(x: u8): "small";
function h(x: i64): "big";
function h(x: u8 | i64): "small" | "big" { if (typeof x === "number") return "big"; return "big"; }
function k(x: u8): string;
function k(x: i64): string;
function k(x: u8 | i64): string { return "small"; }
function main() { const a: "big" = h(300); const b: "big" = h(-1); console.log(k(3), a, b); }
// case: overload_override
// expect: s! 2
// expect: B
// expect: 11
// expect: q4
// A subclass overriding an overloaded method, with or without signatures of its own, and calls
// through super and this.
class A {
  m(x: i64): i64;
  m(x: string): string;
  m(x: i64 | string): i64 | string { return x; }
}
class B extends A {
  m(x: i64): i64;
  m(x: string): string;
  m(x: i64 | string): i64 | string { if (typeof x === "string") return x + "!"; return x + 1; }
}
class C extends A {
  m(x: i64 | string): i64 | string { return "B"; }
}
class D extends A {
  m(x: i64): i64;
  m(x: string): string;
  m(x: i64 | string): i64 | string { const r: i64 = super.m(1); return r + 10; }
}
class E extends A {
  k(): string { const s: string = super.m("q"); const n: i64 = this.m(4); return s + n; }
}
function main() {
  const b = new B();
  const s: string = b.m("s");
  const n: i64 = b.m(1);
  console.log(s, n);
  console.log(new C().m(1));
  const d: i64 = new D().m(1);
  console.log(d);
  console.log(new E().k());
}
// case: overload_arrows
// expect: S 2
// An arrow with typed parameters takes the signature whose function type takes them.
function f(cb: (x: i64) => i64): i64;
function f(cb: (x: string) => string): string;
function f<F>(cb: F): i64 | string { return "S"; }
function g(cb: (x: i64) => i64): i64;
function g(cb: (x: i64) => i64, n: i64): string;
function g(cb: (x: i64) => i64, n?: i64): i64 | string { return cb(1); }
function main() {
  const r: string = f((s: string) => s);
  const n: i64 = g((x) => x + 1);
  console.log(r, n);
}
// case: overload_literal_return
// error: this overload signature is not compatible with its implementation: it returns '"a"', narrower than the implementation's 'string', which isn't a union whose members it could be narrowed to; give the implementation a union return type, as in '"a" | ...'
function f(x: i64): "a";
function f(x: string): string;
function f(x: i64 | string): string { return "zzz"; }
function main() { console.log(f(1)); }
// case: overload_destructured
// error: no overload of 'f' takes (boolean); its overloads are ({ x: i64 }): i64, (s: string): i64
function f({ x }: { x: i64 }): i64;
function f(s: string): i64;
function f(v: { x: i64 } | string): i64 { return 1; }
function main() { console.log(f(true)); }
// case: overload_narrowing_panic_release
// mode: release
// panic: the implementation returned a value this overload signature doesn't declare
function f(x: i64): string;
function f(x: string): i64;
function f(x: i64 | string): i64 | string { return x; }
function main() { const s: string = f(1); console.log(s); }
// case: overload_narrowing_comptime
// error: this comptime code panicked: the implementation returned a value this overload signature doesn't declare
function f(x: i64): string;
function f(x: string): i64;
function f(x: i64 | string): i64 | string { return x; }
const K: string = f(1);
function main() { console.log(K); }
