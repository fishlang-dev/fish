// expect: 1 5
// A generic alias may hold its parameter in a union; each use gives it a type.
type Maybe<T> = T | null;
type M = Maybe<i64>;
function main() { const m: M = null; const n: M = 5; console.log(m ?? 1, n ?? 0); }
