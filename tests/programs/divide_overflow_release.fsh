// mode: release
// MIN / -1 has no i64 result, so it panics in release builds too.
function main() {
  const min = -9223372036854775807 - 1
  print(min / -1)  // panic: attempt to divide with overflow
}
