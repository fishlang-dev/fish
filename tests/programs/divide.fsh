// case: divide_by_zero
function main() {
  const zero = 0
  print(1 / zero)  // panic: attempt to divide by zero
}
// case: divide_overflow_release
// mode: release
// MIN / -1 has no i64 result, so it panics in release builds too.
function main() {
  const min = -9223372036854775807 - 1
  print(min / -1)  // panic: attempt to divide with overflow
}
