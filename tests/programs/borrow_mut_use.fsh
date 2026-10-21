type P = { x: i64 }

function main() {
  let p: P = { x: 1 }
  let m: Mut<P> = p
  print(p.x)
  print(m.x)
}
// error: cannot use 'p.x' while 'm' borrows 'p' mutably and is used later
