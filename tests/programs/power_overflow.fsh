// An integer power that overflows panics, as multiplying does.
function main() {
  const b: i32 = 2
  print(b ** 31)
}
// panic: attempt to multiply with overflow
