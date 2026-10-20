type P = { x: i64 }

function id<T>(t: T): i64 {
  return 1
}

function main() {
  const p: P = { x: 1 }
  const r: Ref<P> = p
  print(id(r))
}
// error: references as type arguments are not supported yet
