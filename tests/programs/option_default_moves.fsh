// 'a ?? b' hands over what a holds.
class P { x: i64; constructor(x: i64) { this.x = x } }
function take(p: P) { print(p.x) }
function main() {
  const o: P | null = new P(1)
  take(o ?? new P(2))
  take(o ?? new P(3))
}
// error: 'o' was moved, so it can't be used here
