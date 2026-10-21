// A method or getter returning a reference borrows from its object, so a field can be read
// without a clone, through a class or an interface.
class Inner {
  v = 0
}

class Holder {
  inner = new Inner()
  n = 1
  get view(): Ref<Inner> {
    return this.inner
  }
  pick(): Ref<Inner> {
    return this.inner
  }
}

interface Viewer {
  pick(): Ref<Inner>
}

function through(v: Ref<Viewer>): i64 {
  return v.pick().v + 1
}

function main() {
  let h = new Holder()
  h.inner.v = 7
  const a = h.view
  const b = h.pick()
  print(a.v, b.v, through(h), h.view.v)
  h.n = 2
  print(h.n)
}
// expect: 7 7 8 7
// expect: 2
