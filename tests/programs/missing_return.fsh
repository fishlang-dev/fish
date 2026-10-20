function f(): i64 {  // error: not all code paths return a value
  print(1)
}

function main() {
  f()
}
