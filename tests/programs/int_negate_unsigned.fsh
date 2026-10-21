// An unsigned value can't be negated.
function main() {
  let a: u8 = 1
  print(-a)
}
// error: 'u8' is unsigned, so it can't be negated
