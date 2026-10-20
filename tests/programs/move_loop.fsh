type Point = { x: i64 }

function take(p: Point): i64 {
  return p.x
}

function main() {
  const p: Point = { x: 1 }
  let i = 0
  while (i < 3) {
    print(take(p))
    i++
  }
}
// error: 'p' was moved, so it can't be used here (in an earlier pass through this loop)
