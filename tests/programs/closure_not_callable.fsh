// Only a closure can be called through a variable.
function main() {
  const k = 1
  print(k(2))
}
// error: this expression is not callable: type 'i64' has no call signatures
