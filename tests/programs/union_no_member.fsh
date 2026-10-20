function main() {
  const x: i64 | boolean = { a: 1 }
}
// error: type '{ a: i64 }' is not assignable to type 'boolean | i64'
