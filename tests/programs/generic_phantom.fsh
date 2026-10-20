interface Getter {
  get(): i64
}

class Tag<T> {
  n: i64 = 7

  get(): i64 {
    return this.n
  }
}

function h<U extends Getter>(u: U): i64 {
  return u.get()
}

function f<T>(x: T): i64 {
  return h(new Tag<T>())
}

function main() {
  print(f(true))
}
// expect: 7
