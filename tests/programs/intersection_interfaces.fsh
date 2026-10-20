// `A & B` with an interface is a combined bound: anything with every side's members satisfies
// it, wherever an interface is used.
interface Shape {
  area(): i64
}

interface Named {
  id: i64
}

class Square {
  id = 7
  side = 3
  area(): i64 {
    return this.side * this.side
  }
}

class Rect {
  id = 8
  w = 2
  h = 5
  area(): i64 {
    return this.w * this.h
  }
}

function score(s: Shape & Named): i64 {
  return s.id * 100 + s.area()
}

function scoreAll<T extends Shape & { id: i64 }>(t: T): i64 {
  return t.id + t.area()
}

function pick(big: boolean): Shape & Named {
  return new Square()
}

function main() {
  const s: Shape & Named = new Rect()
  print(score(new Square()), score(new Rect()), scoreAll(new Square()), pick(true).area(), s.id)
}
// expect: 709 810 16 9 8
