// expect: 9 t 3
// A type written outside a body, in a generic class's field or before a constructor's
// parameters, names the top-level const, though a body needing it has a local of that name.
const LIMIT: i64 = 5;
class B<T> { v: T; k: typeof LIMIT; constructor(v: T) { this.v = v; this.k = 9; } }
class C { k: i64 = 3 as typeof LIMIT; constructor(LIMIT: string) { } }
function main() { const LIMIT = "t"; const b = new B<string>("s"); const c = new C("z"); console.log(b.k, LIMIT, c.k); }
