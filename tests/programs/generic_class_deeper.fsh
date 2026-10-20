interface I {
  wrap(): I
}

class Box<T> {
  constructor(public t: T) {}

  wrap(): Box<Box<T>> {
    return new Box(this)
  }
}

function use(i: I): i64 {
  return 1
}

function main() {
  print(use(new Box(1)))
}
// error: never ends
