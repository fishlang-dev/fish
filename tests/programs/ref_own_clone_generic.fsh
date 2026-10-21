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
class Own {
  p: P
  r: Ref<P>
  constructor(p: P, r: Ref<P>) {
    this.p = p
    this.r = r
  }
  clone(): Own {
    let q = new P()
    q.x = this.p.x
    return new Own(q, this.p)
  }
}
function dup<T>(t: T): T {
  return t.clone()
}
function make(a: Ref<P>): Own {
  let p = new P()
  p.x = 42
  return dup(new Own(p, a))
}
function main() {
  const a = new P()
  const o = make(a)
  clobber()
  print(o.r.x)
}
// error: can't return a reference to 't', which belongs to this function
