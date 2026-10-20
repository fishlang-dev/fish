// A generic class member's parameter typed with the class's type parameter reads through its
// bound in every instance, as at the definition, whatever object type the class holds.
interface H {
  a: i64 | boolean
}

class Holder<T extends H> {
  v: T
  n: i64
  constructor(v: T) {
    const r = v.a
    this.n = typeof r === "number" ? r : -1
    this.v = v
  }
  mk(t: T): i64 {
    const r = t.a
    return typeof r === "number" ? r : -1
  }
  wrapped(o: { w: T }): i64 {
    const r = o.w.a
    return typeof r === "number" ? r : -2
  }
}

function g<U extends H>(u: U): i64 {
  return new Holder(u).mk(u)
}

function main() {
  const h = new Holder({ a: true })
  print(h.n, h.mk({ a: false }), h.wrapped({ w: { a: false } }), g({ a: true }))
  const k = new Holder({ a: 4 })
  print(k.n, k.mk({ a: 6 }), k.wrapped({ w: { a: 8 } }), g({ a: 9 }))
}
// expect: -1 -1 -2 -1
// expect: 4 6 8 9
