function amount(): i64 {
  return 64
}

function main() {
  print(1 << amount())
}
// panic: attempt to shift left with overflow
