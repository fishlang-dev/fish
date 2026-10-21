// A mutable reference stored in `this` stays lent to it, so it can't be used beside it.
class D {
  m: Mut<i64>
  n: i64
  constructor(a: Mut<i64>) {
    this.m = a
    this.n = 0
    const r: Ref<i64> = a
    this.bump()
    print(r)
  }
  bump(this: Mut<this>) { this.m = 41 }
}

function main() {
  let k = 1
  new D(k)
}
// error: cannot use 'a' while 'this' borrows 'a' mutably and is used later
