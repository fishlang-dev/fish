class Counter {
  constructor(public n: i64) {}
}

class Holder {
  constructor(public inner: Counter) {}

  get copy(): Counter {
    return this.inner
  }
}

function main() {
  let h = new Holder(new Counter(1))
  h.copy.n = 5
}
// error: can only assign to a variable or a field
