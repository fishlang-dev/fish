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
// `A & (B | C)` distributes, as in TypeScript: a tagged union whose every member has the shared
// fields, narrowed by its tag.
type Span = { start: i64; end: i64 }
type Id = { id: i64 }
type Shape = Span & Id & (| { kind: "circle"; r: i64 } | { kind: "rect"; w: i64; h: i64 })

function area(s: Ref<Shape>): i64 {
  if (s.kind === "circle") return s.r * s.r * 3
  return s.w * s.h
}

function width(s: Ref<Shape>): i64 {
  switch (s.kind) {
    case "circle":
      return s.r * 2
    case "rect":
      return s.w
  }
  return 0
}

function grow(s: Shape): Shape {
  if (s.kind === "rect") return { kind: "rect", w: s.w + 1, h: s.h, start: s.start, end: s.end, id: s.id }
  return s
}

function main() {
  const c: Shape = { kind: "circle", r: 2, start: 0, end: 4, id: 1 }
  const r: Shape = { kind: "rect", w: 3, h: 5, start: 5, end: 9, id: 2 }
  console.log(area(c), area(r), width(c), width(r), c.start + r.end, c.id + r.id, area(grow(r.clone())))
  console.log(r)
}
// expect: 12 15 4 3 9 3 20
// expect: { end: 9, h: 5, id: 2, kind: 'rect', start: 5, w: 3 }
// case: intersection_union_recursive
type Span = { start: i64; end: i64 }
type E = Span & ({ kind: "num"; value: i64 } | { kind: "add"; left: E; right: E })

function evaluate(e: Ref<E>): i64 {
  if (e.kind === "num") return e.value
  return evaluate(e.left) + evaluate(e.right)
}

function show(e: Ref<E>): string {
  if (e.kind === "num") return `${e.value}`
  return `(${show(e.left)} + ${show(e.right)})`
}

function lhs(e: Ref<Extract<E, { kind: "add" }>>): i64 {
  return evaluate(e.left) * 10 + e.start
}

function num(value: i64, at: i64): E {
  return { kind: "num", value, start: at, end: at + 1 }
}

function main() {
  const e: E = { kind: "add", left: num(1, 0), right: { kind: "add", left: num(2, 4), right: num(3, 8), start: 4, end: 9 }, start: 0, end: 9 }
  console.log(evaluate(e), show(e))
  if (e.kind === "add") console.log(lhs(e))
  console.log(num(7, 2))
  console.log(e)
}
// expect: 6 (1 + (2 + 3))
// expect: 10
// expect: { end: 3, kind: 'num', start: 2, value: 7 }
// expect: {
// expect:   end: 9,
// expect:   kind: 'add',
// expect:   left: { end: 1, kind: 'num', start: 0, value: 1 },
// expect:   right: {
// expect:     end: 9,
// expect:     kind: 'add',
// expect:     left: { end: 5, kind: 'num', start: 4, value: 2 },
// expect:     right: { end: 9, kind: 'num', start: 8, value: 3 },
// expect:     start: 4
// expect:   },
// expect:   start: 0
// expect: }
// case: intersection_union_generic
type Span = { start: i64 }
type Tree<T> = Span & ({ kind: "leaf"; v: T } | { kind: "pair"; a: Tree<T>; b: Tree<T> })

function count<T>(t: Ref<Tree<T>>): i64 {
  if (t.kind === "leaf") return 1
  return count<T>(t.a) + count<T>(t.b)
}

function main() {
  const t: Tree<string> = { kind: "pair", start: 0, a: { kind: "leaf", v: "x", start: 1 }, b: { kind: "leaf", v: "y", start: 2 } }
  console.log(count<string>(t), t)
}
// expect: 2 {
// expect:   a: { kind: 'leaf', start: 1, v: 'x' },
// expect:   b: { kind: 'leaf', start: 2, v: 'y' },
// expect:   kind: 'pair',
// expect:   start: 0
// expect: }
// case: intersection_union_sides
// Two union sides give every combination.
type T = ({ a: i64 } | { b: i64 }) & ({ kind: "x" } | { kind: "y"; y: i64 })

function f(t: T): i64 {
  if (t.kind === "y") return t.y
  return 0
}

function main() {
  const t: T = { a: 1, kind: "y", y: 2 }
  const u: T = { b: 3, kind: "x" }
  console.log(t, u)
  console.log(f(t), f(u))
}
// expect: { a: 1, kind: 'y', y: 2 } { b: 3, kind: 'x' }
// expect: 2 0
// case: intersection_union_equal
type Shape = { id: i64 } & ({ kind: "c"; r: i64 } | { kind: "s"; w: i64 })
function main() {
  const a: Shape = { kind: "c", r: 1, id: 1 }
  const b: Shape = { kind: "c", r: 1, id: 1 }
  console.log(a === b)
}
// expect: true
// case: intersection_union_conflict
type K = { kind: "a"; n: i64 } & ({ n: boolean } | { m: i64 })
function main() {}
// error: property 'n' has type 'i64' on one side of '&' and 'boolean' on the other
// case: intersection_union_interface
interface I { n: i64 }
function f(x: I & ({ a: i64 } | { b: i64 })): i64 { return 1 }
function main() {}
// error: intersections of interfaces with unions are not supported yet
