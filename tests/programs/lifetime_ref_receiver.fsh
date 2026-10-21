class Inner {
  v = 0
}

class Mid {
  inner = new Inner()
  pick(): Ref<Inner> {
    return this.inner
  }
}

class Holder {
  mid = new Mid()
}

function main() {
  let h = new Holder()
  const rh: Ref<Holder> = h
  const r = rh.mid.pick()
  h.mid = new Mid()
  print(r.v)
}
// error: cannot change 'h.mid' while 'r' borrows 'h' and is used later
