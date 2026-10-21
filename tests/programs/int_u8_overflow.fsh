// A u8 overflows past 255.
function main() {
  let a: u8 = 255
  print(a + 1)
}
// panic: attempt to add with overflow
