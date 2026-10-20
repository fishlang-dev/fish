type Mixed = i64 | boolean | "up"

function check(x: Mixed) {
  print(x === 3, x !== true, x === "up", 3 === x, x === false)
}

function main() {
  check(3)
  check(4)
  check(true)
  check(false)
  check("up")
  const n = 3
  const m: Mixed = n
  print(m === n, m !== n)
}
// expect: true true false true false
// expect: false true false false false
// expect: false false false false false
// expect: false true false false true
// expect: false true true false false
// expect: true false
