type Point = { x: i64 }

function take(p: Point): i64 {
  return p.x
}

function main() {
  const p: Point = { x: 1 }
  for (let i = 0; i < 3; i++) {
    print(p.x)
    if (i === 1) {
      continue
    }
    take(p)
  }
}
// error: 'p.x' can't be used here because 'p' was moved (in an earlier pass through this loop)
