// 'x!' hands over what x holds.
class P { x: i64; constructor(x: i64) { this.x = x } }
function take(p: P) { print(p.x) }
function main() {
  const o: P | null = new P(1)
  take(o!)
  take(o!)
}
// error: 'o' was moved, so it can't be used here
