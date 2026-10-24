// error: this is part of a value read through a Dyn, which gives a copy, so lending it mutably would change only the copy; change it through a method
interface HasInner { inner: Inner; }
class Inner { m: Map<string, i64> = new Map(); xs: i64[] = []; o: Map<string, i64> | null = new Map<string, i64>(); t: [Map<string, i64>, i64] = [new Map<string, i64>(), 1]; }
class H { inner: Inner = new Inner(); }
interface HasM { m: Map<string, i64>; }
class M { m: Map<string, i64> = new Map(); }
interface HasOpt { o: Map<string, i64> | null; }
class O { o: Map<string, i64> | null = new Map<string, i64>(); }
interface Box { inner: Inner; touch(this: Mut<this>): void; get(): Inner; }
class B { inner: Inner = new Inner(); touch(this: Mut<this>) { this.inner.m.set("t", 1); this.inner.xs.push(1); this.inner.xs[0] = 5; } get(): Inner { return this.inner.clone(); } }
interface HasM2 { m: Map<string, i64>; } class M2 { m: Map<string, i64> = new Map<string, i64>(); } function g(m: Mut<Map<string, i64>>) { m.set("a", 1); } function main() { let d: Dyn<HasM2> = new M2(); g(d.m); console.log(d.m.size); }
