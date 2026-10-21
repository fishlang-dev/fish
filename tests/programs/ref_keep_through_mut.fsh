class P {
  x = 1
}
type View = { r: Ref<P> }
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
  const a = new P()
  let b = new P()
  let pp = new Parser(a)
  let m: Mut<Parser> = pp
  m.set(b)
  b.x = 9
  print(pp.src.x)
}
// error: keeping references through the reference 'm' is not supported yet
