function boom(n: i64): i64 { const big: i64 = 9223372036854775807; return big + n }
function nil(): string { const o: string | null = null; return o! }
class C {
  s: string
  constructor(s: string) { this.s = s }
  set v(x: string) { this.s = x + boom(1) }
}
function main() { let c = new C("x" + 1); c.v = "v" + 2; print(c.s) }
// panic: attempt to add with overflow
