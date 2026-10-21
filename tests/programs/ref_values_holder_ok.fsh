// A value holding a reference keeps it borrowed only until its last use, and copies of it
// and values it is moved into keep it borrowed in turn.
class P {
  x = 1
}

type View = { r: Ref<P> }

function main() {
  let p = new P()
  const v: View = { r: p }
  const w = v
  print(w.r.x)
  p.x = 2
  let q = new P()
  let h: View = { r: q }
  print(h.r.x, p.x)
}
// expect: 1
// expect: 1 2
