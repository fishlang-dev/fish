interface Shape {
  side: i64
  area(): i64
}

class Square {
  constructor(public side: i64) {}

  area(): i64 {
    return this.side * this.side
  }
}

function identity<T>(x: T): T {
  return x
}

function first<A, B>(a: A, b: B): A {
  const kept = identity(a)
  return kept
}

function pair<T>(x: T, y: T): { left: T; right: T } {
  return { left: x, right: y }
}

function total<S extends Shape>(a: S, b: S): i64 {
  return a.area() + b.area() + a.side
}

function getX<P extends { x: i64 }>(p: P): i64 {
  return p.x * 10
}

function main() {
  print(identity(5), identity(true), identity<i64>(7))
  print(first(1, false), first(true, 2))
  const p = pair(3, 4)
  print(p.left, p.right)
  print(total(new Square(2), new Square(3)))
  print(getX({ x: 1 }), getX({ x: 2, y: 3 }), getX(identity({ x: 4, z: true })))
  const s = identity(new Square(5))
  print(s.area())
}
// expect: 5 true 7
// expect: 1 true
// expect: 3 4
// expect: 15
// expect: 10 20 40
// expect: 25
