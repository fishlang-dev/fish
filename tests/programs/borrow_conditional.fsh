// A reference to a `?:` of places borrows whichever place it chooses.
type P = { x: i64 }

function look(r: Ref<P>): i64 {
  return r.x
}

function main() {
  const p: P = { x: 1 }
  const q: P = { x: 2 }
  const c = true
  const r: Ref<P> = c ? p : q
  print(r.x, look(c ? q : p), p.x, q.x)
}
// expect: 1 2 1 2
