// case: mut_assignment_value
class P {
  x = 1
}

function f(m: Mut<P>, n: P): P {
  const old = (m = n)
  return old
}

function main() {}
// error: this assignment's value can't be used: it was moved into what 'm' points to
// case: mut_field_constructor
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
// case: mut_kept_by_this
// A mutable reference stored in `this` stays lent to it, so it can't be used beside it.
class D {
  m: Mut<i64>
  n: i64
  constructor(a: Mut<i64>) {
    this.m = a
    this.n = 0
    const r: Ref<i64> = a
    this.bump()
    print(r)
  }
  bump(this: Mut<this>) { this.m = 41 }
}

function main() {
  let k = 1
  new D(k)
}
// error: cannot use 'a' while 'this' borrows 'a' mutably and is used later
// case: mut_lend_through_shared
type P = { x: i64 }
type H = { m: Mut<P> }

function poke(m: Mut<P>) {
  m.x = 4
}

function w(a: Ref<H>) {
  poke(a.m)
}

function main() {}
// error: cannot mutably borrow 'a.m' because 'a' is a shared reference ('Ref'), which only reads
// case: mut_method_passes_mut
// A method that changes `this` can pass a mutable reference on to another one, repeatedly.
class Counter { n = 0 }
class W {
  total = 0
  add(this: Mut<this>, c: Mut<Counter>) {
    c.n = c.n + 1
    this.total = this.total + c.n
  }
  run(this: Mut<this>, c: Mut<Counter>) {
    this.add(c)
    this.add(c)
    c.n = c.n + 10
  }
}
function main() {
  let w = new W()
  let c = new Counter()
  w.add(c)
  w.add(c)
  c.n = c.n + 10
  w.run(c)
  print(w.total, c.n)
}
// expect: 30 24
// case: mut_narrowed_replaced
// After a whole value of another member goes through a narrowed mutable reference, it reads
// as declared again.
type P = { kind: "p"; x: i64 }
type Q = { kind: "q"; z: i64 }

function f(m: Mut<P | Q>) {
  if (m.kind === "q") {
    m = { kind: "p", x: 4 }
    print(m.z)
  }
}

function main() {}
// error: property 'z' does not exist
// case: mut_narrowed_replaced_after
// A branch that gives a narrowed mutable reference another member doesn't carry the narrowing
// past the `if`, even when the other branch leaves.
type P = { kind: "p"; x: i64; y: i64 }
type Q = { kind: "q"; z: i64 }

function f(m: Mut<P | Q>): i64 {
  if (m.kind === "q") {
    m = { kind: "p", x: 77, y: 88 }
  } else {
    return 0
  }
  return m.z
}

function main() {}
// error: property 'z' does not exist
// case: mut_narrowed_replaced_condition
// A narrowed mutable reference is given another member only as a statement of its own: inside
// a condition, what the condition proves could still claim the old member.
type P = { kind: "p"; x: i64; y: i64 }
type Q = { kind: "q"; z: i64 }

function f(m: Mut<P | Q>): i64 {
  if (m.kind === "q" && (m = { kind: "p", x: 77, y: 88 }).kind === "p") {
    return m.z
  }
  return 0
}

function main() {}
// error: can't give 'm' another member inside a larger expression while a check narrows it
// case: mut_narrowed_replaced_loop
// A loop inside a narrowing check would come back to reads checked as narrowed.
type P = { kind: "p"; x: i64 }
type Q = { kind: "q"; z: i64 }

function f(m: Mut<P | Q>, n: i64) {
  if (m.kind === "q") {
    let i = 0
    while (i < n) {
      print(m.z)
      m = { kind: "p", x: 4 }
      i++
    }
  }
}

function main() {}
// error: can't give 'm' another member inside a loop here: a check outside the loop narrowed it
// case: mut_narrowed_replaced_switch
// A case that gives a narrowed mutable reference another member doesn't carry the narrowing
// into the case it falls through to.
type P = { kind: "p"; x: i64 }
type Q = { kind: "q"; z: i64 }
type R = { kind: "r"; z: i64 }

function f(m: Mut<P | Q | R>): i64 {
  switch (m.kind) {
    case "q":
      m = { kind: "p", x: 1 }
    case "r":
      return m.z
  }
  return 0
}

