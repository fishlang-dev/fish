class Counter {
  readonly n: i64 = 0
  bump(this: Mut<this>) {
    this.n = this.n + 1
  }
}

function main() {
  let c = new Counter()
  c.bump()
}
// error: cannot assign to 'n' because it is a read-only property
