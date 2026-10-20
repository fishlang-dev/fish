type Point = { x: i64 }

function take(p: Point): i64 {
  return p.x
}

function main() {
  const p: Point = { x: 1 }
  const sure = true
  const n = sure && take(p) > 0
  print(n, p.x)
}
// error: 'p.x' can't be used here because 'p' was moved
