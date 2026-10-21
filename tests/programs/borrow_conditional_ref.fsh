// A `?:` of a reference and a place lends the place, or passes the reference on, in either
// order, in a let or as an argument.
type P = { x: i64 }

function look(r: Ref<P>): i64 {
  return r.x
}

function main() {
  const p: P = { x: 1 }
  const q: P = { x: 2 }
  const a: Ref<P> = p
  const c = true
  const r: Ref<P> = c ? q : a
  const s: Ref<P> = c ? a : q
  print(r.x, s.x, look(c ? a : q), look(c ? q : a))
}
// expect: 2 1 1 2
