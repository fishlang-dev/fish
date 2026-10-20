function f(n: i64): i64 {
  switch (n) {
    case 1:
      const inner = 10
    case 2:
      return inner + 1
  }
  return 0
}

function main() {
  print(f(2))
}
// error: 'inner' is declared in another case of this switch, which jumping straight here skips; declare it before the switch
