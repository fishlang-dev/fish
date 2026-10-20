function main() {
  const x: i64 | boolean = 1
  print(x instanceof i64)
}
// error: the right side of 'instanceof' must be a class
