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
  print((h.p = r).x)
}
// error: 'h.p' is a setter, which keeps the value assigned to it, so this assignment can't also be used as a value; assign a clone
