interface I {
  n(): i64
}

class Wrap<T> {
  constructor(public t: T) {}

  n(): i64 {
    return 1
  }
}

function f(x: I, depth: i64): i64 {
  if (depth === 0) return x.n()
  return f(new Wrap(x), depth - 1)
}

function main() {
  print(f(new Wrap(1), 3))
}
// error: never ends
