function f(early: boolean): i64 {
  done: {
    if (early) break done
    return 1
  }
}

function main() {
  print(f(true))
}
// error: not all code paths return a value
