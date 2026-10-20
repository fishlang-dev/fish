interface Shape {
  area(): i64
}

interface Visitor {
  visit(s: Shape): i64
}

class Square {
  constructor(public side: i64) {}

  area(): i64 {
    return this.side * this.side
  }
}

class Doubler implements Visitor {
  visit(s: Shape): i64 {
    return s.area() * 2
  }
}

function run(v: Visitor): i64 {
  return v.visit(new Square(3))
}

function main() {
  print(run(new Doubler()), new Doubler().visit(new Square(2)))
}
// expect: 18 8
