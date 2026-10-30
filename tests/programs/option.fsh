// case: option
// An Option is checked with === null or === undefined, which narrow it, and an empty one
// prints null and is "undefined" to typeof.
function find(n: i64): i64 | null {
  if (n < 0) return null
  return n * 2
}
function show(x: i64 | undefined) {
  if (x === undefined) {
    print("nothing")
    return
  }
  print(x + 1)
}
function main() {
  const a = find(3)
  const b = find(-1)
  print(a, b, typeof b === "undefined", typeof a === "number", typeof a === "undefined")
  if (a !== null) print(a + 100)
  show(4)
  show(undefined)
  let c: Option<i64 | null> = null
  print(c === null, c)
  c = 7
  const e: i64 | null = c
  print(c === null, e !== null && e > 5)
  const d: boolean | null = b === null ? true : null
  print(d)
  const u: u8 | null = 200
  print(u)
}
// expect: 6 null true true false
// expect: 106
// expect: 5
// expect: nothing
// expect: true null
// expect: false true
// expect: true
// expect: 200
// case: option_chain
// '?.' reads a field or calls a method through an Option; an empty one gives an empty
// result and skips the rest of the chain, the call included. Every argument runs before
// anything prints.
type Inner = { x: i64 }
type Outer = { inner: Inner; tag?: i64 }
class Acc {
  total = 0
  add(this: Mut<this>, n: i64): i64 {
    this.total += n
    print("add ran")
    return this.total
  }
  get double(): i64 { return this.total * 2 }
}
function main() {
  const some: Outer | null = { inner: { x: 5 } }
  const none: Outer | null = null
  print(some?.inner.x, none?.inner.x, some?.tag, none?.tag)
  const sx = some?.inner.x
  print(sx ?? -1, none?.inner.x ?? -1)
  let a: Acc | null = new Acc()
  print(a?.add(3), a?.add(4), a?.double)
  let b: Acc | null = null
  print(b?.add(1), b?.double)
}
// expect: 5 null null null
// expect: 5 -1
// expect: add ran
// expect: add ran
// expect: 3 7 14
// expect: null null
// case: option_chain_narrowed
// A method called through '?.' on a narrowed variable changes the variable.
class C { n: i64 = 0; bump(this: Mut<this>) { this.n += 1 } }
class D { m: i64 = 0 }
function main() {
  let x: C | D | null = new C()
  if (x instanceof D) return
  x?.bump()
  x?.bump()
  print(x?.n)
}
// expect: 2
// case: option_chain_not_option
// '?.' reads through an Option.
type P = { x: i64 }
function main() {
  const p: P = { x: 1 }
  print(p?.x)
}
// error: '?.' reads through an Option, and this is a '{ x: i64 }', which is never empty; use '.'
// case: option_chain_reference
// A chain giving a reference gives an Option of it, which borrows what the chain read.
class C {
  n: i64 = 1
  r(): Ref<i64> { return this.n }
}
function main() {
  let o: C | null = new C()
  const x = o?.r()
  o = null
  const y: i64 = x!
  print(y)
}
// error: cannot change 'o' while 'x' borrows 'o' and is used later
// case: option_condition
// An Option isn't a condition.
function main() {
  const x: i64 | null = 1
  if (x) print(x)
}
// error: condition must be a boolean, not the Option 'i64 | null'; check it with '!== null'
// case: option_default
// '??' gives a default only when an Option is empty, and runs it only then; '!' takes the
// value out, and panics when there is none.
function find(n: i64): i64 | null {
  if (n < 0) return null
  return n
}
function loud(n: i64): i64 {
  print("default ran")
  return n
}
function main() {
  print(find(3) ?? 0, find(-1) ?? 0)
  print(find(5) ?? loud(9))
  print(find(-5) ?? loud(9))
  const both = find(-1) ?? find(2)
  print(both, find(-1) ?? find(-2))
  const w: u8 | null = null
  print(w ?? 255)
  print(find(4)!)
  print(find(-4)!)
}
// expect: 3 0
// expect: 5
// expect: default ran
// expect: 9
// expect: 2 null
// expect: 255
// expect: 4
// panic: called `Option::unwrap()` on a `None` value
// case: option_default_lend
// So would lending through '??'.
class C { n: i64 = 0 }
function set(c: Mut<C>) { c.n = 9 }
function main() {
  let o: C | null = new C()
  const d = new C()
  set(o ?? d)
  print(o?.n)
}
// error: can't lend this mutably through '??', which would lend a copy
// case: option_default_moves
// 'a ?? b' hands over what a holds.
class P { x: i64; constructor(x: i64) { this.x = x } }
function take(p: P) { print(p.x) }
function main() {
  const o: P | null = new P(1)
  take(o ?? new P(2))
  take(o ?? new P(3))
}
// error: 'o' was moved, so it can't be used here
// case: option_default_mutate
// A mutating call through '??' would change a copy.
class C { n: i64 = 0; next(this: Mut<this>): i64 { this.n += 1; return this.n } }
function main() {
  let o: C | null = new C()
  print((o ?? new C()).next())
  print((o ?? new C()).next())
  print(o?.n)
}
// error: can't call 'next' through '??', which would change a copy
// case: option_default_nested_mutate
// So would one through nested '??'s.
class C { n: i64 = 0; next(this: Mut<this>): i64 { this.n += 1; return this.n } }
function main() {
  let o: C | null = null
  let p: C | null = new C()
  print(((o ?? p) ?? new C()).next())
  print(p?.n)
}
// error: can't call 'next' through '??', which would change a copy
// case: option_default_not_option
// '??' needs an Option on its left.
function main() {
  const n = 5
  print(n ?? 1)
}
// error: the left side of '??' is a 'i64', which is never empty
// case: option_null_equal
// Two empty values are equal.
function main() { const v: null = null; print(v === null) }
// expect: true
// case: option_null_into_value
// Only an Option can be empty.
function main() {
  const v: i64 = null
}
// error: type 'null' is not assignable to type 'i64'
// case: option_read_borrowed
// Reading through '!' and '??' on a borrowed Option is fine.
class P { x: i64; constructor(x: i64) { this.x = x } }
function look(o: Ref<P | null>): i64 { return o!.x + (o ?? new P(1)).x }
function num(o: Ref<i64 | null>): i64 { return o! + (o ?? 1) }
function main() {
  let o: P | null = new P(5)
  const d = new P(1)
  let n: i64 | null = 4
  print(look(o), num(n))
}
// expect: 10 8
// case: option_read_through
// Reading through '!' and '??' doesn't change anything, so it is allowed.
class C { n: i64 = 0; next(this: Mut<this>): i64 { this.n += 1; return this.n }; peek(): i64 { return this.n } }
type H = { c: C | null }
function look(c: Ref<C>): i64 { return c.n }
function main() {
  const o: C | null = new C()
  const d = new C()
  print(look(o!), (o ?? d).n, (o ?? d).peek(), o!.peek(), o!.n)
  const h: H = { c: new C() }
  print(look(h.c!), h.c!.peek())
  print(o?.n, d.n)
}
// expect: 0 0 0 0 0
// expect: 0 0
// expect: 0 0
// case: option_references
// Options through references: written, cleared, narrowed and read with '??'.
type P = { x: i64; o?: i64 }
function setO(p: Mut<P>, v: i64) { p.o = v }
function clear(k: Mut<i64 | null>) { k = null }
function put(k: Mut<i64 | null>, v: i64) { k = v }
function bumpIf(k: Mut<i64 | null>) { if (k !== null) k = k + 1 }
function read(k: Ref<i64 | null>): i64 { return k ?? -1 }
function main() {
  let p: P = { x: 1 }
  setO(p, 5)
  print(p.o)
  let n: i64 | null = 3
  bumpIf(n)
  print(n, read(n))
  clear(n)
  print(n, read(n))
  put(n, 8)
  print(n)
}
// expect: 5
// expect: 4 4
// expect: null -1
// expect: 8
// case: option_unchecked
// An Option's value is used once it is checked.
function main() {
  const x: i64 | null = 1
  print(x + 1)
}
// error: operator '+' can't use the Option 'i64 | null' until it is checked
// case: option_unwrap_borrowed
// 'x!' reads x, which a mutable loan forbids.
function main() {
  let o: i64 | null = 1
  const m: Mut<i64 | null> = o
  print(o!)
  m = null
  print(o)
}
// error: cannot use 'o' while 'm' borrows 'o' mutably and is used later
// case: option_unwrap_conditional_lend
// And a mutable lend of a '!' inside a '?:'.
class C { n: i64 = 0 }
function set(c: Mut<C>) { c.n = 9 }
function main() {
  let o: C | null = new C()
  set(true ? o! : new C())
  print(o?.n)
}
// error: can't lend this mutably through '!', which would lend a copy
// case: option_unwrap_lend
// Lending mutably through '!' would lend a copy.
class C { n: i64 = 0 }
function set(c: Mut<C>) { c.n = 9 }
function main() {
  let o: C | null = new C()
  set(o!)
  print(o?.n)
}
// error: can't lend this mutably through '!', which would lend a copy
// case: option_unwrap_moves
// 'x!' hands over what x holds.
class P { x: i64; constructor(x: i64) { this.x = x } }
function take(p: P) { print(p.x) }
function main() {
  const o: P | null = new P(1)
  take(o!)
  take(o!)
}
// error: 'o' was moved, so it can't be used here
// case: option_unwrap_mutate
// A change through '!' would change a copy.
class P {
  x: i64
  constructor(x: i64) { this.x = x }
  bump(this: Mut<this>) { this.x += 1 }
}
function main() {
  const o: P | null = new P(1)
  o!.bump()
  print(o?.x)
}
// error: can't call 'bump' through '!', which would change a copy
// case: option_unwrap_nested_mutate
// A change through two '!'s would change a copy too.
class C { n: i64 = 0; next(this: Mut<this>): i64 { this.n += 1; return this.n } }
type W = { c: C | null }
function main() {
  let w: W | null = { c: new C() }
  print(w!.c!.next())
  print(w?.c?.n)
}
// error: can't call 'next' through '!', which would change a copy
// case: option_unwrap_not_option
// '!' needs an Option.
function main() {
  const n = 5
  print(n!)
}
// error: '!' takes the value out of an Option, and this is a 'i64', which is never empty
// case: option_unwrap_out_of_borrow
// '!' can't move a value out of an Option a reference borrows.
class P { x: i64; constructor(x: i64) { this.x = x } }
function take(p: P): i64 { return p.x }
function steal(o: Ref<P | null>): i64 {
  return take(o!) + take(o!)
}
function steal2(o: Mut<P | null>): i64 {
  const a = o ?? new P(0)
  const b = o ?? new P(0)
  return a.x + b.x
}
function main() {
  let o: P | null = new P(5)
  print(steal(o), steal2(o))
  print(o?.x)
}
// error: can't move a value out of a reference to it, which only borrows it
// case: option_unwrap_temporary
// A temporary unwrapped with '!' may be changed.
class C { n: i64 = 0; next(this: Mut<this>): i64 { this.n += 1; return this.n } }
function make(): C | null { return new C() }
function plain(): C { return new C() }
function main() {
  print(plain().next())
  print(make()?.next())
  print(make()!.next())
}
// expect: 1
// expect: 1
// expect: 1
