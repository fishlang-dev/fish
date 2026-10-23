// expect: 12
// A tuple literal passed to a closure taking a tuple.
function main() { const g = (x: [i64, i64]): i64 => x[0] * x[1]; console.log(g([3, 4])); }
