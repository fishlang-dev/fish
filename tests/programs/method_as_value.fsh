class Counter {
  value(): i64 {
    return 1
  }
}

function main() {
  const f = new Counter().value
}
// error: methods can't be used as values yet; call it
