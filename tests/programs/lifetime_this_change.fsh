class Inner {
  v = 0
}

class Holder {
  inner = new Inner()
  pick(): Ref<Inner> {
    return this.inner
  }
}

function main() {
  let h = new Holder()
  const b = h.pick()
  h.inner = new Inner()
  print(b.v)
}
// error: cannot change 'h.inner' while 'b' borrows 'h' and is used later
