// case: lifetime_ambiguous
class P {
  x = 0
}

function first(x: Ref<P>, y: Ref<P>): Ref<P> {
  return x
}

function main() {}
// error: this function returns a reference and takes several, so say which it points into
// case: lifetime_caller
class P {
  x = 0
}

function first<A extends Lifetime>(x: Ref<P, A>, y: Ref<P>): Ref<P, A> {
  return x
}

function main() {
  let a: P = { x: 1 }
  let b: P = { x: 2 }
  const f = first(a, b)
  b.x = 5
  a.x = 3
  print(f.x)
}
// error: cannot change 'a.x' while 'f' borrows 'a' and is used later
// case: lifetime_caller_ok
// A result borrows only what its lifetime ties it to, and only until its last use.
class P {
  x = 0
}

function first<A extends Lifetime>(x: Ref<P, A>, y: Ref<P>): Ref<P, A> {
  return x
}

function main() {
  let a: P = { x: 1 }
  let b: P = { x: 2 }
  const f = first(a, b)
  b.x = 5
  print(f.x)
  a.x = 3
  print(a.x, b.x)
}
// expect: 1
// expect: 3 5
// case: lifetime_copy_arg
type A = { kind: "a"; x: i64 }
type B = { kind: "b"; x: i64; y: i64 }

function idi(k: Ref<i64>): Ref<i64> {
  return k
}

function bad(u: Ref<A | B>): Ref<i64> {
  return idi(u.x)
}

function main() {}
// error: can't return a reference to a temporary or a copy
// case: lifetime_field_end
// A field is lent where it lives when the argument stores it as exactly the type borrowed,
// even when an object on the way there is stored wider.
function fx<T extends { o: { x: i64 } }>(p: Ref<T>): Ref<i64> {
  return p.o.x
}

function main() {
  const w = { o: { x: 3, q: 9 } }
  print(fx(w))
}
// expect: 3
// case: lifetime_holds_temporary
class P {
  x = 0
}

function bad(q: Ref<P>): Ref<P> {
  const r: Ref<P> = new P()
  return r
}

function main() {}
// error: 'r' would keep borrowing this temporary, which is gone once its statement ends
// case: lifetime_interface_param
class P {
  x = 0
}

interface V {
  pick(x: Ref<P>): Ref<P>
}

class C {
  pick<A extends Lifetime>(x: Ref<P, A>): Ref<P, A> {
    return x
  }
}

function h<T extends V>(v: Ref<T>): i64 {
  const p = new P()
  return v.pick(p).x
}

function main() {
  print(h(new C()))
}
// error: returns a reference tied to lifetime 'A' of a parameter
// case: lifetime_local
class P {
  x = 0
}

function bad(r: Ref<P>): Ref<P> {
  const p: P = { x: r.x }
  return p
}

function main() {}
// error: can't return a reference to 'p', which belongs to this function and is gone once it returns
// case: lifetime_more
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
// case: lifetime_nothing
class P {
  x = 0
}

function make(): Ref<P> {
  const p: P = { x: 1 }
  return p
}

function main() {}
// error: this function returns a reference but borrows nothing it could point into
// case: lifetime_owned_param
class P {
  x = 0
}

function bad(r: Ref<P>, q: P): Ref<P> {
  return q
}

function main() {}
// error: can't return a reference to 'q', which belongs to this function
// case: lifetime_param_field
function inner(p: Ref<{ o: { x: i64 } }>): Ref<{ x: i64 }> {
  return p.o
}

function main() {
  const w = { a: 1, o: { x: 3, q: 9 } }
  print(inner(w).x)
}
// error: can't return a reference to a temporary or a copy
// case: lifetime_param_field_exact
// A field read through a reference parameter or a type parameter is lent where it lives when
// the argument stores it as exactly the type borrowed.
class Inner {
  v = 4
}

class Mid {
  inner = new Inner()
  pick(): Ref<Inner> {
    return this.inner
  }
}

function fx(p: Ref<{ x: i64 }>): Ref<i64> {
  return p.x
}

function viaT<T extends { x: i64 }>(p: Ref<T>): Ref<i64> {
  return p.x
}

function deep(p: Ref<{ mid: Mid }>): Ref<Inner> {
  return p.mid.pick()
}

