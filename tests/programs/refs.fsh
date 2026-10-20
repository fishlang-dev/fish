// A reference parameter borrows its argument, so the caller keeps it; fields, methods,
// getters and Copy values read through references, and clone() copies what one points to.
type P = { x: i64; y: i64 }
type Line = { from: P; to: P }

class Counter {
  n: i64 = 5
  get twice(): i64 {
    return this.n * 2
  }
  plus(k: i64): i64 {
    return this.n + k
  }
}

function sum(p: Ref<P>): i64 {
  return p.x + p.y
}

function length(l: Ref<Line>): i64 {
  return sum(l.to) - sum(l.from)
}

function peek(c: Ref<Counter>, k: Ref<i64>): i64 {
  return c.plus(k) + c.twice + (k > 2 ? 100 : 0)
}

function own(p: P): i64 {
  return p.x
}

function lend<T>(t: Ref<T>): i64 {
  return 1
}

function main() {
  const p: P = { x: 1, y: 2 }
  const l: Line = { from: { x: 0, y: 0 }, to: { x: 3, y: 4 } }
  const c = new Counter()
  const r: Ref<P> = p
  const copy = r.clone()
  print(sum(p), sum(p), sum(r), length(l), peek(c, 3), peek(c, c.n), own(copy), lend(p), p.x)
}
// expect: 3 3 3 7 118 120 1 1 1
