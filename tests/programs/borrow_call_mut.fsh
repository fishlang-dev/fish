type P = { x: i64 }

function two(a: Mut<P>, b: Ref<P>): i64 {
  return a.x + b.x
}

function main() {
  let p: P = { x: 1 }
  print(two(p, p))
}
// error: cannot use 'p' while 'p' is lent mutably to 'two' for this call
