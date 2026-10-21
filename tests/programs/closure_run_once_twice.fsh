// A function calling its parameter twice can't take a run-once closure.
class S { constructor(public n: i64) {} }
function take(s: S): i64 { return s.n }
function twice(f: () => i64): i64 { return f() + f() }
function main() {
  const s = new S(4)
  print(twice(() => take(s)))
}
// error: 'twice' may call 'f' more than once, but this closure moves 's' out, so it can run only once
