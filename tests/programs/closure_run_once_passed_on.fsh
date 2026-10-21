// Passing a parameter on counts as calling it again, since how often the next function calls it isn't known here.
class S { constructor(public n: i64) {} }
function take(s: S): i64 { return s.n }
function once(f: () => i64): i64 { return f() }
function pass(f: () => i64): i64 { return once(f) }
function main() {
  const s = new S(4)
  print(pass(() => take(s)))
}
// error: 'pass' may call 'f' more than once, but this closure moves 's' out, so it can run only once
