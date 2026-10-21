// A way out that doesn't leave the try doesn't reach its finally.
class O { constructor(public n: i64) {} }
function take(o: O) {}
function main() {
  let o = new O(1)
  try {
    for (let i = 0; i < 1; i++) { take(o); break }
    o = new O(2)
  } finally {
    print(o.n)
  }
}
// expect: 2
