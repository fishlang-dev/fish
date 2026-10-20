class Grow<T> {
  constructor(public value: T) {}

  next(): Grow<{ inner: T }> {
    return new Grow({ inner: this.value })
  }
}

function main() {
  print(new Grow(1).value)
}
// error: never ends
