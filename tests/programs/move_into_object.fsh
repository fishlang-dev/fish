type Point = { x: i64; y: i64 }

function main() {
  const p: Point = { x: 1, y: 2 }
  const line = { p, q: { x: 0, y: 0 } }
  print(line.p.x, p.y)
}
// error: 'p.y' can't be used here because 'p' was moved
// error: note: 'p' moved here into the new object; use 'p.clone()' to keep a copy
