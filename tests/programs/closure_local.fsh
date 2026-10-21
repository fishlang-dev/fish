// An arrow function is a closure: called through the variable holding it, with an expression
// or block body, in plain, generic and method bodies, and nested.
type P = { x: i64; y: i64 }
function local() {
  const add = (a: i64, b: i64) => a + b
  print(add(1, 2))
  const sum = (p: P): i64 => {
    if (p.x > p.y) return p.x - p.y
    return p.x + p.y
  }
  print(sum({ x: 5, y: 2 }), sum({ x: 1, y: 2 }))
  const say = (n: i64) => print(n * 10)
  say(4)
  const inner = (n: i64) => {
    const twice = (m: i64) => m * 2
    return twice(n) + 1
  }
  print(inner(20))
}
interface Shape { area(): i64 }
class Sq { constructor(public s: i64) {} area(): i64 { return this.s * this.s } }
function twice<T extends Shape>(x: T): i64 {
  const dbl = (n: i64) => n * 2
  return dbl(x.area())
}
class C {
  n = 3
  get(): i64 {
    const sq = (k: i64) => k * k
    return sq(this.n)
  }
}
function main() {
  local()
  print(twice(new Sq(3)), new C().get())
}
// expect: 3
// expect: 3 3
// expect: 40
// expect: 41
// expect: 18 9
