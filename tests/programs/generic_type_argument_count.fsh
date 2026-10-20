function id<T>(x: T): T {
  return x
}

function main() {
  id<i64, boolean>(1)
}
// error: expected 1 type argument, but got 2
