// mode: release
// A zero divisor panics in release builds too.
function main() {
  const zero = 0
  print(1 % zero)  // panic: attempt to calculate the remainder with a divisor of zero
}
