// error: this is part of a value read through a Dyn, which gives a copy, so writing it would change only the copy; change it through a method
interface HasInner { inner: Inner; }
class Inner { m: Map<string, i64> = new Map(); xs: i64[] = []; o: Map<string, i64> | null = new Map<string, i64>(); t: [Map<string, i64>, i64] = [new Map<string, i64>(), 1]; }
class H { inner: Inner = new Inner(); }
interface HasM { m: Map<string, i64>; }
class M { m: Map<string, i64> = new Map(); }
interface HasOpt { o: Map<string, i64> | null; }
class O { o: Map<string, i64> | null = new Map<string, i64>(); }
interface HasXs { xs: i64[]; }
class X { xs: i64[] = [1]; }
function main() { let h: Dyn<HasXs> = new X(); h.xs[0] = 4; console.log(h.xs[0]); }
