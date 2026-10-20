// Objects move when handed over and Copy values never do; reads borrow, and assigning a
// moved variable gives it a value again.
type Point = { x: i64; y: i64 }

enum Color {
  Red,
  Green,
}

class Counter {
  n: i64 = 1
  get twice(): i64 {
    return this.n * 2
  }
  next(): i64 {
    return this.n + 1
  }
}

function sum(p: Point): i64 {
  return p.x + p.y
}

function keep(p: Point): Point {
  return p
}

function main() {
  const n = 3
  const c = Color.Green
  const u: 1 | 2 = 2
  print(n + n, c === Color.Green, c === Color.Red, u + u)
  let p: Point = { x: 1, y: 2 }
  const total = sum(p)
  p = { x: 10, y: 20 }
  const q = keep(p)
  p = q.clone()
  const r = { at: p, n }
  const k = new Counter()
  print(total, q.x, r.at.y, k.next(), k.next(), k.twice, k.twice, typeof k === "object")
}
// expect: 6 true false 4
// expect: 3 10 20 2 2 2 2 true
