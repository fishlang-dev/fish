// A change through '!' would change a copy.
class P {
  x: i64
  constructor(x: i64) { this.x = x }
  bump(this: Mut<this>) { this.x += 1 }
}
function main() {
  const o: P | null = new P(1)
  o!.bump()
  print(o?.x)
}
// error: can't call 'bump' through '!', which would change a copy
