function f(skip: boolean): i64 {
  do {
    if (skip) continue
    return 1
  } while (false)
}

function main() {
  print(f(true))
}
// error: not all code paths return a value
