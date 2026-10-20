function main() {
  const x: i64 | boolean = 1
  print(x === "up")
}
// error: this comparison appears to be unintentional because the types 'boolean | i64' and '"up"' have no overlap
