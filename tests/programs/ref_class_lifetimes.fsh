// A class may name its lifetime, and a function's result typed with it borrows only the
// arguments with that lifetime.
class P {
  x = 1
}

class Parser<A extends Lifetime> {
  src: Ref<P, A>
  constructor(src: Ref<P, A>) {
    this.src = src
  }
}

function parse<A extends Lifetime>(src: Ref<P, A>, other: Ref<P>): Parser<A> {
  return new Parser(src)
}

function main() {
  let a = new P()
  let b = new P()
  const parser = parse(a, b)
  b.x = 5
  print(parser.src.x, b.x)
}
// expect: 1 5
