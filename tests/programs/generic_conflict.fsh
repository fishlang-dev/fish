function same<T>(a: T, b: T): T {
  return a
}

function main() {
  same(1, true)
}
// error: the type argument for 'T' can't be both 'i64' and 'boolean'
