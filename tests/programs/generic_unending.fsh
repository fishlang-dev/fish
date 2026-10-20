function grow<T>(x: T, n: i64): i64 {
  if (n === 0) return 0
  return grow({ inner: x }, n - 1)
}

function main() {
  print(grow(1, 3))
}
// error: instantiating 'grow' never ends: each instance needs another with larger type arguments
