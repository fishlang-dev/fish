// A mutable reference needs a `let`, and lends itself as a shared one.
type P = { x: i64 }

function look(p: Ref<P>): i64 {
  return p.x
}

function lookMut(p: Mut<P>): i64 {
  return look(p) + 1
}

function main() {
  let p: P = { x: 4 }
  print(lookMut(p), lookMut(p), look(p))
}
// expect: 5 5 4
