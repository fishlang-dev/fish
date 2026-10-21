type P = { x: i64 }

function two(a: Ref<P>, b: Mut<P>): i64 {
  return a.x + b.x
}

function main() {
  let p: P = { x: 1 }
  let r: Mut<P> = p
  print(two(r, r))
}
// error: cannot mutably lend 'r' while 'r' is lent to 'two' for this call
