type I = { v: i64 }

class C {
  inner: I = { v: 1 }
  get peek(): i64 {
    return this.inner.v
  }
  run(this: Mut<this>): i64 {
    let m: Mut<C> = this
    const k = this.peek
    return m.inner.v + k
  }
}

function main() {
  let c = new C()
  print(c.run())
}
// error: cannot use 'this' while 'm' borrows 'this' mutably and is used later
