class P {
  x = 1
}

type View = { r: Ref<P> }

function main() {
  let p = new P()
  const v: View = { r: p }
  const w = v.clone()
  p.x = 5
  print(w.r.x)
}
// error: cannot change 'p.x' while 'w' borrows 'p' and is used later
