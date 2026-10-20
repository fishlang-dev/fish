function f(n: i64): i64 {
  switch (n) {
    case 1:
      const inner = 10
      return inner + 1
    case 2: {
      const inner = 20
      return inner
    }
  }
  return 0
}

function main() {
  print(f(1), f(2), f(3))
}
// expect: 11 20 0
