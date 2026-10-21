type P = { x: i64 }

function main() {
  let p: P = { x: 1 }
  let q: P = { x: 2 }
  let r: Ref<P> = q
  const sure = true
  if (sure) {
    r = p
  }
  p.x = 3
  print(r.x)
}
// error: cannot change 'p.x' while 'r' borrows 'p' and is used later
