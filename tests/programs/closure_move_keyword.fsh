// A `move` closure takes over what it captures.
class O { constructor(public n: i64) {} }
function main() {
  const p = new O(7)
  const keep = move () => p.n
  print(p.n)
}
// error: 'p.n' can't be used here because 'p' was moved
