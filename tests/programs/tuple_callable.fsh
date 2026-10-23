// expect: 2
// A tuple's callable element is called through its index.
function dbl(x: i64): i64 { return x * 2; }
function main() { const t: [(x: i64) => i64, i64] = [(x: i64): i64 => x * 2, 1]; console.log(t[0](t[1])); }
