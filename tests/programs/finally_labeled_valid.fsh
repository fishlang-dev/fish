// A labeled break through a catch, its finally and an outer finally, after which the variable is usable.
class O { constructor(public n: i64) {} }
function take(o: O) { print("took") }
function f(n: i64): void throws i64 { if (n > 0) throw n }
function main() {
  const o = new O(1)
  outer: for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) {
      try {
        try { f(0); if (j === 1) break outer } catch (e) {} finally { print("b") }
      } finally { print("c") }
    }
  }
  print("ok", o.n)
}
// expect: b
// expect: c
// expect: b
// expect: c
// expect: ok 1
