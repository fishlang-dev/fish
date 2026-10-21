class C {
  n: i64 = 1
  #v: i64 = 0
  get v(): i64 {
    return this.#v
  }
  set v(x: i64) {
    this.#v = x
  }
}

function f(a: Ref<i64>, b: i64): i64 {
  return a * 100 + b
}

function main() {
  let c = new C()
  print(f(c.n, c.v = 5))
}
// error: cannot change 'c' while 'c.n' is lent to 'f' for this call
