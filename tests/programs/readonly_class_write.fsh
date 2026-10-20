class Counter {
  readonly n: i64 = 0
}

function main() {
  let c = new Counter()
  c.n += 1
}
// error: cannot assign to 'n' because it is a read-only property
