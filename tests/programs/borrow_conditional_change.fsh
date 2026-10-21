type P = { x: i64 }

function main() {
  let p: P = { x: 1 }
  let q: P = { x: 2 }
  const c = true
  const r: Ref<P> = c ? p : q
  p.x = 9
  print(r.x)
}
// error: cannot change 'p.x' while 'r' borrows 'p' and is used later
