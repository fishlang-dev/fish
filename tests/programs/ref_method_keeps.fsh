class P {
  x = 1
}

class Parser {
  src: Ref<P>
  constructor(src: Ref<P>) {
    this.src = src
  }
  set(this: Mut<this>, r: Ref<P>) {
    this.src = r
  }
}

function main() {
  let a = new P()
  let b = new P()
  let q = new Parser(a)
  q.set(b)
  b.x = 9
  print(q.src.x)
}
// error: cannot change 'b.x' while 'q' borrows 'b' and is used later
