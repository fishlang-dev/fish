// A setter assignment of a Copy value can still be used as a value.
class Holder {
  #n: i64 = 0
  get n(): i64 {
    return this.#n
  }
  set n(v: i64) {
    this.#n = v
  }
}

function main() {
  let h = new Holder()
  print(h.n = 4, h.n)
}
// expect: 4 4
