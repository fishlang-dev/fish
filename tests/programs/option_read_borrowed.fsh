// Reading through '!' and '??' on a borrowed Option is fine.
class P { x: i64; constructor(x: i64) { this.x = x } }
function look(o: Ref<P | null>): i64 { return o!.x + (o ?? new P(1)).x }
function num(o: Ref<i64 | null>): i64 { return o! + (o ?? 1) }
function main() {
  let o: P | null = new P(5)
  const d = new P(1)
  let n: i64 | null = 4
  print(look(o), num(n))
}
// expect: 10 8
