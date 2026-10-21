// A closure in a generic function's instance reads its captures as their concrete types.
interface Shape { area(): i64 }
class Sq { constructor(public s: i64) {} area(): i64 { return this.s * this.s } }
class Rect { constructor(public w: i64, public h: i64) {} area(): i64 { return this.w * this.h } }
function g<T extends Shape>(x: T, p: { n: i64 }): i64 {
  const a = (k: i64) => x.area() * k + p.n
  return a(2)
}
function main() {
  const w = { n: 1, m: 5 }
  print(g(new Sq(3), w), g(new Rect(2, 5), { n: 0 }))
}
// expect: 19 20
