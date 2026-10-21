// A parameter with a function type takes any closure fitting it, typing an arrow's unwritten
// parameters; an arrow may take fewer parameters than the type passes.
function apply(f: (x: i64) => i64, v: i64): i64 {
  return f(v) + f(v + 1)
}
function each(n: i64, f: (i: i64, last: boolean) => void) {
  let i = 0
  while (i < n) {
    f(i, i === n - 1)
    i++
  }
}
class Acc {
  total = 0
  run(f: (x: i64) => i64): i64 { return f(this.total + 1) }
}
function main() {
  const base = 10
  print(apply((x) => x * 2, 3), apply((x: i64) => x + base, 1))
  const sq = (x: i64) => x * x
  print(apply(sq, 4))
  each(3, (i) => print(i))
  each(2, (i, last) => print(i, last))
  const typed: (n: i64) => i64 = (n) => n - 1
  print(typed(5), new Acc().run((x) => x + base))
}
// expect: 14 23
// expect: 41
// expect: 0
// expect: 1
// expect: 2
// expect: 0 false
// expect: 1 true
// expect: 4 11
