// case: readonly
// Readonly fields are read freely and set only while their class is constructed; a copy into
// a writable type is its own value, so it can be written.
type Point = { readonly x: i64; y: i64 }

interface Named {
  readonly id: i64
}

class Counter {
  readonly start: i64 = 10
  readonly step: i64
  constructor(readonly label: i64, step: i64) {
    this.step = step
  }
  next(n: i64): i64 {
    return this.start + this.step * n + this.label
  }
}

class Tag {
  id = 3
}

function idOf(n: Named): i64 {
  return n.id
}

function main() {
  let p: Point = { x: 1, y: 2 }
  p.y = 5
  let q: { x: i64; y: i64 } = p.clone()
  q.x = 9
  const c = new Counter(100, 2)
  print(p.x, p.y, q.x, c.next(3), c.label, idOf(new Tag()), idOf({ id: 4 }))
}
// expect: 1 5 9 116 100 3 4
// case: readonly_base_field
class Base {
  readonly n: i64 = 0
}

class Derived extends Base {
  constructor() {
    super()
    this.n = 2
  }
}

function main() {
  print(new Derived().n)
}
// error: cannot assign to 'n' because it is a read-only property
// case: readonly_bound_write
interface Named {
  readonly id: i64
}

function rename(n: Named): i64 {
  let copy = n
  copy.id = 5
  return copy.id
}

function main() {
  print(rename({ id: 1 }))
}
// error: cannot assign to 'id' because it is a read-only property
// case: readonly_class_write
class Counter {
  readonly n: i64 = 0
}

function main() {
  let c = new Counter()
  c.n += 1
}
// error: cannot assign to 'n' because it is a read-only property
// case: readonly_copy_type_parameter
// So may a copy given to a type parameter.
class A { readonly id: i64 = 1 }
function bump<T extends { id: i64 }>(x: T): i64 { let c = x; c.id = 5; return c.id }
function main() { const a = new A(); print(bump(a)) }
// expect: 5
// case: readonly_copy_write
// A copy of a value with read-only fields may be changed through a writable type.
type Locked = { readonly id: i64 }
function bump(x: { id: i64 }): i64 { let c = x; c.id = 5; return c.id }
function main() { const l: Locked = { id: 1 }; print(bump(l)) }
// expect: 5
// case: readonly_method_write
class Counter {
  readonly n: i64 = 0
  bump(this: Mut<this>) {
    this.n = this.n + 1
  }
}

