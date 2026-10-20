// A setter assignment whose value is thrown away, on its own or in a branch of a `?:`
// statement, keeps nothing twice.
type P = { x: i64 }

class Holder {
  #p: P = { x: 0 }
  get p(): P {
    return this.#p.clone()
  }
  set p(v: P) {
    this.#p = v
  }
}

function main() {
  let h = new Holder()
  const r: P = { x: 4 }
  const sure = true
  sure ? (h.p = r) : (h.p = { x: 1 })
  print(h.p.x)
}
// expect: 4
