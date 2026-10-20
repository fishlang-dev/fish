function deep(p: { a: { x: i64; y: i64 } }): i64 {
  return p.a.y
}

function main() {
  const p = { a: { x: 1, y: 2 } }
  const q = { a: { x: 10 }, y: 20 }
  print(deep(p), q.y, q.a.x)
}
// expect: 2 20 10
