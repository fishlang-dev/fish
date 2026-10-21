// A field is lent where it lives when the argument stores it as exactly the type borrowed,
// even when an object on the way there is stored wider.
function fx<T extends { o: { x: i64 } }>(p: Ref<T>): Ref<i64> {
  return p.o.x
}

function main() {
  const w = { o: { x: 3, q: 9 } }
  print(fx(w))
}
// expect: 3
