class P {
  x = 1
}

class Parser {
  src: Ref<P>
  constructor(p: P) {
    this.src = p
  }
}

function main() {}
// error: can't store in 'this' a reference to 'p', which belongs to this function
