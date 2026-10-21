function boom(n: i64): i64 { const big: i64 = 9223372036854775807; return big + n }
function nil(): string { const o: string | null = null; return o! }
function f(): string { const a = "a" + 1; try { return a + "r" } finally { const t = "t" + 2; print(t); boom(1) } }
function main() { const k = "k" + 1; print(f()) }
// expect: t2
// panic: attempt to add with overflow
