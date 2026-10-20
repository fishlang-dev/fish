// Writes, receivers and method calls through a type parameter reach the concrete value as
// it is stored, while reading through the bound's types.
class Counter {
  n: i64 = 0
  get twice(): i64 {
    return this.n * 2
  }
  bump(this: Mut<this>): i64 {
    this.n = this.n + 1
    return this.n
  }
}

type Holder = { p: { c: Counter } }

interface Source {
  read(): i64 | boolean
  next(): Shape
}

interface Shape {
  sides: i64
}

class Square {
  sides = 4
  extra = 9
}

class Gate {
  read(): boolean {
    return true
  }
  next(): Square {
    return new Square()
  }
}

class Dial {
  read(): i64 {
    return 7
  }
  next(): Square {
    return new Square()
  }
}

function touch(h: Holder): i64 {
  let x = h
  x.p.c.n = 5
  const a = x.p.c.bump()
  return a * 100 + x.p.c.twice
}

function poll(s: Source): i64 {
  const r = s.read()
  const shape = s.next()
  if (typeof r === "number") return r + shape.sides
  return r ? shape.sides : 0
}

function main() {
  const wide = { p: { a: 1, c: new Counter(), z: 2 } }
  print(touch(wide))
  print(poll(new Gate()), poll(new Dial()))
}
// expect: 612
// expect: 4 11
