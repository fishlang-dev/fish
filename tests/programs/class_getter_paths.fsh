class Counter {
  constructor(public n: i64) {}

  bump(this: Mut<this>): i64 {
    this.n++
    return this.n
  }

  read(): i64 {
    return this.n
  }
}

class Holder {
  constructor(public inner: Counter) {}

  get copy(): Counter {
    return this.inner.clone()
  }
}

function main() {
  let h = new Holder(new Counter(1))
  // The getter returns a copy, so bumping it leaves the holder alone.
  print(h.copy.bump(), h.copy.read(), h.inner.n)
}
// expect: 2 1 1
