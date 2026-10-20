type X = { a: i64 } | i64
type Y = { b: i64 } | i64

function main() {
  const o = { a: 1, b: 2 }
  const x: X = o
  const y: Y = o
  print(x === y)
}
// error: comparisons of objects are not supported yet
