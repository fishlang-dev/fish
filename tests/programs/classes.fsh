type HasX = { x: i64 }

class Point {
  x: i64
  y: i64

  constructor(x: i64, y: i64) {
    this.x = x
    this.y = y
  }
}

class Counter {
  count = 0
  step: i64 = 1
  limit: i64
  origin = new Point(0, 0)

  constructor(limit: i64) {
    this.limit = limit
    // Every field is set, so `this` is usable from here on.
    this.count = this.limit - this.step
  }
}

class Pair {
  constructor(public left: i64, public right: boolean) {}
}

class Empty {}

function shift(p: Point, by: i64): Point {
  let moved = p
  moved.x += by
  return moved
}

function readX(h: HasX): i64 {
  return h.x
}

function main() {
  const p = new Point(1, 2)
  print(p.x, p.y)
  const c = new Counter(10)
  print(c.count, c.step, c.limit, c.origin.y)
  const pair = new Pair(3, true)
  print(pair.left, pair.right)
  const q = shift(p, 5)
  print(q.x, p.x)
  // An instance fits a structural type through its fields.
  print(readX(q))
  let r = new Point(7, 8)
  r.y = 9
  r.x++
  print(r.x, r.y)
  const e = new Empty()
  print(new Point(4, 5).y)
}
// expect: 1 2
// expect: 9 1 10 0
// expect: 3 true
// expect: 6 1
// expect: 6
// expect: 8 9
// expect: 5
