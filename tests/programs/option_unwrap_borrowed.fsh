// 'x!' reads x, which a mutable loan forbids.
function main() {
  let o: i64 | null = 1
  const m: Mut<i64 | null> = o
  print(o!)
  m = null
  print(o)
}
// error: cannot use 'o' while 'm' borrows 'o' mutably and is used later
