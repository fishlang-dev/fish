type P = { x: i64 }

function main() {
  let p: P = { x: 0 }
  let m: Mut<P> = p
  const r: Ref<i64> = m.x
  m.x = 2
  print(r)
}
// error: cannot change 'm.x' while 'r' borrows 'm.x' and is used later
