function boom(n: i64): i64 { const big: i64 = 9223372036854775807; return big + n }
class C { s: string; constructor(s: string) { this.s = s } m(n: i64): string { return this.s + boom(n) } }
function get(): C | null { return new C("q" + 1) }
function main() {
  print(get()?.m(1))
}
// panic: attempt to add with overflow
