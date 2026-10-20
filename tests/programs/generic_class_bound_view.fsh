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
  view(): T {
    return this.v
  }
  get val(): T {
    return this.v
  }
  called(): i64 {
    const r = this.view().a
    if (typeof r === "number") return r
    const s = this.val.a
    return s === r ? 10 : 20
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
  print(new Holder(new F()).called(), new Holder({ a: 3 }).called(), new Holder({ a: true }).called())
}
// expect: 0 6 -1 2
// expect: 10 3 10
