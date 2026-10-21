// A closure made for a call lends what it captures for the call.
function both(f: () => i64, m: Mut<i64>): i64 {
  m = 5
  return f()
}
function main() {
  let x = 1
  print(both(() => x, x))
}
// error: cannot mutably lend 'x' while 'x' is lent to 'both' for this call
