// A finally that gives a moved variable a new value makes it usable where its way out lands.
class O { constructor(public n: i64) {} }
function take(o: O) {}
function f(n: i64): void throws i64 { if (n > 0) throw n }
function main() {
  let o = new O(1)
  try {
    try { take(o); f(1) } finally { o = new O(2) }
  } catch (e) { print(o.n) }
}
// expect: 2
