// A bounded generic class's members read its type parameters through their bounds, in every
// instance of the class.
interface H {
  a: i64 | boolean
}
class F {
  a = false
}
class Holder<T extends H> {
  v: T
  constructor(v: T) {
    this.v = v
  }
  num(): i64 {
    const r = this.v.a
    if (typeof r === "number") return r
    return r ? 1 : 0
  }
  again(): Holder<T> {
    return new Holder(this.v)
  }
}
class Obj<T extends { a: i64 | boolean }> {
  v: T
  constructor(v: T) {
    this.v = v
  }
  num(): i64 {
    const r = this.v.a
    return typeof r === "number" ? r : -1
  }
}
function main() {
  print(new Holder(new F()).num(), new Holder({ a: 6 }).again().num(), new Obj({ a: false }).num(), new Obj({ a: 2 }).num())
}
// expect: 0 6 -1 2
