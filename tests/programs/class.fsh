// case: class_as_value
class Point {}

function main() {
  const k = Point
}
// error: classes can't be used as values yet; construct one with 'new'
// case: class_constructor_value
class A {
  constructor() {
    return 5
  }
}

function main() {}
// error: a constructor can't return a value
// case: class_duplicate_name
type Point = { x: i64 }
class Point {}

function main() {}
// error: duplicate type name 'Point'
// case: class_from_object
class Point {
  constructor(public x: i64) {}
}

function take(p: Point) {}

function main() {
  const o = { x: 1 }
  take(o)
}
// error: argument of type '{ x: i64 }' is not assignable to parameter of type 'Point'
// case: class_generic_contains_itself
// error: class 'Node<T>' contains itself, so it would have infinite size
// A generic class holding itself inline is refused like a plain one, not left to overflow.
class Node<T> { v: T; next: Node<T> | null; constructor(v: T) { this.v = v; this.next = null; } }
function main() { const n = new Node<i64>(1); console.log(n.next === null); }
// case: class_getter_assign
class Counter {
  constructor(public n: i64) {}
}

class Holder {
  constructor(public inner: Counter) {}

  get copy(): Counter {
    return this.inner
  }
}

function main() {
  let h = new Holder(new Counter(1))
  h.copy.n = 5
}
// error: can only assign to a variable or a field
// case: class_getter_paths
class Counter {
  constructor(public n: i64) {}

  bump(this: Mut<this>): i64 {
    this.n++
    return this.n
  }

  read(): i64 {
    return this.n
  }
}

class Holder {
  constructor(public inner: Counter) {}

  get copy(): Counter {
    return this.inner.clone()
  }
}

function main() {
  let h = new Holder(new Counter(1))
  // The getter returns a copy, so bumping it leaves the holder alone.
  print(h.copy.bump(), h.copy.read(), h.inner.n)
}
// expect: 2 1 1
// case: class_initializer_field
class A {
  a: i64 = this.b + 1
  b: i64 = 41
}

function main() {}
// error: 'this' can't be used until every field is assigned
// case: class_initializer_method
class A {
  a: i64 = this.get()
  b = 1

  get(): i64 {
    return this.b
  }
}

function main() {}
// error: 'this' can't be used until every field is assigned
// case: class_initializer_parameter
class A {
  y: i64 = x

  constructor(x: i64) {}
}

function main() {}
// error: cannot find name 'x'
// case: class_literal
class User {
  id: i64
  admin: boolean

  constructor(id: i64) {
    this.id = id
    this.admin = id === 0
  }

  label(): i64 {
    return this.admin ? -this.id : this.id
  }
}

class Team {
  size = 1

  constructor(public lead: User) {}
}

function describe(u: User): i64 {
  return u.label()
}

function main() {
  const u: User = { id: 7, admin: true }
  print(u.id, u.admin, u.label())
  print(describe({ admin: false, id: 3 }))
  const admin = false
  const id = 4
  const v: User = { id, admin }
  print(v.label())
  // A nested literal builds the class of its field.
  const t: Team = { size: 2, lead: { id: 9, admin: false } }
  print(t.lead.label(), t.size)
  let w: User = new User(0)
  w = { id: 5, admin: true }
  print(w.label())
}
// expect: 7 true -7
// expect: 3
// expect: 4
// expect: 9 2
// expect: -5
// case: class_literal_extra
class User {
  constructor(public id: i64) {}
}

function main() {
  const u: User = { id: 1, name: 2 }
}
// error: object literal may only specify known properties, and 'name' does not exist in type 'User'
// case: class_literal_field_type
class User {
  constructor(public id: i64) {}
}

function main() {
  const u: User = { id: true }
}
// error: type 'boolean' is not assignable to type 'i64'
// case: class_literal_missing
class User {
  constructor(public id: i64, public admin: boolean) {}
}

function main() {
  const u: User = { id: 1 }
}
// error: property 'admin' is missing in type '{ id: i64 }' but required in type 'User'
// case: class_literal_private
class User {
  constructor(public id: i64, private secret: i64) {}
}

function main() {
  const u: User = { id: 1, secret: 2 }
}
// error: an object literal can't build 'User' because 'secret' is private; use 'new'
// case: class_method_constructor
class Unit {
  "constructor"(): i64 {
    return 1
  }
}

function main() {}
// error: 'constructor' can't be the name of a method
// case: class_new_arguments
class Point {
  constructor(public x: i64) {}
}

function main() {
  const p = new Point(1, 2)
}
// error: expected 1 argument, but got 2
// case: class_new_non_class
function make(): i64 {
  return 1
}

function main() {
  new make()
}
// error: only a class can be constructed with 'new'
// case: class_nominal
class Meters {
  constructor(public value: i64) {}
}

class Feet {
  constructor(public value: i64) {}
}

function main() {
  const m: Meters = new Feet(3)
}
// error: type 'Feet' is not assignable to type 'Meters'
// case: class_receiver_order
class Unit {
  value(n: i64): i64 {
    return n
  }
}

function make(): Unit {
  print("receiver")
  return new Unit()
}

function argument(): i64 {
  print("argument")
  return 1
}

function main() {
  print(make().value(argument()))
}
// expect: receiver
// expect: argument
// expect: 1
// case: class_recursive
class Node {
  constructor(public next: Node) {}
}

function main() {}
// error: class 'Node' contains itself, so it would have infinite size
// case: class_return_early
class Point {
  x: i64

  constructor(skip: boolean) {
    if (skip) return
    this.x = 1
  }
}

function main() {}
// error: a constructor can't return before every field is assigned
// case: class_setter_early
class A {
  x: i64
  y: i64

  constructor() {
    this.v = 5
    this.x = 1
    this.y = 2
  }

  set v(n: i64) {
    print(this.x + this.y + n)
  }
}

function main() {}
// error: 'this' can't be used until every field is assigned
// case: class_static_same_name
class Unit {
  value(): i64 {
    return 1
  }

  static value(): i64 {
    return 2
  }
}

function main() {
  print(new Unit().value(), Unit.value())
}
// expect: 1 2
// case: class_this_early
class Point {
  x: i64
  y: i64

  constructor(x: i64) {
    this.x = x
    this.y = this.x
  }
}

function main() {}
// error: 'this' can't be used until every field is assigned
// error:     this.y = this.x
// error:              ^^^^
// case: class_this_outside
function main() {
  print(this)
}
// error: 'this' can only be used inside a class
// case: class_unassigned
class Point {
  x: i64
  y: i64

  constructor(x: i64) {
    this.x = x
  }
}

function main() {}
// error: property 'y' has no initializer and is not definitely assigned in the constructor
// error:   y: i64
// error:   ^^^^^^
