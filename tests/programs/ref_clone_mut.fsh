class P {
  x = 1
}

type View = { m: Mut<P> }

function main() {
  let p = new P()
  const v: View = { m: p }
  const w = v.clone()
}
// error: can't clone a value holding a mutable reference ('Mut')
