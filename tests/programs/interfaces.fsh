interface Named {
  name: i64
}

interface Shape extends Named {
  area(): i64
  scaled(by: i64): i64
}

class Square implements Shape {
  constructor(public name: i64, public side: i64) {}

  area(): i64 {
    return this.side * this.side
  }

  scaled(by: i64): i64 {
    return this.area() * by
  }
}

class Circle {
  constructor(private r: i64) {}

  get name(): i64 {
    return 7
  }

  area(): i64 {
    return 3 * this.r * this.r
  }

  scaled(by: i64): i64 {
    return this.area() * by
  }
}

function main() {
  // An interface describes the value, which keeps its class.
  const s: Shape = new Square(1, 4)
  print(s.name, s.area(), s.scaled(2), s.side)
  const c: Shape = new Circle(2)
  print(c.name, c.area())
  const wide = { name: 9, extra: true }
  const n: Named = wide
  print(n.name, n.extra)
}
// expect: 1 16 32 4
// expect: 7 12
// expect: 9 true
