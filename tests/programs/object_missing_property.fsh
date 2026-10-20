function main() {
  const p: { x: i64 } = { y: 1 }
}
// error: type '{ y: i64 }' is not assignable to type '{ x: i64 }'
