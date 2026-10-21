// A closure returns the number type of the function type it meets.
function main() {
  const f: (x: u8) => boolean = (x) => x > 1
  const g: () => u8 = () => { return 5 }
  print(f(2), g())
}
// expect: true 5
