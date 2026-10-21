function boom(n: i64): i64 { const big: i64 = 9223372036854775807; return big + n }
function nil(): string { const o: string | null = null; return o! }
function g(): i64 throws string { const a = "a" + 1; try { throw a + "e" } finally { const t = "t" + 2; print(t); boom(1) } }
function main() throws string { const k = "k" + 1; print(g()) }
// expect: t2
// panic: attempt to add with overflow
