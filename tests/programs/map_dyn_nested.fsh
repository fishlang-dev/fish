// error: 'set' changes its Map, and this one is read through a Dyn, which gives a copy; change it through a method
interface HasInner { inner: Inner; }
class Inner { m: Map<string, i64> = new Map(); xs: i64[] = []; o: Map<string, i64> | null = new Map<string, i64>(); t: [Map<string, i64>, i64] = [new Map<string, i64>(), 1]; }
class H { inner: Inner = new Inner(); }
interface HasM { m: Map<string, i64>; }
class M { m: Map<string, i64> = new Map(); }
interface HasOpt { o: Map<string, i64> | null; }
class O { o: Map<string, i64> | null = new Map<string, i64>(); }
function main() { let h: Dyn<HasInner> = new H(); h.inner.m.set("a", 1); console.log(h.inner.m.size); }
