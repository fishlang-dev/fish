// A raise through two finallies reaches the catch with what both moved.
class O { constructor(public n: i64) {} }
function take(o: O) { print("took") }
function f(n: i64): void throws i64 { if (n > 0) throw n }
function main() {
  const o = new O(1)
  try {
    try { try { if (o.n > 0) { take(o); f(1) } } finally { print("a") } } finally { print("b") }
  } catch (e) { print(o.n) }
}
// error: 'o.n' can't be used here because 'o' was moved
