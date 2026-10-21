class P {
  x = 1
}

type View = { r: Ref<P> }

class Owner {
  p = new P()
  get view(): View {
    return { r: this.p }
  }
}

function main() {
  let o = new Owner()
  const v = o.view
  o.p.x = 42
  print(v.r.x)
}
// error: cannot change 'o.p.x' while 'v' borrows 'o' and is used later
