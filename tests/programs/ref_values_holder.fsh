class P {
  x = 1
}

class Parser {
  src: Ref<P>
  constructor(src: Ref<P>) {
    this.src = src
  }
}

function main() {
  let p = new P()
  const parser = new Parser(p)
  p.x = 2
  print(parser.src.x)
}
// error: cannot change 'p.x' while 'parser' borrows 'p' and is used later
