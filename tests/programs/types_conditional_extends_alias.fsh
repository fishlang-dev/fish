// expect: y n
// A generic alias may test a placeholder on the extends side; each use decides it.
type HasNull<T> = null extends T ? "y" : "n";
type A = HasNull<i64 | null>;
type B = HasNull<i64>;
function main() { const a: A = "y"; const b: B = "n"; console.log(a, b); }
