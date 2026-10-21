type P = { x: i64 }

function two(a: Mut<P>, b: Mut<P>): i64 {
  return a.x + b.x
}

function f(m: Mut<P>): i64 {
  return two(m, m)
}

function main() {
  let p: P = { x: 1 }
  print(f(p))
}
// error: cannot use 'm' while 'm' is lent mutably to 'two' for this call
