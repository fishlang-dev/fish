// A way out that doesn't leave the try doesn't reach its finally.
class O { constructor(public n: i64) {} }
function take(o: O) {}
function f(n: i64): void throws i64 { if (n > 0) throw n }
function main() {
  let o = new O(1)
  try {
    try { take(o); f(1); o = new O(3) } catch (e) { o = new O(2) }
  } finally {
    print(o.n)
  }
}
// expect: 2
