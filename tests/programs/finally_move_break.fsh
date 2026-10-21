// Or where a break through it lands.
class O { constructor(public n: i64) {} }
function take(o: O) { print("took", o.n) }
function main() {
  const o = new O(5)
  while (true) {
    try {
      break
    } finally {
      take(o)
    }
  }
  print("after loop", o.n)
}
// error: 'o.n' can't be used here because 'o' was moved
