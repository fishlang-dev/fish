class Counter {
  n: i64 = 0
  bump(this: Mut<this>) {
    this.n = this.n + 1
  }
}

class Holder {
  readonly c = new Counter()
}

function main() {
  let h = new Holder()
  h.c.bump()
}
// error: cannot call 'bump' on 'c' because it is a read-only property
