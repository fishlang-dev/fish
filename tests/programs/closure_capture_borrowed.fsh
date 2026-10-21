// A closure borrows what it captures while it may still be called.
function main() {
  let x = 1
  const g = () => x
  x = 2
  print(g())
}
// error: cannot change 'x' while 'g' borrows 'x' and is used later
