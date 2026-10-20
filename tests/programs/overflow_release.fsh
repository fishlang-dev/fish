// mode: release
// Release builds wrap on overflow.
function main() {
  const max = 9223372036854775807
  print(max + 1, -max - 2, max * 2)  // expect: -9223372036854775808 9223372036854775807 -2
}
