// A finally that returns carries what its way in moved into the next finally.
class O { constructor(public n: i64) {} }
function take(o: O) { print("took") }
function f(n: i64): void throws i64 { if (n > 0) throw n }
function g(c: boolean): i64 throws i64 {
  const o = new O(1)
  try {
    try { if (c) { take(o); f(1) } } finally { return 1 }
  } finally { print(o.n) }
}
function main() throws i64 { print(g(true)) }
// error: 'o.n' can't be used here because 'o' was moved
