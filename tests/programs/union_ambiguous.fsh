function main() {
  const p = { x: 1, y: 2 }
  const u: { x: i64 } | { y: i64 } = p
}
// error: fits more than one member
