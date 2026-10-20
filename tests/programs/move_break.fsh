type Point = { x: i64 }

function take(p: Point): i64 {
  return p.x
}

function main() {
  const p: Point = { x: 1 }
  outer: while (true) {
    while (true) {
      take(p)
      break outer
    }
  }
  print(p.x)
}
// error: 'p.x' can't be used here because 'p' was moved
