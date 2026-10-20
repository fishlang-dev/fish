type Point = { x: i64 }

function take(p: Point): i64 {
  return p.x
}

function main() {
  const p: Point = { x: 1 }
  const n = 1
  switch (n) {
    case 1:
      take(p)
    case 2:
      print(p.x)
      break
  }
}
// error: 'p.x' can't be used here because 'p' was moved
