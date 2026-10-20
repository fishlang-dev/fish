enum E {
  A = 1,
  B = 1,
  C = 2,
}

function main() {
  const u: i64 | boolean = 1
  const one: 1 = 1
  print(u === E.B, u === one, u !== one)
  switch (u) {
    case E.B:
      print("matched E.B")
  }
  // Two unions compare by the members they hold.
  const a: i64 | boolean = 2
  const b: 1 | 2 = 2
  const c: E = E.B
  const d: E = E.A
  print(a === b, c === d, c === E.A, c === 1, c !== E.C)
  switch (c) {
    case 1:
      print("one")
      break
    default:
      print("not one")
  }
  const n: i64 = 2
  switch (n) {
    case E.C:
      print("two")
  }
  const word = "a"
  switch (word) {
    case "a":
      print("a")
  }
}
// expect: true true false
// expect: matched E.B
// expect: true true true true true
// expect: one
// expect: two
// expect: a
