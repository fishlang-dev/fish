// In release builds an integer power wraps.
// mode: release
function main() {
  const b: i32 = 2
  print(b ** 31)
}
// expect: -2147483648
