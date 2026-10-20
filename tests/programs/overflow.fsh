// Debug builds panic on overflow; output printed before the panic still appears.
function main() {
  const max = 9223372036854775807
  print("before")  // expect: before
  print(max + 1)   // panic: overflow.fsh:5:9:
}                  // panic: attempt to add with overflow
