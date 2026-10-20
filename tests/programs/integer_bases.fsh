function main() {
  print(0xff)
  print(0XFF_FF)
  print(0o17)
  print(0b101)
  print(1_000)
}
// expect: 255
// expect: 65535
// expect: 15
// expect: 5
// expect: 1000
