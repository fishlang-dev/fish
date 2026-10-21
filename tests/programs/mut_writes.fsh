// A mutable reference changes what it points to: fields, compound assignments, `++`, whole
// values and mutating methods, through parameters, variables and fields.
class Counter {
  n = 0
  bump(this: Mut<this>) {
    this.n = this.n + 1
  }
}

type P = { x: i64; c: Counter }
type H = { m: Mut<P> }

function poke(m: Mut<P>) {
  m.x = 5
  m.x += 1
  m.x++
  m.c.bump()
}

function inc(k: Mut<i64>) {
  k = k + 1
  k += 10
  k++
}

class Q {
  x = 0
  c = new Counter()
}

function reset(m: Mut<Q>) {
  let fresh = new Q()
  fresh.x = 100
  m = fresh
}

function main() {
  let p: P = { x: 0, c: new Counter() }
  poke(p)
  let n = 1
  inc(n)
  let q: P = { x: 0, c: new Counter() }
  let h: H = { m: q }
  h.m.x = 3
  h.m.c.bump()
  print(p.x, p.c.n, n, q.x, q.c.n)
  let r = new Q()
  r.c.bump()
  reset(r)
  let local: Mut<i64> = n
  local = 40
  print(r.x, r.c.n, n)
}
// expect: 7 1 13 3 1
// expect: 100 0 40
