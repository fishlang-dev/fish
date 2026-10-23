// expect: 2 5
// `{ a?: T }` and `{ a: T | null }` are one type to interface methods, intersections and nested
// unions, as before optional fields were remembered.
type A = { a?: i64 };
type B = { a: i64 | null };
interface H { f(x: A): i64; }
interface J { f(x: B): i64; }
class C implements H { f(x: B): i64 { return 2; } }
type HJ = H & J;
type U = { x: { a?: i64 } } | { x: { a: i64 | null } };
function use(h: H): i64 { return h.f({ a: 1 }); }
function nested(u: U): i64 { return u.x.a ?? 5; }
function main() { console.log(use(new C()), nested({ x: {} })); }
