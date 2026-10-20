class Counter {
  count = 0

  bump(this: Mut<this>) {
    this.count++
  }
}

function main() {
  const c = new Counter()
  c.bump()
}
// error: cannot call 'bump' on 'c' because it is a constant
