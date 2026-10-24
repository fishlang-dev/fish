// case: refs
// A reference parameter borrows its argument, so the caller keeps it; fields, methods,
// getters and Copy values read through references, and clone() copies what one points to.
type P = { x: i64; y: i64 }
type Line = { from: P; to: P }

class Counter {
  n: i64 = 5
  get twice(): i64 {
    return this.n * 2
  }
  plus(k: i64): i64 {
    return this.n + k
  }
}

function sum(p: Ref<P>): i64 {
  return p.x + p.y
}

function length(l: Ref<Line>): i64 {
  return sum(l.to) - sum(l.from)
}

function peek(c: Ref<Counter>, k: Ref<i64>): i64 {
  return c.plus(k) + c.twice + (k > 2 ? 100 : 0)
}

function own(p: P): i64 {
  return p.x
}

function lend<T>(t: Ref<T>): i64 {
  return 1
}

function main() {
  const p: P = { x: 1, y: 2 }
  const l: Line = { from: { x: 0, y: 0 }, to: { x: 3, y: 4 } }
  const c = new Counter()
  const r: Ref<P> = p
  const copy = r.clone()
  print(sum(p), sum(p), sum(r), length(l), peek(c, 3), peek(c, c.n), own(copy), lend(p), p.x)
}
// expect: 3 3 3 7 118 120 1 1 1
// case: refs_bounds
// A reference to an interface or an object type borrows any value that satisfies it, with
// one instance per type borrowed, and the owner keeps it.
interface Shape {
  side: i64
  area(): i64
}

class Square {
  side = 3
  area(): i64 {
    return this.side * this.side
  }
}

class Rect {
  w = 2
  h = 5
  get side(): i64 {
    return this.w
  }
  area(): i64 {
    return this.w * this.h
  }
}

function describe(s: Ref<Shape>): i64 {
  return s.area() * 10 + s.side
}

function xOf(p: Ref<{ x: i64 }>): i64 {
  return p.x
}

class Spot {
  x = 7
  label = 1
}

function main() {
  const sq = new Square()
  const r = new Rect()
  const wide = { x: 4, y: 5, z: 6 }
  const spot = new Spot()
  print(describe(sq), describe(r), describe(sq), xOf(wide), xOf(spot), xOf({ x: 9 }), wide.y, spot.label)
}
// expect: 93 102 93 4 7 9 5 1
// case: refs_lend_values
// Narrowed variables, enum members, union shared fields and Copy values of another type are
// lent as copies where they aren't exactly what is borrowed.
type P = { x: i64 }
type U = { kind: "a"; p: P } | { kind: "b"; p: P; z: i64 }

enum Color {
  Red,
  Green,
  Blue,
}

function rb(u: Ref<i64 | boolean>): i64 {
  return u === true ? 1 : u === false ? 2 : 3
}

function rc(c: Ref<Color>): i64 {
  return c
}

function ri(k: Ref<i64>): i64 {
  return k
}

function look(r: Ref<P>): i64 {
  return r.x
}

function via(u: Ref<U>): i64 {
  return look(u.p)
}

function main() {
  const b: P | boolean | i64 = 7
  if (typeof b !== "object") print(rb(b))
  const c: "q" | boolean | i64 = false
  if (c !== "q") print(rb(c))
  const g = Color.Blue
  const one: 1 = 1
  const u: U = { kind: "b", p: { x: 4 }, z: 1 }
  print(rc(Color.Green), ri(Color.Blue), rc(g), ri(one), look(u.p), via(u))
}
// expect: 3
// expect: 2
// expect: 1 2 2 1 4 4
// case: refs_locals
// A reference variable can point somewhere else, a ?: of references or of a reference and a
// value works, and a reference can be the right side of a compound assignment.
type P = { x: i64 }

function pick(c: boolean, a: Ref<P>, b: Ref<P>): i64 {
  const r = c ? a : b
  return r.x
}

function mix(c: boolean, k: Ref<i64>): i64 {
  return (c ? k : 3) + 1
}

function add(n: i64, k: Ref<i64>, f: Ref<boolean>): i64 {
  let total = n
  total += k
  let flag = true
  flag &&= f
  return flag ? total : -total
}

function main() {
  const a: P = { x: 1 }
  const b: P = { x: 2 }
  let r: Ref<P> = a
  const first = r.x
  r = b
  print(first, r.x, pick(true, a, b), pick(false, a, b), mix(true, 5), mix(false, 5), add(1, 2, true), add(1, 2, false))
}
// expect: 1 2 1 2 6 4 3 -3
// case: refs_move_field
type Inner = { v: i64 }
type P = { inner: Inner }

