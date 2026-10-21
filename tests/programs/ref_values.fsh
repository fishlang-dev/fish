// Classes and object literals hold references, read and call through them, and take new ones.
class Source {
  text = 7
  peek(): i64 {
    return this.text
  }
}

class Parser {
  src: Ref<Source>
  pos = 0
  constructor(src: Ref<Source>) {
    this.src = src
  }
  next(this: Mut<this>): i64 {
    this.pos = this.pos + 1
    return this.src.peek() + this.pos
  }
}

function main() {
  const a = new Source()
  let b = new Source()
  b.text = 10
  let p = new Parser(a)
  const first = p.next()
  p.src = b
  const second = p.next()
  const view = { s: a, n: 1 }
  print(first, second, view.s.text + view.n)
}
// expect: 8 12 8
