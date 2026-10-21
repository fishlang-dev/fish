// A borrow lasts until its last use, so the owner is free again after it; calls lend only
// for the call, so the same place can be lent to one call after another.
type P = { x: i64 }

class Counter {
  n: i64 = 0
  bump(this: Mut<this>): i64 {
    this.n = this.n + 1
    return this.n
  }
  get(): i64 {
    return this.n
  }
}

function look(r: Ref<P>): i64 {
  return r.x
}

function poke(m: Mut<P>): i64 {
  return m.x + 1
}

function both(a: Ref<P>, b: Ref<P>): i64 {
  return a.x + b.x
}

function main() {
  let p: P = { x: 1 }
  const r: Ref<P> = p
  const seen = r.x
  p.x = 5
  let m: Mut<P> = p
  const poked = poke(m)
  p.x = 7
  let c = new Counter()
  c.bump()
  const twice = c.bump() + c.get()
  print(seen, poked, look(p), poke(p), both(p, p), twice, p.x)
}
// expect: 1 6 7 8 14 4 7
