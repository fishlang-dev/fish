// mode: release
function amount(): i64 {
  return 64
}

function main() {
  print(1 << amount(), 2 << (amount() + 1))
}
// expect: 1 4
