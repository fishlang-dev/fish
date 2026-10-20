type Point = { x: i64; y: i64 }

function sum(p: Point): i64 {
  return p.x + p.y
}

function main() {
  const p: Point = { x: 1, y: 2 }
  print(sum(p))
  print(p.x)
}
// error: 10:9: error: 'p.x' can't be used here because 'p' was moved
// error: 9:13: note: 'p' moved here: passing it to 'sum' hands it over, as if 'sum' kept it; pass 'p.clone()' to keep a copy
