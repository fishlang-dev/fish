// A function calling its parameter in a loop can't take a run-once closure.
class S { constructor(public n: i64) {} }
function take(s: S): i64 { return s.n }
function each(n: i64, f: () => i64) {
  let i = 0
  while (i < n) {
    f()
    i++
  }
}
function main() {
  const s = new S(4)
  each(2, () => take(s))
}
// error: 'each' may call 'f' more than once, but this closure moves 's' out, so it can run only once
