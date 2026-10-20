// An assignment through a setter, used as a value, hands over what was assigned, not the
// property.
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

function keep(p: P): i64 {
  return p.x
}

function main() {
  let h = new Holder()
  const r: P = { x: 4 }
  print(keep(h.p = r), h.p.x)
}
// expect: 4 4
