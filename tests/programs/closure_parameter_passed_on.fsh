// A parameter of a function type may be passed on to another.
function once(f: (x: i64) => i64): i64 { return f(1) }
function pass(f: (x: i64) => i64): i64 { return once(f) }
function main() {
  const k = 5
  print(pass((x) => x + k), pass((x) => x * 7))
}
// expect: 6 7
