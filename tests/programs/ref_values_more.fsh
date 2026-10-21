// Nested holder-building calls, shorthands lent to reference fields, references read out of
// holder parameters, object literals passed to holder parameters, and class lifetimes used
// by methods.
class P {
  x = 1
}

type View = { r: Ref<P> }
type Wrap = { v: View }

function view(p: Ref<P>): View {
  return { r: p }
}

function wrap(v: View): Wrap {
  return { v }
}

function make(p: Ref<P>): Wrap {
  return wrap(view(p))
}

function get(v: View): Ref<P> {
  return v.r
}

function look(v: View): i64 {
  return v.r.x
}

class Parser<A extends Lifetime> {
  src: Ref<P, A>
  constructor(src: Ref<P, A>) {
    this.src = src
  }
  source(): Ref<P, A> {
    return this.src
  }
  again(): Parser<A> {
    return new Parser(this.src)
  }
}

function main() {
  const a = new P()
  const w = make(a)
  const b = new P()
  const s: View = { r: a }
  const shorthand: { b: Ref<P> } = { b }
  const parser = new Parser(a)
  print(w.v.r.x, get(s).x, look({ r: a }), parser.again().source().x, shorthand.b.x)
}
// expect: 1 1 1 1 1
