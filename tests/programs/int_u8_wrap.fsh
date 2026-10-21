// In release builds a u8 wraps.
// mode: release
function main() {
  let a: u8 = 255
  print(a + 1)
}
// expect: 0
