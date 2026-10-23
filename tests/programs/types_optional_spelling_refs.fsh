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
