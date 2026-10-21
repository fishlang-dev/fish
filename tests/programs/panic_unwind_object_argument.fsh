function boom(n: i64): i64 { const big: i64 = 9223372036854775807; return big + n }
type P = { a: string; b: string }
function take(p: P, n: i64): i64 { return n }
function main() { take({ a: "a" + 1, b: "b" + 2 }, boom(1)) }
// panic: attempt to add with overflow
