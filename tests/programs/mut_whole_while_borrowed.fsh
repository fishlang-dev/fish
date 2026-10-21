function main() {
  let n = 1
  let m: Mut<i64> = n
  const r: Ref<i64> = m
  m = 9
  print(r)
}
// error: cannot change 'm' while 'r' borrows 'm' and is used later
