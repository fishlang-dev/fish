type Count = i64
type Total = Count
type Flag = boolean

function twice(n: Count): Total {
  return n * 2
}

function main() {
  const ready: Flag = true
  const n: Total = twice(21)
  print(n, ready)
}
// expect: 42 true
