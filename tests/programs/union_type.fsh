type Dir = "up" | "down"
type Point = { x: i64; y: i64 }

class Tag {
  constructor(public id: i64) {}
}

function flip(d: Dir): Dir {
  return d
}

function either(big: boolean): i64 | boolean {
  if (big) return 100
  return false
}

function main() {
  let x: i64 | boolean = 1
  print(x)
  x = true
  print(x)
  const d: Dir = "down"
  print(d, flip("up"))
  const bit: 0 | 1 = 1
  print(bit)
  print(either(true), either(false))
  // A union holds objects and instances as payloads.
  let shape: Point | Tag | "none" = { x: 1, y: 2 }
  shape = new Tag(7)
  shape = "none"
  // A narrower union widens into a wider one.
  const narrow: "up" | i64 = 5
  const wide: "up" | "down" | i64 | boolean = narrow
  print(wide)
  const words: "up" | "down" | i64 | boolean = d
  print(words, "and", x, "done")
}
// expect: 1
// expect: true
// expect: down up
// expect: 1
// expect: 100 false
// expect: 5
// expect: down and true done
