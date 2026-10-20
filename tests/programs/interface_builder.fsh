interface Builder {
  add(n: i64): Builder
  total(): i64
}

interface A {
  b(): B
}

interface B {
  a(): A
}

class Sum {
  constructor(public n: i64) {}

  add(n: i64): Sum {
    return new Sum(this.n + n)
  }

  total(): i64 {
    return this.n
  }
}

class Ping {
  b(): Pong {
    return new Pong()
  }
}

class Pong {
  a(): Ping {
    return new Ping()
  }
}

function finish(b: Builder): i64 {
  return b.add(2).add(3).total()
}

function bounce(x: A): i64 {
  return 1
}

function main() {
  print(finish(new Sum(1)), bounce(new Ping()))
}
// expect: 6 1
