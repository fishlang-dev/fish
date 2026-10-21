// A closure passed to a call holds what it captures until the call ends.
function both(f: () => i64, m: Mut<i64>): i64 {
  m = 5
  return f()
}
function main() {
  let x = 1
  const g = () => x
  print(both(g, x))
}
// error: cannot mutably lend 'x' while 'g' borrows 'x' and is used later
