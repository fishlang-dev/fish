// case: closure_argument_holds
// A closure passed to a call holds what it captures until the call ends.
function both(f: () => i64, m: Mut<i64>): i64 {
  m = 5
  return f()
}
function main() {
  let x = 1
  const g = () => x
  print(both(g, x))
}
// error: cannot mutably lend 'x' while 'g' borrows 'x' and is used later
// case: closure_argument_lends
// A closure made for a call lends what it captures for the call.
function both(f: () => i64, m: Mut<i64>): i64 {
  m = 5
  return f()
}
function main() {
  let x = 1
  print(both(() => x, x))
}
// error: cannot mutably lend 'x' while 'x' is lent to 'both' for this call
// case: closure_assigned_capture
// A closure assigning a captured `let` doesn't narrow it, so it may give it another member.
type P = { kind: "p"; x: i64 }
type Q = { kind: "q"; z: i64 }
function main() {
  let u: P | Q = { kind: "p", x: 5 }
  if (u.kind === "p") {
    u = { kind: "q", z: 77 }
  }
  const g = () => {
    if (u.kind === "q") {
      u = { kind: "p", x: 1 }
    }
  }
  g()
  print(u.kind === "p")
}
// expect: true
// case: closure_body_chain
// An arrow whose body is a call through '?.' gives the call's value.
class C {
  n = 2
  peek(): i64 { return this.n }
}
function main() {
  const o: C | null = new C()
  const g = () => o?.peek()
  print(g())
}
// expect: 2
// case: closure_body_forward
// An arrow forwarding a call that returns an Option gives it.
function run(f: () => i64 | null): i64 | null {
  const g = () => f()
  return g()
}
function main() {
  print(run(() => 3))
}
// expect: 3
// case: closure_capture_borrowed
// A closure borrows what it captures while it may still be called.
function main() {
  let x = 1
  const g = () => x
  x = 2
  print(g())
}
// error: cannot change 'x' while 'g' borrows 'x' and is used later
// case: closure_capture_generic
// A closure in a generic function's instance reads its captures as their concrete types.
interface Shape { area(): i64 }
class Sq { constructor(public s: i64) {} area(): i64 { return this.s * this.s } }
class Rect { constructor(public w: i64, public h: i64) {} area(): i64 { return this.w * this.h } }
function g<T extends Shape>(x: T, p: { n: i64 }): i64 {
  const a = (k: i64) => x.area() * k + p.n
  return a(2)
}
function main() {
  const w = { n: 1, m: 5 }
  print(g(new Sq(3), w), g(new Rect(2, 5), { n: 0 }))
}
// expect: 19 20
// case: closure_capture_last_use
// A variable a closure captures is used for as long as the closure is.
type P = { x: i64 }
function main() {
  let p: P = { x: 1 }
  const m: Mut<P> = p
  const r: Ref<P> = p
  print(r.x)
  const g = () => { m.x = 5 }
  g()
  print(r.x)
}
// error: cannot use 'p' while 'm' borrows 'p' mutably and is used later
// case: closure_capture_move_out
// A closure can't move a value out of a reference it captures.
class O { n = 1 }
function take(o: O) {}
function f(r: Ref<O>) {
  const g = () => take(r)
}
function main() {}
// error: can't move a value out of a reference to it, which only borrows it
// case: closure_capture_move_while_held
// What a closure captures can't move while the closure is still called.
class O { n = 1 }
function take(o: O) {}
function main() {
  const o = new O()
  const g = () => o.n
  take(o)
  print(g())
}
// error: cannot move 'o' while 'g' borrows 'o' and is used later
// case: closure_capture_moved
// A closure can't capture a moved variable.
class O { n = 1 }
function take(o: O) {}
function main() {
  const o = new O()
  take(o)
  const g = () => o.n
}
// error: 'o' was moved, so it can't be used here
// case: closure_capture_released
// Once a closure's last call is past, what it captured is free again.
function main() {
  let x = 1
  const g = () => x
  print(g())
  x = 2
  print(x)
}
// expect: 1
// expect: 2
// case: closure_captures
// A closure reads what it captures where it lives: variables, parameters, a narrowed
// variable, `this`, and through nested closures.
type P = { kind: "p"; x: i64 }
type Q = { kind: "q"; z: i64 }
class Box {
  n = 7
  scaled(k: i64): i64 {
    const by = (m: i64) => m * this.n + k
    return by(2)
  }
}
function f(base: i64, u: P | Q): i64 {
  let extra = 100
  const add = (a: i64) => a + base + extra
  const nested = () => {
    const deeper = (b: i64) => add(b) * 2
    return deeper(1)
  }
  if (u.kind === "p") {
    const read = () => u.x
    return add(read()) + nested()
  }
  return 0
}
function main() {
  print(f(10, { kind: "p", x: 5 }), new Box().scaled(3))
}
// expect: 337 17
// case: closure_catches
// A closure that catches its own errors throws nothing.
function t(n: i64): i64 throws i64 { if (n > 0) throw n; return 0 }
function apply(f: (n: i64) => i64): i64 { return f(5) }
function main() {
  print(apply((n) => { try { return t(n) } catch (e) { return e * 2 } }))
}
// expect: 10
// case: closure_copy
// A closure that only borrows copies.
class O { constructor(public n: i64) {} }
function main() {
  const p = new O(7)
  const keep = () => p.n
  const other = keep
  print(keep(), other())
}
// expect: 7 7
// case: closure_escapes_generic
// A closure given for a type parameter is stored, so it can't borrow its locals.
class S { constructor(public n: i64) {} }
function wrap<T>(t: T) { return { v: t } }
function mk() {
  const s = new S(5)
  return wrap(() => s.n)
}
function clobber(): i64 {
  const a = { a: 11, b: 12, c: 13, d: 14, e: 15, f: 16, g: 17, h: 18 }
  const b = { a: 21, b: 22, c: 23, d: 24, e: 25, f: 26, g: 27, h: 28 }
  return a.a + b.h
}
function main() {
  const w = mk()
  print(clobber())
  const f = w.v
  print(f())
}
// error: this closure borrows 's', but a stored callable owns what it captures
// case: closure_field_initializer
// Storing a closure in a field needs the heap, which isn't built yet.
class H {
  f = () => 1
}
function main() {}
// error: functions stored in fields are not supported yet
// case: closure_field_type
// A function type in a field holds a closure, boxed.
class H {
  f: () => i64
  constructor() { this.f = () => 1 }
}
function main() {
  const h = new H()
  print(h.f())
}
// expect: 1
// case: closure_generic_instances
// Closures in generic instances: held captures laid out as their concrete types, closures
// passed on from generic bodies and from function-typed parameters, `this` in a nested closure,
// and narrowing a capture inside its closure.
interface Shape0 { area(): i64 }
class Sq0 { constructor(public s: i64) {} area(): i64 { return this.s * this.s } }
function g0<T extends Shape0>(x: T): i64 {
  const a = move () => x.area()
  return a()
}
function apply1(f: () => i64): i64 {
  const g = () => f() + 1
  return g()
}
function applyMove1(f: () => i64): i64 {
  const g = move () => f() + 1
  return g()
}
function apply2(f: (k: i64) => i64): i64 { return f(2) }
function g2<T>(x: T): i64 {
  return apply2((k) => k + 1)
}
interface Shape3 { area(): i64 }
class Sq3 { constructor(public s: i64) {} area(): i64 { return this.s * this.s } }
function apply3(f: () => i64): i64 { return f() }
function g3<T extends Shape3>(x: T): i64 {
  return apply3(() => x.area())
}
function apply4(f: () => i64): i64 { return f() }
function outer4(f: () => i64): i64 {
  return apply4(() => f() * 2)
}
class C5 {
  n = 3
  get(): i64 {
    const mid = () => {
      const inner = () => this.n * 2
      return inner()
    }
    return mid()
  }
}
type P6 = { kind: "p"; x: i64 }
type Q6 = { kind: "q"; z: i64 }
function f6(u: P6 | Q6): i64 {
  const g = () => {
    if (u.kind === "p") return u.x
    return 0
  }
  return g()
}
function f7(u: i64 | boolean): i64 {
  const g = () => typeof u === "number" ? u + 1 : 0
  return g()
}
function main() {
  print(g0(new Sq0(3)))
  let x = 10
  print(apply1(() => x), applyMove1(() => x * 2))
  print(g2(true))
  print(g3(new Sq3(3)))
  let y = 7
  print(outer4(() => y))
  print(new C5().get())
  print(f6({ kind: "p", x: 5 }))
  print(f7(5))
}
// expect: 9
// expect: 11 21
// expect: 3
// expect: 9
// expect: 14
// expect: 6
// expect: 5
// expect: 6
// case: closure_in_object
// expect: 1 13
// An arrow in an object literal is stored as a callable owning what it captures.
function main() {
  const base = 10;
  const o = { f: () => 1, g: (n: i64) => n + base };
  console.log(o.f(), o.g(3));
}
// case: closure_keep_field
// Nor in a field of one.
type P = { x: i64 }
type H = { r: Ref<P> }
function clobber(): i64 {
  const a = { a: 11, b: 12, c: 13, d: 14, e: 15, f: 16, g: 17, h: 18 }
  const b = { a: 21, b: 22, c: 23, d: 24, e: 25, f: 26, g: 27, h: 28 }
  return a.a + b.h
}
function put(f: (a: Ref<P>) => void) {
  const t: P = { x: 42 }
  f(t)
}
function main() {
  let q: P = { x: 1 }
  let h: H = { r: q }
  put((a) => { h.r = a })
  print(clobber())
  print(h.r.x)
}
// error: keeping references in 'h', which this closure captures, is not supported yet
// case: closure_keep_whole
// A closure can't keep a reference it was given in a variable it captures.
type P = { x: i64 }
type H = { r: Ref<P> }
function clobber(): i64 {
  const a = { a: 11, b: 12, c: 13, d: 14, e: 15, f: 16, g: 17, h: 18 }
  const b = { a: 21, b: 22, c: 23, d: 24, e: 25, f: 26, g: 27, h: 28 }
  return a.a + b.h
}
function put(f: (a: Ref<P>) => void) {
  const t: P = { x: 42 }
  f(t)
}
function main() {
  let q: P = { x: 1 }
  let h: H = { r: q }
  put((a) => { h = { r: a } })
  print(clobber())
  print(h.r.x)
}
// error: keeping references in 'h', which this closure captures, is not supported yet
// case: closure_local
// An arrow function is a closure: called through the variable holding it, with an expression
// or block body, in plain, generic and method bodies, and nested.
type P = { x: i64; y: i64 }
function local() {
  const add = (a: i64, b: i64) => a + b
  print(add(1, 2))
  const sum = (p: P): i64 => {
    if (p.x > p.y) return p.x - p.y
    return p.x + p.y
  }
  print(sum({ x: 5, y: 2 }), sum({ x: 1, y: 2 }))
  const say = (n: i64) => print(n * 10)
  say(4)
  const inner = (n: i64) => {
    const twice = (m: i64) => m * 2
    return twice(n) + 1
  }
  print(inner(20))
}
interface Shape { area(): i64 }
class Sq { constructor(public s: i64) {} area(): i64 { return this.s * this.s } }
function twice<T extends Shape>(x: T): i64 {
  const dbl = (n: i64) => n * 2
  return dbl(x.area())
}
class C {
  n = 3
  get(): i64 {
    const sq = (k: i64) => k * k
    return sq(this.n)
  }
}
function main() {
  local()
  print(twice(new Sq(3)), new C().get())
}
// expect: 3
// expect: 3 3
// expect: 40
// expect: 41
// expect: 18 9
// case: closure_move_captured
// A closure that moves out a capture takes it over when made.
class O { constructor(public n: i64) {} }
function take(o: O): i64 { return o.n }
function main() {
  const o = new O(5)
  const once = () => take(o)
  print(o.n)
}
// error: 'o.n' can't be used here because 'o' was moved
// case: closure_move_const
// A move closure can't change its copy of a constant.
function main() {
  const n: u8 = 1
  const g = move () => { n++; print(n) }
  g()
  g()
  print(n)
}
// error: cannot assign to 'n' in this closure because 'n' is a constant; declare it with 'let'
// case: closure_move_inside
// Inside a closure, a capture it moved out is gone.
class O { constructor(public n: i64) {} }
function take(o: O): i64 { return o.n }
function main() {
  const o = new O(5)
  const once = () => {
    take(o)
    return o.n
  }
}
// error: 'o.n' can't be used here because 'o' was moved
// case: closure_move_keyword
// A `move` closure takes over what it captures.
class O { constructor(public n: i64) {} }
function main() {
  const p = new O(7)
  const keep = move () => p.n
  print(p.n)
}
// error: 'p.n' can't be used here because 'p' was moved
// case: closure_move_let_copy
// A move closure changes its own copy of a let.
function main() {
  let n: u8 = 1
  const g = move () => {
    n++
    print(n)
  }
  g()
  g()
  print(n)
}
// expect: 2
// expect: 3
// expect: 1
// case: closure_move_nested
// A closure moving a capture into a nested closure moves it out of itself, so it runs once.
class S { constructor(public n: i64) {} }
function take(s: S): i64 { return s.n }
function main() {
  const s = new S(4)
  const mid = () => {
    const inner = () => take(s)
    return inner()
  }
  print(mid())
  print(mid())
  print(take(s))
}
// error: 'mid' was moved, so it can't be used here
// case: closure_move_nested_mut
// A nested `move` closure changing through a captured `Mut` makes the outer closure borrow it mutably.
type P = { x: i64 }
function main() {
  let p: P = { x: 1 }
  const m: Mut<P> = p
  const mid = () => {
    const inner = move () => { m.x = m.x + 1 }
    inner()
  }
  const r: Ref<P> = m
  print(r.x)
  mid()
  print(r.x)
}
// error: cannot use 'm' while 'mid' borrows 'm' mutably and is used later
// case: closure_moves
// A closure holds what it moves out, or everything under `move`; one that only borrows or
// copies is itself copied, and `move(x)` without an arrow is a call.
class O { constructor(public n: i64) {} }
function take(o: O): i64 { return o.n }
function apply(f: (x: i64) => i64, v: i64): i64 { return f(v) + f(v) }
function move(x: i64): i64 { return x + 1 }
function main() {
  const o = new O(5)
  const once = () => take(o)
  print(once())
  const p = new O(7)
  const keep = move () => p.n * 2
  print(keep(), keep())
  let n = 10
  const counter = move () => {
    n++
    return n
  }
  print(counter(), counter(), n)
  const base = 3
  const add = (x: i64) => x + base
  print(apply(add, 1), apply(add, 2))
  print(move(1))
}
// expect: 5
// expect: 14 14
// expect: 11 12 10
// expect: 8 10
// expect: 2
// case: closure_mutable_borrowed
// A closure changing a capture borrows it mutably while it may still be called.
function main() {
  let count = 0
  const inc = () => { count++ }
  print(count)
  inc()
}
// error: cannot use 'count' while 'inc' borrows 'count' mutably and is used later
// case: closure_mutable_captures
// A closure that changes what it captures captures it mutably: counters, a mutating method
// on a capture or on `this`, lending a capture on, and through a nested closure.
class Counter {
  n = 0
  bump(this: Mut<this>) { this.n++ }
  twice(this: Mut<this>): i64 {
    const go = () => this.bump()
    go()
    go()
    return this.n
  }
}
function poke(m: Mut<i64>) { m += 100 }
function each(n: i64, f: (i: i64) => void) {
  let i = 0
  while (i < n) {
    f(i)
    i++
  }
}
function main() {
  let count = 0
  const inc = () => { count++ }
  inc()
  inc()
  print(count)
  let sum = 0
  each(4, (i) => { sum += i })
  print(sum)
  let c = new Counter()
  const tick = () => c.bump()
  tick()
  print(c.n, new Counter().twice())
  let k = 1
  const lend = () => poke(k)
  lend()
  print(k)
  let outer = 0
  const nest = () => {
    const deeper = () => { outer = outer + 5 }
    deeper()
  }
  nest()
  print(outer)
}
// expect: 2
// expect: 6
// expect: 1 2
// expect: 101
// expect: 5
// case: closure_mutable_const
// A closure can't change a constant it captures.
function main() {
  const count = 0
  const inc = () => { count++ }
}
// error: cannot assign to 'count' because it is a constant
// case: closure_mutable_moves
// A closure changing a capture moves rather than copies.
function main() {
  let n = 1
  const bump = () => { n++ }
  const other = bump
  bump()
}
// error: 'bump' was moved, so it can't be used here
// case: closure_mutable_narrowed
// A closure can't change the member of a variable a check outside it narrowed.
type P = { kind: "p"; x: i64 }
type Q = { kind: "q"; z: i64 }
function f(m: Mut<P | Q>) {
  if (m.kind === "q") {
    const g = () => { m = { kind: "p", x: 1 } }
    g()
  }
}
function main() {}
// error: can't give 'm' another member inside a closure while a check outside it narrows it
// case: closure_mutable_param
// A closure can't assign a captured parameter, as the body can't.
function f(x: i64) {
  const g = () => { x = 2 }
}
function main() {}
// error: assigning to a parameter is not supported yet; copy it into a 'let'
// case: closure_mutable_shared_ref
// A closure can't change what a captured shared reference points to.
class P { x = 0 }
function f(r: Ref<P>) {
  const g = () => { r.x = 2 }
}
function main() {}
// error: cannot assign to 'r.x' because 'r' is a shared reference ('Ref'), which only reads
// case: closure_mutable_this
// A closure changes `this` only where `this` may change.
class C {
  n = 0
  get(): i64 {
    const f = () => { this.n = 1 }
    return 0
  }
}
function main() {}
// error: cannot assign to 'this.n' because 'this' is read-only here; declare 'this: Mut<this>'
// case: closure_mutable_twice
// Two closures can't both change one variable while both may be called.
function main() {
  let x = 0
  const a = () => { x++ }
  const b = () => { x++ }
  a()
  b()
}
// error: cannot mutably lend 'x' while 'a' borrows 'x' mutably and is used later
// case: closure_mutable_while_read
// A closure can't change a variable another live closure reads.
function main() {
  let x = 0
  const a = () => x
  const b = () => { x++ }
  b()
  print(a())
}
// error: cannot mutably lend 'x' while 'a' borrows 'x' and is used later
// case: closure_narrowed_mut_own_check
// A closure narrowing a captured `Mut` itself may give it another member after the check.
type P = { kind: "p"; x: i64 }
type Q = { kind: "q"; z: i64 }
function plain(u: Mut<P | Q>): i64 {
  if (u.kind !== "p") return 0
  const v = u.x
  u = { kind: "q", z: 1 }
  return v
}
function f(u: Mut<P | Q>): i64 {
  const g = () => {
    if (u.kind !== "p") return 0
    const v = u.x
    u = { kind: "q", z: 1 }
    return v
  }
  return g()
}
function main() { let v: P | Q = { kind: "p", x: 5 }; print(plain(v)); let w: P | Q = { kind: "p", x: 6 }; print(f(w)) }
// expect: 5
// expect: 6
// case: closure_not_callable
// Only a closure can be called through a variable.
function main() {
  const k = 1
  print(k(2))
}
// error: this expression is not callable: type 'i64' has no call signatures
// case: closure_parameter_extra
// A closure can't take more parameters than a function type passes.
function apply(f: (x: i64) => i64, v: i64): i64 { return f(v) }
function main() {
  print(apply((a, b) => a, 2))
}
// error: '(x: i64) => i64' passes 1 argument, so this closure can't take 'b'
// case: closure_parameter_mismatch
// A closure must take the parameter types a function type passes.
function apply(f: (x: i64) => i64, v: i64): i64 { return f(v) }
function main() {
  print(apply((x: boolean) => 1, 2))
}
// error: argument of type '(x: boolean) => i64' is not assignable to parameter of type '(x: i64) => i64'
// case: closure_parameter_passed_on
// A parameter of a function type may be passed on to another.
function once(f: (x: i64) => i64): i64 { return f(1) }
function pass(f: (x: i64) => i64): i64 { return once(f) }
function main() {
  const k = 5
  print(pass((x) => x + k), pass((x) => x * 7))
}
// expect: 6 7
// case: closure_parameters
// A parameter with a function type takes any closure fitting it, typing an arrow's unwritten
// parameters; an arrow may take fewer parameters than the type passes.
function apply(f: (x: i64) => i64, v: i64): i64 {
  return f(v) + f(v + 1)
}
function each(n: i64, f: (i: i64, last: boolean) => void) {
  let i = 0
  while (i < n) {
    f(i, i === n - 1)
    i++
  }
}
class Acc {
  total = 0
  run(f: (x: i64) => i64): i64 { return f(this.total + 1) }
}
function main() {
  const base = 10
  print(apply((x) => x * 2, 3), apply((x: i64) => x + base, 1))
  const sq = (x: i64) => x * x
  print(apply(sq, 4))
  each(3, (i) => print(i))
  each(2, (i, last) => print(i, last))
  const typed: (n: i64) => i64 = (n) => n - 1
  print(typed(5), new Acc().run((x) => x + base))
}
// expect: 14 23
// expect: 41
// expect: 0
// expect: 1
// expect: 2
// expect: 0 false
// expect: 1 true
// expect: 4 11
// case: closure_return_number
// A closure returns the number type of the function type it meets.
function main() {
  const f: (x: u8) => boolean = (x) => x > 1
  const g: () => u8 = () => { return 5 }
  print(f(2), g())
}
// expect: true 5
// case: closure_return_type
// A function returning a function type gives a boxed closure.
function make(): (x: i64) => i64 {
  return (x) => x
}
function main() {
  print(make()(4))
}
// expect: 4
// case: closure_returned
// A closure is returned through a declared function type, which boxes it.
function make() {
  return () => 1
}
function main() { make() }
// error: functions returned without a function return type are not supported yet
// case: closure_run_once
// A closure that moves out a capture runs once, so calling it takes it over.
class O { constructor(public n: i64) {} }
function take(o: O): i64 { return o.n }
function main() {
  const o = new O(5)
  const once = () => take(o)
  once()
  once()
}
// error: 'once' was moved, so it can't be used here
// case: closure_run_once_loop
// A function calling its parameter in a loop can't take a run-once closure.
class S { constructor(public n: i64) {} }
function take(s: S): i64 { return s.n }
function each(n: i64, f: () => i64) {
  let i = 0
  while (i < n) {
    f()
    i++
  }
}
function main() {
  const s = new S(4)
  each(2, () => take(s))
}
// error: 'each' may call 'f' more than once, but this closure moves 's' out, so it can run only once
// case: closure_run_once_passed
// A run-once closure may be passed to a function that calls it at most once, and a function
// type parameter may be passed on.
class S { constructor(public n: i64) {} }
function take(s: S): i64 { return s.n }
function once(f: () => i64): i64 { return f() }
function maybe(c: boolean, f: () => i64): i64 {
  if (c) return f()
  return 0
}
function main() {
  const s = new S(4)
  print(once(() => take(s)))
  const t = new S(9)
  const g = () => take(t)
  print(maybe(true, g))
}
// expect: 4
// expect: 9
// case: closure_run_once_passed_on
// Passing a parameter on counts as calling it again, since how often the next function calls it isn't known here.
class S { constructor(public n: i64) {} }
function take(s: S): i64 { return s.n }
function once(f: () => i64): i64 { return f() }
function pass(f: () => i64): i64 { return once(f) }
function main() {
  const s = new S(4)
  print(pass(() => take(s)))
}
// error: 'pass' may call 'f' more than once, but this closure moves 's' out, so it can run only once
// case: closure_run_once_twice
// A function calling its parameter twice can't take a run-once closure.
class S { constructor(public n: i64) {} }
function take(s: S): i64 { return s.n }
function twice(f: () => i64): i64 { return f() + f() }
function main() {
  const s = new S(4)
  print(twice(() => take(s)))
}
// error: 'twice' may call 'f' more than once, but this closure moves 's' out, so it can run only once
// case: closure_this_nested_constructor
// A closure nested in a closure in a constructor can't use `this` before every field is set.
class C {
  n: i64
  m: i64
  constructor() {
    this.n = 1
    const a = () => { const b = () => this.m; return b() }
    print(a())
    this.m = 2
  }
}
function main() { new C() }
// error: 'this' can't be used until every field is assigned
// case: closure_union
// expect: 1
// expect: 42
// A union holds a function as a stored callable.
function pick(u: i64 | ((n: i64) => i64)): i64 {
  if (typeof u === "number") return u;
  return u(21);
}
function main() {
  let u: i64 | ((n: i64) => i64) = 1;
  console.log(pick(u));
  const o = { f: (n: i64) => n * 2 };
  console.log(o.f(21));
}
// case: closure_union_conditional
// A union can't hold two closures.
function apply(f: () => i64): i64 { return f() }
function main() {
  const c = true
  const f = c ? () => 1 : () => 2
  print(apply(f))
}
// error: unions holding functions are not supported yet
// case: closure_untyped_param
// A closure's parameter needs a type when nothing gives it one.
function main() {
  const f = (a) => a
}
// error: parameter 'a' implicitly has an 'any' type; add a type annotation
