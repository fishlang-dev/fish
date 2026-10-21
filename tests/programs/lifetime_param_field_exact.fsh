// A field read through a reference parameter or a type parameter is lent where it lives when
// the argument stores it as exactly the type borrowed.
class Inner {
  v = 4
}

class Mid {
  inner = new Inner()
  pick(): Ref<Inner> {
    return this.inner
  }
}

function fx(p: Ref<{ x: i64 }>): Ref<i64> {
  return p.x
}

function viaT<T extends { x: i64 }>(p: Ref<T>): Ref<i64> {
  return p.x
}

function deep(p: Ref<{ mid: Mid }>): Ref<Inner> {
  return p.mid.pick()
}

function main() {
  const w = { x: 1, y: 2 }
  const h = { mid: new Mid(), n: 3 }
  print(fx(w), viaT(w), deep(h).v)
}
// expect: 1 1 4
