// A closure that only borrows copies.
class O { constructor(public n: i64) {} }
function main() {
  const p = new O(7)
  const keep = () => p.n
  const other = keep
  print(keep(), other())
}
// expect: 7 7
