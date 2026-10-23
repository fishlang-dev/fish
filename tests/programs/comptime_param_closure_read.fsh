// expect: 21 31
// Comptime code in a closure reads its function's comptime parameter.
function outer(comptime n: i64): i64 { const f = (x: i64) => (comptime n * 10) + x; return f(1); }
function main() { console.log(outer(2), outer(3)); }
