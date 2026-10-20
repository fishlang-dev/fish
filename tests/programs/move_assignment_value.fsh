type Point = { x: i64 }

function main() {
  const p: Point = { x: 1 }
  let b: Point = { x: 2 }
  const a = (b = p)
  print(a.x, b.x)
}
// error: 'b.x' can't be used here because 'b' was moved
