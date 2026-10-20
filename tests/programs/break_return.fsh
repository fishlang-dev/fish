function f(): i64 {
  while (true) {
    break
  }
}

function main() {
  print(f())
}
// error: not all code paths return a value
