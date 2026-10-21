type P = { x: i64 }

function look(a: Ref<P>): i64 {
  return a.x
}

function main() {
  let p: P = { x: 1 }
  let r: Mut<P> = p
  let s: Mut<P> = r
  print(look(r), look(s))
}
// error: cannot use 'r' while 's' borrows 'r' mutably and is used later
