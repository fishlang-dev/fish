type P = { x: i64 }

function take(p: P): i64 {
  return p.x
}

function main() {
  const p: P = { x: 1 }
  const r: Ref<P> = p
  take(p)
  print(r.x)
}
// error: cannot move 'p' while 'r' borrows 'p' and is used later
