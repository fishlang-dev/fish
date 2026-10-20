// A reference to an interface or an object type borrows any value that satisfies it, with
// one instance per type borrowed, and the owner keeps it.
interface Shape {
  side: i64
  area(): i64
}

class Square {
  side = 3
  area(): i64 {
    return this.side * this.side
  }
}

class Rect {
  w = 2
  h = 5
  get side(): i64 {
    return this.w
  }
  area(): i64 {
    return this.w * this.h
  }
}

function describe(s: Ref<Shape>): i64 {
  return s.area() * 10 + s.side
}

function xOf(p: Ref<{ x: i64 }>): i64 {
  return p.x
}

class Spot {
  x = 7
  label = 1
}

function main() {
  const sq = new Square()
  const r = new Rect()
  const wide = { x: 4, y: 5, z: 6 }
  const spot = new Spot()
  print(describe(sq), describe(r), describe(sq), xOf(wide), xOf(spot), xOf({ x: 9 }), wide.y, spot.label)
}
// expect: 93 102 93 4 7 9 5 1
