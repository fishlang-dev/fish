// Readonly fields are read freely and set only while their class is constructed; a copy into
// a writable type is its own value, so it can be written.
type Point = { readonly x: i64; y: i64 }

interface Named {
  readonly id: i64
}

class Counter {
  readonly start: i64 = 10
  readonly step: i64
  constructor(readonly label: i64, step: i64) {
    this.step = step
  }
  next(n: i64): i64 {
    return this.start + this.step * n + this.label
  }
}

class Tag {
  id = 3
}

function idOf(n: Named): i64 {
  return n.id
}

function main() {
  let p: Point = { x: 1, y: 2 }
  p.y = 5
  let q: { x: i64; y: i64 } = p
  q.x = 9
  const c = new Counter(100, 2)
  print(p.x, p.y, q.x, c.next(3), c.label, idOf(new Tag()), idOf({ id: 4 }))
}
// expect: 1 5 9 116 100 3 4
