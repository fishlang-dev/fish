function main() {
  const x: { a: i64 } | { b: i64 } = { a: 1 }
  print(x.a)
}
// error: property 'a' does not exist on type '{ a: i64 } | { b: i64 }'
