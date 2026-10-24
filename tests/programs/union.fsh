// case: union_ambiguous
function main() {
  const p = { x: 1, y: 2 }
  const u: { x: i64 } | { y: i64 } = p
}
// error: fits more than one member
// case: union_compare
type Mixed = i64 | boolean | "up"

function check(x: Mixed) {
  print(x === 3, x !== true, x === "up", 3 === x, x === false)
}

function main() {
  check(3)
  check(4)
  check(true)
  check(false)
  check("up")
  const n = 3
  const m: Mixed = n
  print(m === n, m !== n)
}
// expect: true true false true false
// expect: false true false false false
// expect: false false false false false
// expect: false true false false true
// expect: false true true false false
// expect: true false
// case: union_compare_no_overlap
function main() {
  const x: i64 | boolean = 1
  print(x === "up")
}
// error: this comparison appears to be unintentional because the types 'boolean | i64' and '"up"' have no overlap
// case: union_compare_object
function main() {
  const p = { a: 1 }
  const x: { a: i64 } | i64 = 1
  print(x === p)
}
// expect: false
// case: union_compare_objects
class C {}

function main() {
  const c = new C()
  const a: C | i64 = c
  const b: C | i64 = c
  print(a === b)
}
// error: a class compares through 'equals(other: Ref<this>): boolean', which 'C' doesn't have
// case: union_compare_objects_width
type X = { a: i64 } | i64
type Y = { b: i64 } | i64

function main() {
  const o = { a: 1, b: 2 }
  const x: X = o.clone()
  const y: Y = o
  print(x === y)
}
// expect: false
// case: union_compare_unions_no_overlap
function main() {
  const a: i64 | boolean = 1
  const b: "x" | "y" = "x"
  print(a === b)
}
// error: no overlap
// case: union_compare_values
enum E {
  A = 1,
  B = 1,
  C = 2,
}

function main() {
  const u: i64 | boolean = 1
  const one: 1 = 1
  print(u === E.B, u === one, u !== one)
  switch (u) {
    case E.B:
      print("matched E.B")
  }
  // Two unions compare by the members they hold.
  const a: i64 | boolean = 2
  const b: 1 | 2 = 2
  const c: E = E.B
  const d: E = E.A
  print(a === b, c === d, c === E.A, c === 1, c !== E.C)
  switch (c) {
    case 1:
      print("one")
      break
    default:
      print("not one")
  }
  const n: i64 = 2
  switch (n) {
    case E.C:
      print("two")
  }
  const word = "a"
  switch (word) {
    case "a":
      print("a")
  }
}
// expect: true true false
// expect: matched E.B
// expect: true true true true true
// expect: one
// expect: two
// expect: a
// case: union_field_write
function main() {
  let x: { n: i64; a: boolean } | { n: i64 } = { n: 1 }
  x.n = 5
}
// error: can't assign to 'n' through '{ a: boolean; n: i64 } | { n: i64 }'; narrow it to one member first
// case: union_field_write_narrowed
type A = { kind: "a"; n: i64 }
type B = { kind: "b"; n: i64 }
type C = { kind: "c" }

function main() {
  let x: A | B | C = { kind: "a", n: 1 }
  if (x.kind !== "c") {
    x.n = 5
  }
}
// error: narrow it to one member first
// case: union_interface
interface Shape {
  area(): i64
}

function main() {
  const x: Shape | i64 = 1
}
// error: an interface can't be a union member
// case: union_literal_discriminant_wrong
type Flag = { on: true }

function main() {
  const f: Flag = { on: false }
}
// error: type '{ on: boolean }' is not assignable to type '{ on: true }'
// case: union_literal_discriminants
type Result = { ok: true; value: i64 } | { ok: false; code: i64 }
type Shape = { kind: 1; r: i64 } | { kind: 2; s: i64 }
type Flag = { on: true }
type Nested = { inner: { tag: "x"; n: i64 } } | { inner: { tag: "y" } }

function describe(r: Result): i64 {
  if (r.ok === true) return r.value
  return -r.code
}

function main() {
  const good: Result = { ok: true, value: 3 }
  const bad: Result = { ok: false, code: 7 }
  print(describe(good), describe(bad), describe({ ok: true, value: 9 }))
  const s: Shape = { kind: 2, s: 5 }
  print(s.kind)
  const f: Flag = { on: true }
  print(f.on)
  const n: Nested = { inner: { tag: "x", n: 4 } }
  print(n.inner.tag)
}
// expect: 3 -7 9
// expect: 2
// expect: true
// expect: x
// case: union_literal_missing_field
type R = { ok: true; v: i64 } | { ok: false; e: i64 }

function main() {
  const r: R = { ok: true }
}
// error: type '{ ok: boolean }' is not assignable to type '{ e: i64; ok: false } | { ok: true; v: i64 }'
// case: union_member_access
function main() {
  const x: { a: i64 } | { b: i64 } = { a: 1 }
  print(x.a)
}
// error: property 'a' does not exist on type '{ a: i64 } | { b: i64 }'
// case: union_nested_size
type K = "a" | "b"
type O = { k1: K; k2: K; k3: K; f: boolean }

function show(u: O | i64) {
  if (typeof u === "object") print(u.k1, u.k2, u.k3, u.f)
}

function main() {
  const o: O = { k1: "b", k2: "a", k3: "b", f: true }
  show(o)
}
// expect: b a b true
// case: union_nested_size_release
// mode: release
type K = "a" | "b"
type O = { k1: K; k2: K; k3: K; f: boolean }

function show(u: O | i64) {
  if (typeof u === "object") print(u.k1, u.k2, u.k3, u.f)
}

function main() {
  const o: O = { k1: "b", k2: "a", k3: "b", f: true }
  show(o)
}
// expect: b a b true
// case: union_no_member
function main() {
  const x: i64 | boolean = { a: 1 }
}
// error: type '{ a: i64 }' is not assignable to type 'boolean | i64'
// case: union_null
// 'null' is the empty Option.
function main() {
  const x: i64 | null = 1
  print(x)
}
// expect: 1
// case: union_recursive_class
class Node {
  constructor(public value: i64, public next: Node | "none") {}
}

function main() {
  const n = new Node(1, new Node(2, "none"))
  const next = n.next
  if (next !== "none") console.log(n.value, next.value, next.next === "none")
}
// expect: 1 2 true
// case: union_type
type Dir = "up" | "down"
type Point = { x: i64; y: i64 }

class Tag {
  constructor(public id: i64) {}
}

function flip(d: Dir): Dir {
  return d
}

function either(big: boolean): i64 | boolean {
  if (big) return 100
  return false
}

function main() {
  let x: i64 | boolean = 1
  print(x)
  x = true
  print(x)
  const d: Dir = "down"
  print(d, flip("up"))
  const bit: 0 | 1 = 1
  print(bit)
  print(either(true), either(false))
  // A union holds objects and instances as payloads.
  let shape: Point | Tag | "none" = { x: 1, y: 2 }
  shape = new Tag(7)
  shape = "none"
  // A narrower union widens into a wider one.
  const narrow: "up" | i64 = 5
  const wide: "up" | "down" | i64 | boolean = narrow
  print(wide)
  const words: "up" | "down" | i64 | boolean = d
  print(words, "and", x, "done")
}
// expect: 1
// expect: true
// expect: down up
// expect: 1
// expect: 100 false
// expect: 5
// expect: down and true done
