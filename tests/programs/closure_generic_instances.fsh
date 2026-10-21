// Closures in generic instances: held captures laid out as their concrete types, closures
// passed on from generic bodies and from function-typed parameters, `this` in a nested closure,
// and narrowing a capture inside its closure.
interface Shape0 { area(): i64 }
class Sq0 { constructor(public s: i64) {} area(): i64 { return this.s * this.s } }
function g0<T extends Shape0>(x: T): i64 {
  const a = move () => x.area()
  return a()
}
function apply1(f: () => i64): i64 {
  const g = () => f() + 1
  return g()
}
function applyMove1(f: () => i64): i64 {
  const g = move () => f() + 1
  return g()
}
function apply2(f: (k: i64) => i64): i64 { return f(2) }
function g2<T>(x: T): i64 {
  return apply2((k) => k + 1)
}
interface Shape3 { area(): i64 }
class Sq3 { constructor(public s: i64) {} area(): i64 { return this.s * this.s } }
function apply3(f: () => i64): i64 { return f() }
function g3<T extends Shape3>(x: T): i64 {
  return apply3(() => x.area())
}
function apply4(f: () => i64): i64 { return f() }
function outer4(f: () => i64): i64 {
  return apply4(() => f() * 2)
}
class C5 {
  n = 3
  get(): i64 {
    const mid = () => {
      const inner = () => this.n * 2
      return inner()
    }
    return mid()
  }
}
type P6 = { kind: "p"; x: i64 }
type Q6 = { kind: "q"; z: i64 }
function f6(u: P6 | Q6): i64 {
  const g = () => {
    if (u.kind === "p") return u.x
    return 0
  }
  return g()
}
function f7(u: i64 | boolean): i64 {
  const g = () => typeof u === "number" ? u + 1 : 0
  return g()
}
function main() {
  print(g0(new Sq0(3)))
  let x = 10
  print(apply1(() => x), applyMove1(() => x * 2))
  print(g2(true))
  print(g3(new Sq3(3)))
  let y = 7
  print(outer4(() => y))
  print(new C5().get())
  print(f6({ kind: "p", x: 5 }))
  print(f7(5))
}
// expect: 9
// expect: 11 21
// expect: 3
// expect: 9
// expect: 14
// expect: 6
// expect: 5
// expect: 6
