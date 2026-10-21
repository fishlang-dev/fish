// Two closures can't both change one variable while both may be called.
function main() {
  let x = 0
  const a = () => { x++ }
  const b = () => { x++ }
  a()
  b()
}
// error: cannot mutably lend 'x' while 'a' borrows 'x' mutably and is used later
