function f(n: i64): i64 {
  switch (n) {
    case 1:
      let x = 1
      return x
    case 2:
      const o = { x }
      return o.x
  }
  return 0
}

function main() {
  print(f(2))
}
// error: 'x' is declared in another case of this switch, which jumping straight here skips; declare it before the switch
