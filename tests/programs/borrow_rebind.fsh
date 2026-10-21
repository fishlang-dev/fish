// Pointing a reference elsewhere lets go of what it held.
type P = { x: i64 }

function main() {
  let p: P = { x: 1 }
  let q: P = { x: 2 }
  let r: Ref<P> = p
  r = q
  p.x = 3
  print(r.x, p.x)
}
// expect: 2 3