function main() {}
// error: property 'z' does not exist
// case: mut_narrowed_update
// An update through a narrowed mutable reference keeps its member, so narrowing holds; a whole
// value of another member ends the narrowing only after it.
type P = { kind: "p"; x: i64 }
type Q = { kind: "q"; z: i64 }

function h(m: Mut<i64 | boolean>) {
  if (typeof m === "number") {
    m = 3
    m++
    m += 10
  }
}

function f(m: Mut<P | Q>) {
  if (m.kind === "q") m = { kind: "p", x: 4 }
  else m.x = 9
}

function main() {
  let t: i64 | boolean = 1
  h(t)
  let u: P | Q = { kind: "q", z: 1 }
  f(u)
  f(u)
  print(t === 14, u.kind === "p" ? u.x : -1)
}
// expect: true 9
// case: mut_readonly
type P = { readonly x: i64 }

function poke(m: Mut<P>) {
  m.x = 5
}

function main() {}
// error: cannot assign to 'x' because it is a read-only property
// case: mut_through_shared
type P = { x: i64 }
type H = { m: Mut<P> }

function w(h: Ref<H>) {
  h.m.x = 7
}

function main() {}
// error: cannot assign to 'h.m.x' because 'h' is a shared reference ('Ref'), which only reads
// case: mut_variant_change
// A whole value written through a narrowed mutable reference may change its member, and a
// mutable reference field is written through like a variable.
type P = { kind: "p"; x: i64 }
type Q = { kind: "q"; z: i64 }

function flip(m: Mut<P | Q>) {
  if (m.kind === "q") {
    m = { kind: "p", x: 4 }
  }
}

type H = { n: Mut<i64> }

function main() {
  let u: P | Q = { kind: "q", z: 1 }
  flip(u)
  let k = 0
  let h: H = { n: k }
  h.n = 7
  h.n += 2
  print(u.kind === "p" ? u.x : -1, k)
}
// expect: 4 9
// case: mut_while_borrowed
type P = { x: i64 }

function main() {
  let p: P = { x: 0 }
  let m: Mut<P> = p
  const r: Ref<i64> = m.x
  m.x = 2
  print(r)
}
// error: cannot change 'm.x' while 'r' borrows 'm.x' and is used later
// case: mut_whole_keep
class P {
  x = 1
}

class View {
  r: Ref<P>
  constructor(r: Ref<P>) {
    this.r = r
  }
}

function f(m: Mut<View>) {
  let local = new P()
  m = new View(local)
}

function main() {}
// error: keeping references through the reference 'm' is not supported yet
// case: mut_whole_while_borrowed
function main() {
  let n = 1
  let m: Mut<i64> = n
  const r: Ref<i64> = m
  m = 9
  print(r)
}
// error: cannot change 'm' while 'r' borrows 'm' and is used later
// case: mut_whole_wider
function reset(m: Mut<{ x: i64 }>) {
  m = { x: 1 }
}

function main() {}
// error: can't assign a whole value through 'm', which may point to a wider value; assign its fields instead
// case: mut_writes
// A mutable reference changes what it points to: fields, compound assignments, `++`, whole
// values and mutating methods, through parameters, variables and fields.
class Counter {
  n = 0
  bump(this: Mut<this>) {
    this.n = this.n + 1
  }
}

type P = { x: i64; c: Counter }
type H = { m: Mut<P> }

function poke(m: Mut<P>) {
  m.x = 5
  m.x += 1
  m.x++
  m.c.bump()
}

function inc(k: Mut<i64>) {
  k = k + 1
  k += 10
  k++
}

class Q {
  x = 0
  c = new Counter()
}

function reset(m: Mut<Q>) {
  let fresh = new Q()
  fresh.x = 100
  m = fresh
}

function main() {
  let p: P = { x: 0, c: new Counter() }
  poke(p)
  let n = 1
  inc(n)
  let q: P = { x: 0, c: new Counter() }
  let h: H = { m: q }
  h.m.x = 3
  h.m.c.bump()
  print(p.x, p.c.n, n, q.x, q.c.n)
  let r = new Q()
  r.c.bump()
  reset(r)
  let local: Mut<i64> = n
  local = 40
  print(r.x, r.c.n, n)
}
// expect: 7 1 13 3 1
// expect: 100 0 40
