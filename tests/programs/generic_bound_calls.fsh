// A call made inside an instance with one of its type parameters is typed as the definition
// typed it, and values of a type parameter go wherever the concrete type is declared.
interface H {
  a: i64 | boolean
}
class F {
  a = false
}
class G {
  get a(): boolean {
    return true
  }
}
function same<T extends H>(t: T): T {
  return t
}
function inferred<T>(t: T) {
  return t
}
function k<T extends H>(t: T): i64 {
  const r = same(t.clone()).a
  const s = inferred(t).a
  if (typeof r === "boolean") return r ? 1 : 0
  return typeof s === "number" ? r + s : r
}
function e<U extends { a: i64 | boolean }>(u: U): i64 {
  return 1
}
function pass<T extends H>(t: T): i64 {
  return e(same(t))
}
enum Color {
  Red,
  Green,
}
class Box<T> {
  v: T
  constructor(v: T) {
    this.v = v
  }
  get(): T {
    return this.v.clone()
  }
  with(h: H): i64 {
    const r = h.a
    return typeof r === "number" ? r : 0
  }
}
function keep<T>(t: T): Box<T> {
  return new Box(t)
}
function set<T>(t: T, u: T): T {
  let o = { v: t }
  o.v = u
  return o.v
}
function f<T>(t: T): i64 {
  const b = new Box(t)
  return b.with({ a: true })
}
function main() {
  print(k({ a: 5 }), k(new F()), k(new G()), pass(new F()), pass(new G()))
  print(keep(Color.Green).get() === Color.Green, f(1))
  const u: i64 | boolean = 3
  const w: i64 | boolean = true
  print(set(u, w))
}
// expect: 10 0 1 1 1
// expect: true 0
// expect: true
