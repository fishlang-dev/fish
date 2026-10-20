interface A {
  get(): i64
}

interface B {
  get(): boolean
}

function f(x: A & B): i64 {
  return 1
}

function main() {}
// error: method 'get' has different types on each side of '&'
