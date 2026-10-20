class Box {
  n: i64 = 1
}

function main() {
  const a = new Box()
  const b = a
  print(a.n + b.n)
}
// error: 'a.n' can't be used here because 'a' was moved
// error: note: 'a' moved here: 'b' owns it now; use 'a.clone()' to keep a copy
