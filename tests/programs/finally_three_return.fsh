// A return through three levels carries their moves to the outermost finally.
class O { constructor(public n: i64) {} }
function take(o: O) { print("took") }
function f(n: i64): void throws i64 { if (n > 0) throw n }
function g(): i64 {
  const o = new O(1)
  try {
    try { try { f(0); if (o.n > 0) { take(o); return 1 } } finally { print("a") } } catch (e) {} finally { print("b") }
  } finally { print("c", o.n) }
  return 0
}
function main() {}
// error: 'o.n' can't be used here because 'o' was moved
