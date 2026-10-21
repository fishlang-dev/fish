class Inner {
  v = 7
}

class Base {
  inner = new Inner()
  pick(): Ref<Inner> {
    return this.inner
  }
}

class Derived extends Base {
  swap(this: Mut<this>): i64 {
    const r = super.pick()
    this.inner = new Inner()
    return r.v
  }
}

function main() {
  let d = new Derived()
  print(d.swap())
}
// error: cannot change 'this.inner' while 'r' borrows 'this' and is used later
