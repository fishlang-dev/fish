function amount(): i64 {
  return -1
}

function main() {
  print(8 >>> amount())
}
// panic: attempt to shift right with overflow
