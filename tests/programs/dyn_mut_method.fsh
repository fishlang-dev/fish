// error: 'bump' changes its object, and this one is read through a Dyn, which gives a copy; change it through a method
interface HasInner { inner: Inner; }
class Inner { m: Map<string, i64> = new Map(); xs: i64[] = []; o: Map<string, i64> | null = new Map<string, i64>(); t: [Map<string, i64>, i64] = [new Map<string, i64>(), 1]; }
class H { inner: Inner = new Inner(); }
interface HasM { m: Map<string, i64>; }
class M { m: Map<string, i64> = new Map(); }
interface HasOpt { o: Map<string, i64> | null; }
class O { o: Map<string, i64> | null = new Map<string, i64>(); }
interface Box { inner: Inner; touch(this: Mut<this>): void; get(): Inner; }
class B { inner: Inner = new Inner(); touch(this: Mut<this>) { this.inner.m.set("t", 1); this.inner.xs.push(1); this.inner.xs[0] = 5; } get(): Inner { return this.inner.clone(); } }
class C { n: i64 = 0; bump(this: Mut<this>) { this.n++; } } interface HasC { c: C; } class HC { c: C = new C(); } function main() { let d: Dyn<HasC> = new HC(); d.c.bump(); console.log(d.c.n); }
