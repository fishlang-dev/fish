// A reference variable can be pointed at anything declared in its own scope or an enclosing
// one, since that lives as long as it does.
type P = { x: i64 }

function main() {
  const a: P = { x: 1 }
  const b: P = { x: 2 }
  const c: P = { x: 3 }
  let prev: Ref<P> = a
  let cur: Ref<P> = b
  let total = 0
  let i = 0
  while (i < 3) {
    prev = cur
    if (i === 1) {
      cur = a
    } else {
      cur = c
    }
    total = total * 10 + prev.x
    i++
  }
  print(total, cur.x)
}
// expect: 231 3
