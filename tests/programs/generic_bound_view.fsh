// A generic body is checked against its bounds, and every instance reads through them the
// same way, whatever concrete type it holds.
interface H {
  a: i64 | boolean
}

class Num {
  a: i64 = 3
}

class Flag {
  a = true
}

class Lazy {
  get a(): boolean {
    return false
  }
}

function copied(h: H): i64 {
  const x = h
  const r = x.a
  if (typeof r === "number") return r * 10
  return r ? 1 : 0
}

function bounded<T extends { a: i64 | boolean }>(t: T): i64 {
  const r = t.a
  return typeof r === "number" ? r : -1
}

function passed(h: H): i64 {
  return copied(h.clone()) + bounded2(h)
}

function bounded2<T extends H>(t: T): i64 {
  const r = t.a
  return typeof r === "boolean" ? 100 : 200
}

function wider<T extends { p: { a: i64 } }>(t: T, c: boolean): i64 {
  const q = c ? t.p : { a: 1 }
  return q.a
}

class Box<T> {
  v: T
  constructor(v: T) {
    this.v = v
  }
  get(): T {
    return this.v.clone()
  }
}

function boxed<T extends { a: i64 | boolean }>(t: T): i64 {
  const b = new Box(t)
  const r = b.get().a
  return typeof r === "number" ? r : -1
}

function main() {
  print(copied(new Num()), copied(new Flag()), copied(new Lazy()), copied({ a: 4 }))
  print(bounded({ a: 9 }), bounded({ a: true }), bounded(new Num()))
  print(passed(new Num()), passed(new Lazy()))
  print(wider({ p: { a: 5, b: 6 } }, true), wider({ p: { a: 5, b: 6 } }, false))
  print(boxed({ a: 8 }), boxed({ a: false }), boxed(new Flag()))
}
// expect: 30 1 0 40
// expect: 9 -1 3
// expect: 230 100
// expect: 5 1
// expect: 8 -1 -1
