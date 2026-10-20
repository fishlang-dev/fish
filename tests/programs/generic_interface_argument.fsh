interface Shape {
  area(): i64
}

function id<T>(x: T): T {
  return x
}

function main() {
  id<Shape>(1)
}
// error: an interface can't be a type argument, since it describes values without being one
