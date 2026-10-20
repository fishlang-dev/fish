function both<T>(t: T): T {
  const a = t
  return t
}

function main() {
  print(both(1))
}
// error: 't' was moved, so it can't be used here
