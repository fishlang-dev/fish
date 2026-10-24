// case: intersection_class
class A {
  a = 1
}

function f(p: { b: i64 } & A): i64 {
  return p.b
}

function main() {}
// error: intersections with classes are not supported yet
// case: intersection_conflict
type A = { a: i64 }
type B = { a: boolean }

function main() {
  const x: A & B = { a: 1 }
}
// error: property 'a' has type 'i64' on one side of '&' and 'boolean' on the other
// case: intersection_interface_conflict
interface A {
  get(): i64
}

interface B {
  get(): boolean
}

function f(x: A & B): i64 {
  return 1
}

function main() {}
// error: method 'get' has different types on each side of '&'
// case: intersection_interface_missing
interface Shape {
  area(): i64
}

interface Named {
  id: i64
}

class Blob {
  id = 1
}

function score(s: Shape & Named): i64 {
  return s.id + s.area()
}

function main() {
  print(score(new Blob()))
}
// error: method 'area' is missing in type 'Blob' but required in type 'Shape & Named'
// case: intersection_interfaces
// `A & B` with an interface is a combined bound: anything with every side's members satisfies
// it, wherever an interface is used.
interface Shape {
  area(): i64
}

interface Named {
  id: i64
}

class Square {
  id = 7
  side = 3
  area(): i64 {
    return this.side * this.side
  }
}

class Rect {
  id = 8
  w = 2
  h = 5
  area(): i64 {
    return this.w * this.h
  }
}

function score(s: Shape & Named): i64 {
  return s.id * 100 + s.area()
}

function scoreAll<T extends Shape & { id: i64 }>(t: T): i64 {
  return t.id + t.area()
}

function pick(big: boolean): Shape & Named {
  return new Square()
}

function main() {
  const s: Shape & Named = new Rect()
  print(score(new Square()), score(new Rect()), scoreAll(new Square()), pick(true).area(), s.id)
}
// expect: 709 810 16 9 8
// case: intersection_objects
// `A & B` of object types is one merged struct, merging nested object fields; a field is
// readonly only when both sides say so.
type Named = { name: i64; meta: { created: i64 } }
type Aged = { age: i64; meta: { updated: i64 } }
type Person = Named & Aged

type Locked = { readonly id: i64 } & { readonly id: i64; note: i64 }
type Open = { readonly id: i64 } & { id: i64 }

function describe(p: Named & Aged): i64 {
  return p.name * 1000 + p.age * 100 + p.meta.created * 10 + p.meta.updated
}

function main() {
  let p: Person = { name: 1, age: 2, meta: { created: 3, updated: 4 } }
  p.age = 5
  p.meta.updated = 6
  const same: { age: i64; meta: { created: i64; updated: i64 }; name: i64 } = p.clone()
  let o: Open = { id: 1 }
  o.id = 7
  const l: Locked = { id: 8, note: 9 }
  print(describe(p), describe(same), o.id, l.id + l.note)
}
// expect: 1536 1536 7 17
// case: intersection_primitive
type Id = i64 & { __brand: "Id" }

function main() {}
// error: intersections with primitive types are not supported yet
// case: intersection_readonly
type Locked = { readonly id: i64 } & { readonly id: i64; note: i64 }

function main() {
  let l: Locked = { id: 1, note: 2 }
  l.id = 3
}
// error: cannot assign to 'id' because it is a read-only property
// case: intersection_type_parameter
function f<T>(t: T & { a: i64 }): i64 {
  return t.a
}

function main() {}
// error: intersections with type parameters are not supported yet
// case: intersection_union
function f(p: { a: i64 } & ({ b: i64 } | { c: i64 })): i64 {
  return p.a
}

function main() {}
// error: intersections with unions are not supported yet
