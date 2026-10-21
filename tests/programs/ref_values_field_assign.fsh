class P {
  x = 1
}

type View = { r: Ref<P> }

function main() {
  let p = new P()
  let q = new P()
  let v: View = { r: q }
  v.r = p
  p.x = 2
  print(v.r.x)
}
// error: cannot change 'p.x' while 'v' borrows 'p' and is used later
