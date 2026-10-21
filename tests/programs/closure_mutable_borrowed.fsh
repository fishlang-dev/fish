// A closure changing a capture borrows it mutably while it may still be called.
function main() {
  let count = 0
  const inc = () => { count++ }
  print(count)
  inc()
}
// error: cannot use 'count' while 'inc' borrows 'count' mutably and is used later
