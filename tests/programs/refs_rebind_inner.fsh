type P = { x: i64 }

function main() {
  const a: P = { x: 1 }
  let q: Ref<P> = a
  let j = 0
  while (j < 2) {
    const z: P = { x: j + 50 }
    q = z
    j++
  }
  print(q.x)
}
// error: 'q' can only be pointed at a variable, or a field of one, declared in its own scope or an enclosing one, so that it lives as long as 'q'
