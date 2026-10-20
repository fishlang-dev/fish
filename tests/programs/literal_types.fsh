type Up = "up"

function direction(d: Up): Up {
  return d
}

function one(): 1 {
  return 1
}

function main() {
  const d: Up = "up"
  const n: 1 = 1
  const no: false = false
  const m: -5 = -5
  print(d, n, no, m, direction("up"))
  // A literal reads as its base type.
  const sum = n + one() + m
  print(sum, !no, n === 1)
  let total: i64 = n
  total += m
  print(total)
  const s = "literal"
  print(s === "literal")
}
// expect: up 1 false -5 up
// expect: -3 true true
// expect: -4
// expect: true
