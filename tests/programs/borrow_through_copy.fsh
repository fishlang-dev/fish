type P = { x: i64 }

function main() {
  let p: P = { x: 1 }
  const r: Ref<P> = p
  const s = r
  p.x = 2
  print(s.x)
}
// error: cannot change 'p.x' while 'r' and 's' borrow 'p' and are used later
