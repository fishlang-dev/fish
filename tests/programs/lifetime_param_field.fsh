function inner(p: Ref<{ o: { x: i64 } }>): Ref<{ x: i64 }> {
  return p.o
}

function main() {}
// error: can't return a reference to a temporary or a copy
