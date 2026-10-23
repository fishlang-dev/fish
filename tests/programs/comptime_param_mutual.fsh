// expect: 3
// Mutual recursion passing a comptime value on reuses the instances.
function a(comptime n: i64, x: i64): i64 { return x <= 0 ? n : b(n, x - 1); }
function b(comptime n: i64, x: i64): i64 { return a(n, x - 1); }
function main() { console.log(a(3, 4)); }
