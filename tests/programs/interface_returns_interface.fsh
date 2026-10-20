interface Shape {
  area(): i64
}

interface Maker {
  make(): Shape
}

class Square {
  constructor(public side: i64) {}

  area(): i64 {
    return this.side * this.side
  }
}

class Factory implements Maker {
  make(): Shape {
    return new Square(3)
  }
}

function build<M extends Maker>(m: M): i64 {
  return m.make().area()
}

function main() {
  print(build(new Factory()))
}
// expect: 9
