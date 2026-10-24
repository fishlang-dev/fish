// case: shift_negative
function amount(): i64 {
  return -1
}

function main() {
  print(8 >>> amount())
}
// panic: attempt to shift right with overflow
// case: shift_overflow
function amount(): i64 {
  return 64
}

function main() {
  print(1 << amount())
}
// panic: attempt to shift left with overflow
// case: shift_overflow_release
// mode: release
function amount(): i64 {
  return 64
}

function main() {
  print(1 << amount(), 2 << (amount() + 1))
}
// expect: 1 4