function own(i: Inner): i64 {
  return i.v
}

function take(r: Ref<P>): i64 {
  const l = r
  return own(l.inner)
}

function main() {
  const p: P = { inner: { v: 1 } }
  print(take(p))
}
// error: 'l.inner' can't be moved out of 'l', which only borrows it; use 'l.inner.clone()'
// case: refs_move_out
type P = { x: i64 }

function own(p: P): i64 {
  return p.x
}

function take(r: Ref<P>): i64 {
  return own(r)
}

function main() {
  const p: P = { x: 1 }
  print(take(p))
}
// error: can't move a value out of a reference to it, which only borrows it; use '.clone()' to hand over a copy
// case: refs_mut
// A mutable reference needs a `let`, and lends itself as a shared one.
type P = { x: i64 }

function look(p: Ref<P>): i64 {
  return p.x
}

function lookMut(p: Mut<P>): i64 {
  return look(p) + 1
}

function main() {
  let p: P = { x: 4 }
  print(lookMut(p), lookMut(p), look(p))
}
// expect: 5 5 4
// case: refs_mut_const
type P = { x: i64 }

function lookMut(p: Mut<P>): i64 {
  return p.x
}

function main() {
  const p: P = { x: 4 }
  print(lookMut(p))
}
// error: cannot mutably borrow 'p' because it is a constant
// case: refs_mut_narrowing
// A mutable reference to a union narrowed to several members can still be read.
type P = { x: i64 }

function rb(u: Ref<i64 | boolean>): i64 {
  return u === true ? 1 : u === false ? 2 : 3
}

function f(u: Mut<i64 | boolean | P>): i64 {
  if (typeof u !== "object") return rb(u)
  return u.x
}

function main() {
  let a: i64 | boolean | P = false
  let b: i64 | boolean | P = { x: 9 }
  print(f(a), f(b))
}
// expect: 2 9
// case: refs_narrowing
// A reference to a union narrows like the union, and reads the member it points to.
type Circle = { kind: "c"; r: i64 }
type Square = { kind: "s"; side: i64 }
type Shape = Circle | Square

function area(s: Ref<Shape>): i64 {
  if (s.kind === "c") return s.r * s.r * 3
  return s.side * s.side
}

function ru(u: Ref<i64 | boolean>): i64 {
  if (typeof u === "number") return u + 1
  return u ? 100 : 200
}

function main() {
  const c: Shape = { kind: "c", r: 2 }
  const q: Shape = { kind: "s", side: 3 }
  const n: i64 | boolean = 4
  const t: i64 | boolean = true
  print(area(c), area(q), ru(n), ru(t))
}
// expect: 12 9 5 100
// case: refs_rebind
// A reference variable can be pointed at anything declared in its own scope or an enclosing
// one, since that lives as long as it does.
type P = { x: i64 }

function main() {
  const a: P = { x: 1 }
  const b: P = { x: 2 }
  const c: P = { x: 3 }
  let prev: Ref<P> = a
  let cur: Ref<P> = b
  let total = 0
  let i = 0
  while (i < 3) {
    prev = cur
    if (i === 1) {
      cur = a
    } else {
      cur = c
    }
    total = total * 10 + prev.x
    i++
  }
  print(total, cur.x)
}
// expect: 231 3
// case: refs_rebind_inner
type P = { x: i64 }

function main() {
  const a: P = { x: 1 }
  let q: Ref<P> = a
  let j = 0
  while (j < 2) {
    const z: P = { x: j + 50 }
    q = z
    j++
  }
  print(q.x)
}
// error: 'q' can only be pointed at a variable, or a field of one, declared in its own scope or an enclosing one, so that it lives as long as 'q'
// case: refs_rebind_temp
type P = { x: i64 }

function main() {
  const a: P = { x: 1 }
  let q: Ref<P> = a
  q = { x: 2 }
  print(q.x)
}
// error: 'q' can only be pointed at a variable, or a field of one
// case: refs_release
// mode: release
// References behave the same in a release build.
type P = { x: i64; y: i64 }

function sum(p: Ref<P>): i64 {
  return p.x + p.y
}

function main() {
  const p: P = { x: 3, y: 4 }
  print(sum(p), sum({ x: 1, y: 1 }), p.y)
}
// expect: 7 2 4
// case: refs_shared_as_mut
type P = { x: i64 }

