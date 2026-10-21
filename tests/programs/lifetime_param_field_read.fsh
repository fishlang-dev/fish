// A field read through an object-typed reference parameter lends a copy of the part wanted,
// since the argument may store it differently.
function look(p: Ref<{ o: { x: i64 } }>): i64 {
  const r: Ref<{ x: i64 }> = p.o
  return r.x
}

function main() {
  const w = { a: 1, o: { x: 3, q: 9 }, z: 4 }
  print(look(w))
}
// expect: 3
