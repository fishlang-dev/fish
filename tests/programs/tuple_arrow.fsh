// expect: 2 h2
// Arrows taking and giving tuples.
function main() { const h = (n: i64): [i64, string] => [n, "h" + n]; const t = h(2); console.log(t[0], t[1]); }
