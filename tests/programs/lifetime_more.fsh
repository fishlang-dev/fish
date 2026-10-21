// Two implicit parameters, references through a reference parameter's fields, inference
// through Ref<T, A>, and an interface method whose lifetime is written differently.
class P {
  x = 0
}

class H {
  p = new P()
}

class Inner {
  v = 0
}

class Mid {
  inner = new Inner()
  pick(): Ref<Inner> {
    return this.inner
  }
}

class Holder {
  mid = new Mid()
}

function second<A extends Lifetime>(p: Ref<{ x: i64 }>, q: Ref<{ x: i64 }, A>): Ref<{ x: i64 }, A> {
  return q
}

function field(h: Ref<H>): Ref<P> {
  const r: Ref<P> = h.p
  return r
}

function deep(h: Ref<Holder>): Ref<Inner> {
  const r = h.mid.pick()
  return r
}

function pick<A extends Lifetime, T>(c: boolean, a: Ref<T, A>, b: Ref<T, A>): Ref<T, A> {
  return c ? a : b
}

interface Same {
  same(o: Ref<P>): boolean
}

class Cmp {
  x = 1
  same<A extends Lifetime>(o: Ref<P, A>): boolean {
    return o.x === this.x
  }
}

function check(s: Ref<Same>, p: Ref<P>): boolean {
  return s.same(p)
}

function main() {
  let h = new H()
  h.p.x = 5
  let hold = new Holder()
  hold.mid.inner.v = 6
  const one = { x: 1 }
  const two = { x: 2 }
  print(second(one, two).x, field(h).x, deep(hold).v, pick(false, 3, 4), check(new Cmp(), h.p))
}
// expect: 2 5 6 4 false
