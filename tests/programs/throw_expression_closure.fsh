// Closures can't throw yet.
function main() throws i64 {
  const g = (x: i64) => x > 0 ? x : throw 1
}
// error: closures that throw are not supported yet
