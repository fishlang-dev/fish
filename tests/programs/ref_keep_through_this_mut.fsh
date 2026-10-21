class P {
  x = 1
}
class Big {
  a = 9001
  b = 9002
  c = 9003
  d = 9004
  e = 9005
  f = 9006
  sum(): i64 {
    return this.a + this.b + this.c + this.d + this.e + this.f
  }
}
function clobber(): i64 {
  const big = new Big()
  const big2 = new Big()
  return big.sum() + big2.sum()
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
class Q {
  m: Mut<Parser>
  constructor(m: Mut<Parser>) {
    this.m = m
  }
  attach(this: Mut<this>, r: Ref<P>) {
    this.m.set(r)
  }
}
function g(pp: Mut<Parser>) {
  let local = new P()
  local.x = 42
  let q = new Q(pp)
  q.attach(local)
}
function main() {
  const a = new P()
  let pp = new Parser(a)
  g(pp)
  clobber()
  print(pp.src.x)
}
// error: keeping references through the reference 'this.m' is not supported yet
