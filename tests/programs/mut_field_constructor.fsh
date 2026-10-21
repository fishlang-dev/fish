// A constructor sets a mutable reference field; later assignments write through it.
class P { x = 0 }

class C<A extends Lifetime> {
  m: Mut<P, A>
  constructor(m: Mut<P, A>) { this.m = m }
  poke(this: Mut<this>) { this.m.x = this.m.x + 5 }
}

class D {
  m: Mut<i64>
  constructor(m: Mut<i64>) { this.m = m }
}

function main() {
  let p = new P()
  let c = new C(p)
  c.poke()
  print(c.m.x)
  let k = 1
  let d = new D(k)
  d.m = 5
  print(d.m)
}
// expect: 5
// expect: 5
