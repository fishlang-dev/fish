function main() {
  let x: i64 | boolean = 1
  if (typeof x === "number") {
    print(x + 1)
  }
  x = true
}
// error: operator '+' cannot be applied to types 'boolean | i64' and 'i64'
