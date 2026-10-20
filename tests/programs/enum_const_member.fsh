enum Mode {
  Off,
  On,
}

function main() {
  const m = Mode.Off
  const n: Mode.Off = m
  print(n)
}
// expect: 0
