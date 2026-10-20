type P = { x: i64 }

function main() {
  const a: P = { x: 1 }
  let q: Ref<P> = a
  q = { x: 2 }
  print(q.x)
}
// error: 'q' can only be pointed at a variable, or a field of one
