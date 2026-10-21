// A closure moving a capture into a nested closure moves it out of itself, so it runs once.
class S { constructor(public n: i64) {} }
function take(s: S): i64 { return s.n }
function main() {
  const s = new S(4)
  const mid = () => {
    const inner = () => take(s)
    return inner()
  }
  print(mid())
  print(mid())
  print(take(s))
}
// error: 'mid' was moved, so it can't be used here
