function inner(p: Ref<{ o: { x: i64 } }>): Ref<{ x: i64 }> {
  return p.o
}

function main() {
  const w = { a: 1, o: { x: 3, q: 9 } }
  print(inner(w).x)
}
// error: can't return a reference to a temporary or a copy
