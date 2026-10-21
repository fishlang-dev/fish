class P {
  x = 1
}

class Holder {
  #r: Ref<P>
  constructor(r: Ref<P>) {
    this.#r = r
  }
  get r(): Ref<P> {
    return this.#r
  }
  set r(v: Ref<P>) {
    this.#r = v
  }
}

function main() {
  let a = new P()
  let b = new P()
  let h = new Holder(a)
  h.r = b
  b.x = 9
  print(h.r.x)
}
// error: cannot change 'b.x' while 'h' borrows 'b' and is used later