function main() {
  let c = new Counter()
  c.bump()
}
// error: cannot assign to 'n' because it is a read-only property
// case: readonly_mut_box
// And one inside a mutably borrowed generic class.
class A { readonly id: i64 = 1 }
class Box<T> { constructor(public v: T) {} }
function f<T extends { id: i64 }>(b: Mut<Box<T>>) { b.v.id = 5 }
function main() { let b = new Box(new A()); f(b); print(b.v.id) }
// error: cannot assign to 'id' because it is a read-only property
// case: readonly_mut_class_method
// A class's type parameter in a method keeps what it stands for read-only.
class A { readonly id: i64 = 1 }
class K<T extends { id: i64 }> { put(x: Mut<T>) { x.id = 2 } }
function main() { let a = new A(); const k = new K<A>(); k.put(a); print(a.id) }
// error: cannot assign to 'id' because it is a read-only property
// case: readonly_mut_field_ref
// And one a generic class holds mutably.
class A { readonly id: i64 = 1 }
class Box<T> { constructor(public m: Mut<T>) {} }
function f<T extends { id: i64 }>(b: Box<T>) { b.m.id = 5 }
function main() { let a = new A(); f(new Box(a)); print(a.id) }
// error: cannot assign to 'id' because it is a read-only property
// case: readonly_mut_forward
// A type parameter passed on to a writable view keeps its read-only fields.
class A { readonly id: i64 = 1 }
function inner(x: Mut<{ id: i64 }>) { x.id = 9 }
function outer<T extends { id: i64 }>(x: Mut<T>) { inner(x) }
function main() { let a = new A(); outer(a); print(a.id) }
// error: 'id' is read-only here, but 'outer' takes it mutably
// case: readonly_mut_generic_class
// So is a generic class's.
class A { readonly id: i64 = 1 }
class Box<T extends { id: i64 }> {
  constructor(public m: Mut<T>) {}
  set(this: Mut<this>) { this.m.id = 7 }
}
function main() { let a = new A(); let b = new Box(a); b.set(); print(a.id) }
// error: 'id' is read-only here, but 'Box<A>' takes it mutably
// case: readonly_mut_holder
// So does a type parameter held mutably in an object parameter.
class A { readonly id: i64 = 1 }
function f<T extends { id: i64 }>(h: { m: Mut<T> }) { h.m.id = 5 }
function main() { let a = new A(); f({ m: a }); print(a.id) }
// error: cannot assign to 'id' because it is a read-only property
// case: readonly_mut_implicit
// A readonly field can't be lent mutably as one declared writable.
class Account {
  readonly id: i64
  constructor(id: i64) { this.id = id }
}
type Writable = { id: i64 }
function forge(x: Mut<Writable>) { x.id = 999 }
function main() {
  const a = new Account(1)
  let b = new Account(2)
  forge(b)
  print(b.id)
}
// error: 'id' is read-only here, but 'forge' takes it mutably as '{ id: i64 }', which could change it
// case: readonly_mut_interface
// Nor through an interface declaring it writable.
interface HasId { id: i64 }
class Account { readonly id: i64 = 1 }
function forge(x: Mut<HasId>) { x.id = 999 }
function main() { let b = new Account(); forge(b); print(b.id) }
// error: 'id' is read-only here, but 'forge' takes it mutably as 'HasId', which could change it
// case: readonly_mut_local
// Nor to a mutable reference variable.
class Account { readonly id: i64; n = 0; constructor(id: i64) { this.id = id } }
type Writable = { id: i64 }
function main() {
  let b = new Account(2)
  const m: Mut<Writable> = b
  m.id = 9
  print(b.id)
}
// error: 'id' is read-only here, so it can't be lent mutably as '{ id: i64 }'
// case: readonly_mut_other_fields
// Lending a value with readonly fields mutably as a type without them is fine.
class Account { readonly id: i64; n = 0; constructor(id: i64) { this.id = id } }
type Counter = { n: i64 }
function bump(c: Mut<Counter>) { c.n += 1 }
function peek(c: Ref<{ id: i64 }>): i64 { return c.id }
function main() {
  let b = new Account(2)
  bump(b)
  print(b.n, peek(b))
}
// expect: 1 2
// case: readonly_mut_type_parameter
// A type parameter's field is as read-only as the field of what it stands for.
class A { readonly id: i64 = 1 }
function forge<T extends { id: i64 }>(x: Mut<T>) { x.id = 999 }
function main() { let a = new A(); forge(a); print(a.id) }
// error: 'id' is read-only here, but 'forge' takes it mutably as '{ id: i64 }', which could change it
// case: readonly_mut_type_parameter_nested
// A nested read-only field can't be lent mutably as writable through a type parameter.
class In { readonly v: i64 = 1 }
class A { inner: In = new In() }
function forge<T extends { inner: { v: i64 } }>(x: Mut<T>) { x.inner.v = 9 }
function main() { let a = new A(); forge(a); print(a.inner.v) }
// error: 'inner.v' is read-only here, but 'forge' takes it mutably
// case: readonly_mut_writable_routes
// With a writable field, each of these writes through.
class A { id: i64 = 1 }
class K<T extends { id: i64 }> { put(x: Mut<T>) { x.id = 2 } }
function main() { let a = new A(); const k = new K<A>(); k.put(a); print(a.id) }
// expect: 2
// case: readonly_mutating_call
class Counter {
  n: i64 = 0
  bump(this: Mut<this>) {
    this.n = this.n + 1
  }
}

class Holder {
  readonly c = new Counter()
}

function main() {
  let h = new Holder()
  h.c.bump()
}
// error: cannot call 'bump' on 'c' because it is a read-only property
// case: readonly_nested_write
type Inner = { x: i64 }
type Outer = { readonly inner: Inner }

function main() {
  let o: Outer = { inner: { x: 1 } }
  o.inner.x++
}
// error: cannot assign to 'o.inner.x' because 'inner' is a read-only property
// case: readonly_object_write
type Point = { readonly x: i64; y: i64 }

function main() {
  let p: Point = { x: 1, y: 2 }
  p.x = 3
}
// error: cannot assign to 'x' because it is a read-only property
// case: readonly_this_generic
// A generic class's own value of T keeps what it stands for read-only.
class A { readonly id: i64 = 1 }
class Box<T extends { id: i64 }> {
  constructor(public v: T) {}
  set(this: Mut<this>) { this.v.id = 7 }
}
function main() { let b = new Box(new A()); b.set(); print(b.v.id) }
// error: cannot assign to 'id' because it is a read-only property
// case: readonly_this_generic_call
// Nor call a mutating method on a read-only field of one.
class C { n: i64 = 0; inc(this: Mut<this>) { this.n += 1 } }
class A { readonly c: C = new C() }
class Box<T extends { c: C }> {
  constructor(public v: T) {}
  set(this: Mut<this>) { this.v.c.inc() }
}
function main() { let b = new Box(new A()); b.set(); print(b.v.c.n) }
// error: cannot call 'inc' on 'c' because it is a read-only property
// case: readonly_this_generic_constructor
// Its constructor can't write a read-only field of a value it was given.
class A { readonly id: i64 = 1 }
class Box<T extends { id: i64 }> {
  v: T
  constructor(v: T) { this.v = v; this.v.id = 7 }
}
function main() { let b = new Box(new A()); print(b.v.id) }
// error: cannot assign to 'id' because it is a read-only property
