interface Measured {
  size(): i64
}

class Point {
  constructor(public x: i64, public y: i64) {}

  size(): i64 {
    return this.x + this.y
  }
}

class Box<T> {
  count = 1

  constructor(public value: T) {}

  get(): T {
    return this.value.clone()
  }

  set(this: Mut<this>, value: T) {
    this.value = value
    this.count++
  }
}

class Sized<T extends Measured> {
  constructor(public item: T) {}

  total(): i64 {
    return this.item.size() * 10
  }
}

type Labelled<T> = { label: i64; box: Box<T> }

function unbox<T>(b: Box<T>): T {
  return b.get()
}

function main() {
  let a = new Box(5)
  a.set(6)
  const b = new Box<Point>(new Point(1, 2))
  print(a.get(), a.count, b.get().y, b.value.size())
  print(unbox(a), unbox(new Box(true)))
  const l: Labelled<i64> = { label: 1, box: new Box(9) }
  print(l.label, l.box.get())
  print(new Sized(new Point(3, 4)).total())
  const nested = new Box(new Box(7))
  print(nested.get().get())
}
// expect: 6 2 2 3
// expect: 6 true
// expect: 1 9
// expect: 70
// expect: 7
