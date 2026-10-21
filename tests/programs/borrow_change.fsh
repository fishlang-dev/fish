type P = { x: i64 }

function main() {
  let p: P = { x: 1 }
  const r: Ref<P> = p
  p.x = 2
  print(r.x)
}
// error: cannot change 'p.x' while 'r' borrows 'p' and is used later
// error: note: 'p' is lent here, so it can't change or move until the borrow's last use
