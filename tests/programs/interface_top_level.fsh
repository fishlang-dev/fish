interface Point { x: i64 }

function main() {
  const p: Point = { x: 1 }
  print(p.x)
}
// expect: 1
