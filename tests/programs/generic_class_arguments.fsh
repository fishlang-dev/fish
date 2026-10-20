class Box<T> {
  constructor(public value: T) {}
}

function main() {
  const b: Box<i64, boolean> = new Box(1)
}
// error: type 'Box' expects 1 type argument, but got 2
