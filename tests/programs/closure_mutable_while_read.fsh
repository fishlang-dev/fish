// A closure can't change a variable another live closure reads.
function main() {
  let x = 0
  const a = () => x
  const b = () => { x++ }
  b()
  print(a())
}
// error: cannot mutably lend 'x' while 'a' borrows 'x' and is used later
