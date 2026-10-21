class P {
  x = 1
}

type View = { r: Ref<P> }

function view(p: Ref<P>): View {
  return { r: p }
}

function main() {
  let p = new P()
  const v = view(p)
  p.x = 2
  print(v.r.x)
}
// error: cannot change 'p.x' while 'v' borrows 'p' and is used later
