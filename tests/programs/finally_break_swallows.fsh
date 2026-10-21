// A finally that breaks swallows an error, and what the error's path moved stays moved.
class O { constructor(public n: i64) {} }
function take(o: O) { print("took") }
function f(n: i64): void throws i64 { if (n > 0) throw n }
function g(c: boolean): void throws i64 {
  const o = new O(1)
  while (true) {
    try { if (c) { take(o); throw 1 } } finally { break }
  }
  print(o.n)
}
function main() throws i64 { g(true) }
// error: 'o.n' can't be used here because 'o' was moved
