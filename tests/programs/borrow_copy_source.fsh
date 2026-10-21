function main() {
  let w = { x: 1, y: 2 }
  const r: Ref<{ x: i64 }> = w
  w.x = 5
  print(r.x)
}
// error: cannot change 'w.x' while 'r' borrows 'w' and is used later
