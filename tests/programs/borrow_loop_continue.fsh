// A reference declared in a loop body is gone by the next pass, however the body is left.
type P = { x: i64 }

function main() {
  let p: P = { x: 0 }
  let total = 0
  let i = 0
  while (i < 4) {
    p.x = i
    i++
    const r: Ref<P> = p
    if (r.x === 1) continue
    if (r.x === 3) break
    total = total + r.x
  }
  outer: for (let j = 0; j < 3; j++) {
    while (true) {
      p.x = j
      const r: Ref<P> = p
      if (r.x === 1) continue outer
      total = total + 10
      break
    }
  }
  print(total, p.x)
}
// expect: 22 2
