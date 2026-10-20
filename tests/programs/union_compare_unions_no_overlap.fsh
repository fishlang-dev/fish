function main() {
  const a: i64 | boolean = 1
  const b: "x" | "y" = "x"
  print(a === b)
}
// error: no overlap
