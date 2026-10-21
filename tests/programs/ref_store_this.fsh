class P {
  x = 1
}

class Parser {
  src: Ref<P>
  constructor(src: Ref<P>) {
    this.src = src
  }
  reset(this: Mut<this>) {
    let local = new P()
    this.src = local
  }
}

function main() {}
// error: can't store in 'this' a reference to 'local', which belongs to this function
