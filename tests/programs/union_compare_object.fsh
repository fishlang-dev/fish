function main() {
  const p = { a: 1 }
  const x: { a: i64 } | i64 = 1
  print(x === p)
}
// error: comparisons of objects are not supported yet
