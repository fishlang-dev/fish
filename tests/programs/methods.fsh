class Counter {
  count = 0

  constructor(public step: i64) {}

  value(): i64 {
    return this.count
  }

  next(): i64 {
    return this.value() + this.step
  }

  bump(this: Mut<this>) {
    this.count += this.step
  }

  reset(this: Mut<this>): i64 {
    const old = this.count
    this.count = 0
    this.bump()
    return old
  }

  peek(this: Ref<this>): i64 {
    return this.count
  }

  static starting(step: i64): Counter {
    let c = new Counter(step)
    c.bump()
    return c
  }
}

class Holder {
  constructor(public counter: Counter) {}
}

function make(): Counter {
  return new Counter(5)
}

function main() {
  let c = new Counter(2)
  c.bump()
  c.bump()
  print(c.value(), c.next(), c.peek())
  print(c.reset(), c.value())
  let h = new Holder(new Counter(3))
  h.counter.bump()
  print(h.counter.value())
  print(Counter.starting(4).value())
  // A temporary can be read and changed.
  print(make().next())
  make().bump()
  print(new Counter(1).next())
  const fixed = new Counter(9)
  print(fixed.next())
}
// expect: 4 6 4
// expect: 4 2
// expect: 3
// expect: 4
// expect: 5
// expect: 1
// expect: 9
