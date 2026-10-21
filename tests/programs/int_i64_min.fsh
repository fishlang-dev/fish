// The smallest i64 can be written as a literal.
function main() {
  const a: i64 = -9223372036854775808
  const b: isize = -9223372036854775808
  print(a, b)
}
// expect: -9223372036854775808 -9223372036854775808
