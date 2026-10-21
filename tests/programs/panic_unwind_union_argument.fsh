function boom(n: i64): i64 { const big: i64 = 9223372036854775807; return big + n }
function take(p: string | i64, n: i64): i64 { return n }
function main() { const s = "s" + 1; take(s + "u", boom(1)) }
// panic: attempt to add with overflow
