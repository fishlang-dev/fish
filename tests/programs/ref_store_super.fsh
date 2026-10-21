class P {
  x = 1
}

class Base {
  src: Ref<P>
  constructor(src: Ref<P>) {
    this.src = src
  }
}

class Derived extends Base {
  constructor(p: P) {
    super(p)
  }
}

function main() {}
// error: can't store in 'this' a reference to 'p', which belongs to this function
