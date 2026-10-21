class Inner {
  v = 0
}

class Mid {
  inner = new Inner()
  pick(): Ref<Inner> {
    return this.inner
  }
}

class A {
  mid = new Mid()
  a = 1
}

class B {
  mid = new Mid()
  b = 2
  c = 3
}

function main() {
  let u: A | B = new A()
  const r = u.mid.pick()
  u = new B()
  print(r.v)
}
// error: cannot change 'u' while 'r' borrows 'u.mid' and is used later
