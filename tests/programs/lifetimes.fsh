// A returned reference borrows what its lifetime, written or elided, ties it to.
class Inner {
  v = 0
}

class P {
  x = 0
  inner = new Inner()
}

function first<A extends Lifetime>(x: Ref<P, A>, y: Ref<P>): Ref<P, A> {
  return x.x > y.x ? x : x
}

function either<A extends Lifetime>(c: boolean, x: Ref<P, A>, y: Ref<P, A>): Ref<P, A> {
  return c ? x : y
}

function inner(p: Ref<P>): Ref<Inner> {
  return p.inner
}

function count(p: Ref<P>) {
  return p
}

function main() {
  const a: P = { x: 1, inner: { v: 10 } }
  const b: P = { x: 2, inner: { v: 20 } }
  const f = first(a, b)
  const e: Ref<P> = either(false, a, b)
  print(f.x, e.x, inner(b).v, count(a).inner.v, either(true, a, b).inner.v)
}
// expect: 1 2 20 10 10
