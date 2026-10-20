function f(n: i64): i64 {
  switch (n) {
    case 1:
      return 1
  }
}

function main() {
  print(f(1))
}
// error: not all code paths return a value
