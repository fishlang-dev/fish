// expect: 1 0 5
// A top-level const leaving out an optional field holds it empty, and comptime code reads it so.
type U = { a?: i64; b: i64 };
const X: U = { b: 1 };
const Y = X.a ?? 5;
function main() { console.log(X.b, X.a ?? 0, Y); }