function poke(m: Mut<i64>): i64 {
  return 1
}

function look(r: Ref<i64>): i64 {
  return poke(r)
}

function main() {
  print(look(3))
}
// error: a shared reference can't lend itself as mutable
// case: refs_tests
// Tag checks, comparisons, printing and switch read through references.
class A {
  a: i64 = 1
}

class B {
  b: i64 = 2
}

enum Color {
  Red,
  Green,
  Blue,
}

function f(r: Ref<A>, b: Ref<boolean>, k: Ref<i64>) {
  print(r instanceof A, typeof b === "boolean", typeof k === "number")
}

function rc(c: Ref<Color>): i64 {
  if (c === Color.Green) return 1
  return c
}

function ru(u: Ref<i64 | boolean>): i64 {
  return u === true ? 1 : u === false ? 2 : 3
}

function rl(l: Ref<"hi" | "yo">): i64 {
  return l === "hi" ? 1 : 2
}

function rab(x: Ref<A | B>): i64 {
  return x instanceof A ? 1 : 0
}

function shown(b: Ref<boolean>, c: Ref<Color>, u: Ref<i64 | boolean>, l: Ref<"hi" | "yo">) {
  print(b, c, u, l)
}

function sw(k: Ref<i64>): i64 {
  switch (k) {
    case 1:
      return 10
    default:
      return 20
  }
}

function main() {
  f(new A(), true, 3)
  const x: A | B = new A()
  const u: i64 | boolean = 41
  const v: i64 | boolean = false
  print(rc(Color.Blue), ru(u), ru(v), rl("yo"), rab(x))
  shown(true, Color.Green, false, "yo")
  print(sw(1), sw(2))
}
// expect: true true true
// expect: 2 3 2 2 1
// expect: true 1 false yo
// expect: 10 20
// case: refs_type_argument
// A reference can be a type argument.
type P = { x: i64 }

function id<T>(t: T): i64 {
  return 1
}

function main() {
  const p: P = { x: 1 }
  const r: Ref<P> = p
  print(id(r))
}
// expect: 1
// case: refs_union_mut_lend
type U = { kind: "a"; n: i64 } | { kind: "b"; n: i64; z: i64 }

function mutI(k: Mut<i64>): i64 {
  return k
}

function main() {
  let u: U = { kind: "a", n: 1 }
  print(mutI(u.n))
}
// error: only a place holding exactly 'i64' can be lent mutably
// case: refs_union_mutating
class C {
  n: i64 = 4
  bump(this: Mut<this>) {
    this.n = this.n + 1
  }
}

type U = { kind: "a"; c: C } | { kind: "b"; c: C; z: i64 }

function main() {
  let u: U = { kind: "b", c: new C(), z: 1 }
  u.c.bump()
}
// error: can't call 'bump' on 'c' through
// case: refs_union_receiver
// A getter or method called on a field every member of a union shares reads a copy of it.
class C {
  n: i64 = 4
  get twice(): i64 {
    return this.n * 2
  }
  plus(k: i64): i64 {
    return this.n + k
  }
}

type U = { kind: "a"; c: C } | { kind: "b"; c: C; z: i64 }

function main() {
  const u: U = { kind: "b", c: new C(), z: 1 }
  print(u.c.twice, u.c.plus(1))
}
// expect: 8 5
// case: refs_wider
// A shared reference to a wider value lends a copy of the part a narrower reference wants.
type P = { x: i64 }

function exact(r: Ref<P>): i64 {
  return r.x
}

function look(r: Ref<{ x: i64 }>): i64 {
  const l: Ref<P> = r
  return l.x + exact(r)
}

function main() {
  const wide = { x: 1, y: 2 }
  print(look(wide), look({ x: 3 }))
}
// expect: 2 6
// case: refs_wider_mut
type P = { x: i64 }

function look(r: Mut<{ x: i64 }>): i64 {
  let l: Mut<P> = r
  return l.x
}

function main() {
  let wide = { x: 1, y: 2 }
  print(look(wide))
}
// error: only a reference to exactly '{ x: i64 }' can be lent mutably
// case: refs_write_shared
type P = { x: i64 }

function main() {
  let p: P = { x: 1 }
  let r: Ref<P> = p
  r.x = 2
}
// error: cannot assign to 'r.x' because 'r' is a shared reference ('Ref'), which only reads
