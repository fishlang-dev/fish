// A run-once closure may be passed to a function that calls it at most once, and a function
// type parameter may be passed on.
class S { constructor(public n: i64) {} }
function take(s: S): i64 { return s.n }
function once(f: () => i64): i64 { return f() }
function maybe(c: boolean, f: () => i64): i64 {
  if (c) return f()
  return 0
}
function main() {
  const s = new S(4)
  print(once(() => take(s)))
  const t = new S(9)
  const g = () => take(t)
  print(maybe(true, g))
}
// expect: 4
// expect: 9
