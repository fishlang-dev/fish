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

function main() {
  let c = new C()
  const r: Ref<C> = c
  c.v = 5
  print(r.n)
}
// error: cannot change 'c' while 'r' borrows 'c' and is used later
