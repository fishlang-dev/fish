function g<T extends { x: i64 }>(v: T): i64 {
  let w = v
  const r: Ref<i64> = w.x
  w.x = 9
  return r
}

function main() {
  print(g({ x: 1 }))
}
// error: cannot change 'w.x' while 'r' borrows 'w.x' and is used later
