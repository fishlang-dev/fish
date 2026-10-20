function id<T>(x: T): T {
  return x
}

function main() {
  id<boolean>(1)
}
// error: argument of type 'i64' is not assignable to parameter of type 'boolean'