function main() {
  const w = { x: 1, y: 2 }
  const h = { mid: new Mid(), n: 3 }
  print(fx(w), viaT(w), deep(h).v)
}
// expect: 1 1 4
// case: lifetime_param_field_read
// A field read through an object-typed reference parameter lends a copy of the part wanted,
// since the argument may store it differently.
function look(p: Ref<{ o: { x: i64 } }>): i64 {
  const r: Ref<{ x: i64 }> = p.o
  return r.x
}

function main() {
  const w = { a: 1, o: { x: 3, q: 9 }, z: 4 }
  print(look(w))
}
// expect: 3
// case: lifetime_ref_receiver
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

function main() {
  let h = new Holder()
  const rh: Ref<Holder> = h
  const r = rh.mid.pick()
  h.mid = new Mid()
  print(r.v)
}
// error: cannot change 'h.mid' while 'r' borrows 'h' and is used later
// case: lifetime_super
class Inner {
  v = 7
}

class Base {
  inner = new Inner()
  pick(): Ref<Inner> {
    return this.inner
  }
}

class Derived extends Base {
  swap(this: Mut<this>): i64 {
    const r = super.pick()
    this.inner = new Inner()
    return r.v
  }
}

function main() {
  let d = new Derived()
  print(d.swap())
}
// error: cannot change 'this.inner' while 'r' borrows 'this' and is used later
// case: lifetime_temporary
function bad(r: Ref<i64>): Ref<i64> {
  return 3
}

function main() {}
// error: can't return a reference to a temporary
// case: lifetime_temporary_call
class Inner {
  v = 42
}

class Holder {
  inner = new Inner()
  pick(): Ref<Inner> {
    return this.inner
  }
}

function bad(r: Ref<i64>): Ref<Inner> {
  return new Holder().pick()
}

function main() {}
// error: can't return a reference to a temporary or a copy
// case: lifetime_this
// A method or getter returning a reference borrows from its object, so a field can be read
// without a clone, through a class or an interface.
class Inner {
  v = 0
}

class Holder {
  inner = new Inner()
  n = 1
  get view(): Ref<Inner> {
    return this.inner
  }
  pick(): Ref<Inner> {
    return this.inner
  }
}

interface Viewer {
  pick(): Ref<Inner>
}

function through(v: Ref<Viewer>): i64 {
  return v.pick().v + 1
}

function main() {
  let h = new Holder()
  h.inner.v = 7
  const a = h.view
  const b = h.pick()
  print(a.v, b.v, through(h), h.view.v)
  h.n = 2
  print(h.n)
}
// expect: 7 7 8 7
// expect: 2
// case: lifetime_this_change
class Inner {
  v = 0
}

class Holder {
  inner = new Inner()
  pick(): Ref<Inner> {
    return this.inner
  }
}

function main() {
  let h = new Holder()
  const b = h.pick()
  h.inner = new Inner()
  print(b.v)
}
// error: cannot change 'h.inner' while 'b' borrows 'h' and is used later
// case: lifetime_undeclared
class P {
  x = 0
}

function first(x: Ref<P, A>): Ref<P, A> {
  return x
}

function main() {}
// error: cannot find lifetime 'A'; declare it as '<A extends Lifetime>'
// case: lifetime_union_receiver
class Inner {
  v = 0
}

class Mid {
  inner = new Inner()
  pick(): Ref<Inner> {
    return this.inner
  }
}

class A {
  mid = new Mid()
  a = 1
}

class B {
  mid = new Mid()
  b = 2
  c = 3
}

function main() {
  let u: A | B = new A()
  const r = u.mid.pick()
  u = new B()
  print(r.v)
}
// error: cannot change 'u' while 'r' borrows 'u.mid' and is used later
// case: lifetime_width
// A reference returned from a reference parameter to an object type points at what that
// parameter borrows, whatever wider object it is.
function same(p: Ref<{ x: i64 }>): Ref<{ x: i64 }> {
  return p
}

function main() {
  const wide = { x: 3, y: 4 }
  const narrow = { x: 5 }
  print(same(wide).x, same(narrow).x, wide.y)
}
// expect: 3 5 4
// case: lifetime_wrong_param
class P {
  x = 0
}

function first<A extends Lifetime>(x: Ref<P, A>, y: Ref<P>): Ref<P, A> {
  return y
}

function main() {}
// error: the returned reference points into 'y', but its lifetime ties it to 'x'
