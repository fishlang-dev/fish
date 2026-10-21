class P {
  x = 1
}

type View = { r: Ref<P> }

function id(v: View): View {
  return v
}

function main() {
  let a = new P()
  let h: View = { r: a }
  h = id(h)
  a.x = 5
  print(h.r.x)
}
// error: cannot change 'a.x' while 'h' borrows 'a' and is used later
