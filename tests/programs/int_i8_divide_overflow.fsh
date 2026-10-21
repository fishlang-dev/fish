// The smallest i8 divided by -1 overflows.
function main() {
  let a: i8 = -128
  let b: i8 = -1
  print(a / b)
}
// panic: attempt to divide with overflow
