// expect: 21 31
// A closure passes its function's comptime parameter on as a comptime argument.
function inner(comptime n: i64): i64 { return n * 10; }
function outer(comptime n: i64): i64 { const f = (x: i64) => inner(n) + x; return f(1); }
function main() { console.log(outer(2), outer(3)); }
