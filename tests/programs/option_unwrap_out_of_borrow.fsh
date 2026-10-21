// '!' can't move a value out of an Option a reference borrows.
class P { x: i64; constructor(x: i64) { this.x = x } }
function take(p: P): i64 { return p.x }
function steal(o: Ref<P | null>): i64 {
  return take(o!) + take(o!)
}
function steal2(o: Mut<P | null>): i64 {
  const a = o ?? new P(0)
  const b = o ?? new P(0)
  return a.x + b.x
}
function main() {
  let o: P | null = new P(5)
  print(steal(o), steal2(o))
  print(o?.x)
}
// error: can't move a value out of a reference to it, which only borrows it
