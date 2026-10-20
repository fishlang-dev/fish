function name(n: i64): i64 {
  switch (n) {
    case 1:
      print("one")
    case 2:
      print("one or two")
      break
    default:
      print("other")
    case 3:
      print("three or other")
  }
  return n
}

function sign(n: i64): i64 {
  switch (n > 0) {
    case true:
      return 1
    default:
      return 0
  }
}

function main() {
  name(1)
  name(2)
  name(3)
  name(4)
  let seen = 0
  for (let i = 0; i < 3; i++) {
    switch (i) {
      case 1:
        break
      default:
        seen++
    }
  }
  print("seen", seen)
  // The discriminant runs once, though two cases test it.
  switch (name(7)) {
    case 5:
    case 6:
      print("no")
  }
  switch (2) {}
  print(sign(5), sign(-5))
  switch (1) {
    case 1:
      const inner = 10
    case 2:
      print("shared scope")
  }
}
// expect: one
// expect: one or two
// expect: one or two
// expect: three or other
// expect: other
// expect: three or other
// expect: seen 2
// expect: other
// expect: three or other
// expect: 1 0
// expect: shared scope
