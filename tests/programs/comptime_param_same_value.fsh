// expect: 3
// Recursing with the same comptime value reuses the instance.
function f(comptime n: i64, x: i64): i64 { return x === 0 ? n : f(n, x - 1); }
function main() { console.log(f(3, 4)); }
