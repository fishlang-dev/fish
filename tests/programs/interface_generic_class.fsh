interface Put {
  put(v: i64): i64
}

class Box<T> {
  constructor(public value: T) {}

  put(v: T): i64 {
    return 1
  }
}

function use(p: Put): i64 {
  return p.put(2)
}

function main() {
  print(use(new Box<i64>(3)))
}
// expect: 1
