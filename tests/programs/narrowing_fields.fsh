// case: narrowing_fields
class Node {
  value: i64
  next: Node | null
  constructor(value: i64, next: Node | null) {
    this.value = value
    this.next = next
  }
  cut(this: Mut<this>) {
    this.next = null
  }
  bump(this: Mut<this>) {
    this.value = this.value + 10
  }
}
function reset(n: Mut<Node>) {
  n.next = null
}
type Box = { label: string | null; n: i64 }
function show(n: Ref<Node>) {
  print(n.value)
}
function shout(s: Mut<string>) {
  s = s + "!"
}
function clear(o: Mut<string | null>) {
  o = null
}
function main() {
  let n = new Node(1, new Node(2, null))
  // A field checked against null reads as its member, a place inside the union.
  if (n.next !== null) {
    n.next.value = 5
    print(n.next.value)
    // Lent as the member the check left, it keeps that member.
    n.next.bump()
    print(n.next.value)
    show(n.next)
  }
  let b: Box = { label: "hi", n: 1 }
  if (b.label !== null) {
    shout(b.label)
    print(b.label)
    // Lent mutably as declared, it is lent whole, and the check is forgotten.
    clear(b.label)
  }
  print(b.label === null)
  print(n.next === null || n.next.value > 1)
}
// expect: 5
// expect: 15
// expect: 15
// expect: hi!
// expect: true
// expect: true
// case: narrowing_fields_discriminants
type Ref1 = { kind: "ref"; name: string }
type Lit = { kind: "lit"; value: i64 }
type Param = { constraint: Ref1 | Lit | null }
type Outer = { inner: { label: string | null; size: i64 | string } }

// Through '?.' an empty field has no kind, so it isn't "ref".
function first(p: Param): string {
  if (p.constraint?.kind === "ref" && p.constraint.name.length > 0) return p.constraint.name
  return "none"
}
function total(p: Ref<Param>): i64 {
  return p.constraint !== null && p.constraint.kind === "lit" ? p.constraint.value : 0
}
function size(o: Mut<Outer>): usize {
  if (o.inner.label === null) return 0
  return o.inner.label.length
}
function kind(p: Param): string {
  if (p.constraint === null) return "empty"
  switch (p.constraint.kind) {
    case "ref":
      return p.constraint.name
    case "lit":
      return `${p.constraint.value}`
  }
  return "?"
}
function main() {
  print(first({ constraint: { kind: "ref", name: "T" } }), first({ constraint: null }), first({ constraint: { kind: "lit", value: 4 } }))
  // A wider object stores the field as its own type, read as the parameter declares it.
  const w = { constraint: null, extra: 1 }
  const v = { constraint: { kind: "ref" as const, name: "V" }, extra: 2 }
  print(first(w), first(v))
  const lit: Param = { constraint: { kind: "lit", value: 4 } }
  print(total(lit), kind(lit), kind({ constraint: { kind: "ref", name: "R" } }), kind({ constraint: null }))
  let o: Outer = { inner: { label: "four", size: 2 } }
  print(size(o))
  print(typeof o.inner.size === "number" ? o.inner.size + 1 : 0)
  const p: Param = { constraint: { kind: "lit", value: 9 } }
  if (p.constraint === null || p.constraint.kind === "ref") return
  print(p.constraint.value)
}
// expect: T none none
// expect: none V
// expect: 4 4 R empty
// expect: 4
// expect: 3
// expect: 9
// case: narrowing_fields_this
type Leaf = { kind: "leaf"; v: i64 }
type Pair = { kind: "pair"; a: i64; b: i64 }
class Slot {
  item: Leaf | Pair | null
  name: string | i64
  constructor(item: Leaf | Pair | null) {
    this.item = item
    this.name = 0
  }
  sum(): i64 {
    if (this.item === null) return 0
    if (this.item.kind === "leaf") return this.item.v
    return this.item.a + this.item.b
  }
  clear(this: Mut<this>) {
    this.item = null
  }
  take(this: Mut<this>): i64 {
    if (this.item !== null && this.item.kind === "leaf") {
      const v = this.item.v
      this.clear()
      return v
    }
    return 0
  }
  label(): string {
    return typeof this.name === "string" ? this.name : `#${this.name}`
  }
}
function main() {
  print(new Slot({ kind: "leaf", v: 4 }).sum(), new Slot({ kind: "pair", a: 1, b: 2 }).sum(), new Slot(null).sum())
  print(new Slot(null).label())
  let s = new Slot({ kind: "leaf", v: 7 })
  print(s.take(), s.sum())
}
// expect: 4 3 0
// expect: #0
// expect: 7 0
// case: narrowing_fields_checked_in_loop
class Node {
  value: i64
  next: Node | null
  constructor(value: i64, next: Node | null) {
    this.value = value
    this.next = next
  }
  cut(this: Mut<this>) {
    this.next = null
  }
  bump(this: Mut<this>) {
    this.value = this.value + 10
  }
}
function reset(n: Mut<Node>) {
  n.next = null
}
function main() {
  let n = new Node(1, new Node(2, null))
  // A check inside the loop holds until the change after it.
  for (let i = 0; i < 2; i++) {
    if (n.next !== null) {
      print(n.next.value)
      reset(n)
    }
  }
  print(n.next === null)
}
// expect: 2
// expect: true
// case: narrowing_fields_written
class Node {
  value: i64
  next: Node | null
  constructor(value: i64, next: Node | null) {
    this.value = value
    this.next = next
  }
  cut(this: Mut<this>) {
    this.next = null
  }
  bump(this: Mut<this>) {
    this.value = this.value + 10
  }
}
function reset(n: Mut<Node>) {
  n.next = null
}
function main() {
  let n = new Node(1, new Node(2, null))
  if (n.next !== null) {
    n.next = null
    print(n.next.value)
  }
}
// error: 22:11: error[E0502]: property 'value' does not exist on type 'null | Node'
// case: narrowing_fields_root_written
class Node {
  value: i64
  next: Node | null
  constructor(value: i64, next: Node | null) {
    this.value = value
    this.next = next
  }
  cut(this: Mut<this>) {
    this.next = null
  }
  bump(this: Mut<this>) {
    this.value = this.value + 10
  }
}
function reset(n: Mut<Node>) {
  n.next = null
}
function main() {
  let n = new Node(1, new Node(2, null))
  if (n.next !== null) {
    n = new Node(3, null)
    print(n.next.value)
  }
}
// error: 22:11: error[E0502]: property 'value' does not exist on type 'null | Node'
// case: narrowing_fields_root_lent
class Node {
  value: i64
  next: Node | null
  constructor(value: i64, next: Node | null) {
    this.value = value
    this.next = next
  }
  cut(this: Mut<this>) {
    this.next = null
  }
  bump(this: Mut<this>) {
    this.value = this.value + 10
  }
}
function reset(n: Mut<Node>) {
  n.next = null
}
function main() {
  let n = new Node(1, new Node(2, null))
  if (n.next !== null) {
    reset(n)
    print(n.next.value)
  }
}
// error: 22:11: error[E0502]: property 'value' does not exist on type 'null | Node'
// case: narrowing_fields_mutating_method
class Node {
  value: i64
  next: Node | null
  constructor(value: i64, next: Node | null) {
    this.value = value
    this.next = next
  }
  cut(this: Mut<this>) {
    this.next = null
  }
  bump(this: Mut<this>) {
    this.value = this.value + 10
  }
}
function reset(n: Mut<Node>) {
  n.next = null
}
function main() {
  let n = new Node(1, new Node(2, null))
  if (n.next !== null) {
    n.cut()
    print(n.next.value)
  }
}
// error: 22:11: error[E0502]: property 'value' does not exist on type 'null | Node'
// case: narrowing_fields_closure_before
class Node {
  value: i64
  next: Node | null
  constructor(value: i64, next: Node | null) {
    this.value = value
    this.next = next
  }
  cut(this: Mut<this>) {
    this.next = null
  }
  bump(this: Mut<this>) {
    this.value = this.value + 10
  }
}
function reset(n: Mut<Node>) {
  n.next = null
}
function main() {
  let n = new Node(1, new Node(2, null))
  const h = () => {
    n.next = null
  }
  if (n.next !== null) {
    h()
    print(n.next.value)
  }
}
// error: 25:11: error[E0502]: property 'value' does not exist on type 'null | Node'
// case: narrowing_fields_closure_inside
class Node {
  value: i64
  next: Node | null
  constructor(value: i64, next: Node | null) {
    this.value = value
    this.next = next
  }
  cut(this: Mut<this>) {
    this.next = null
  }
  bump(this: Mut<this>) {
    this.value = this.value + 10
  }
}
function reset(n: Mut<Node>) {
  n.next = null
}
function main() {
  let n = new Node(1, new Node(2, null))
  if (n.next !== null) {
    const h = () => {
      n.cut()
    }
    h()
    print(n.next.value)
  }
}
// error: 25:11: error[E0502]: property 'value' does not exist on type 'null | Node'
// case: narrowing_fields_nested_function
class Node {
  value: i64
  next: Node | null
  constructor(value: i64, next: Node | null) {
    this.value = value
    this.next = next
  }
  cut(this: Mut<this>) {
    this.next = null
  }
  bump(this: Mut<this>) {
    this.value = this.value + 10
  }
}
function reset(n: Mut<Node>) {
  n.next = null
}
function main() {
  let n = new Node(1, new Node(2, null))
  function h() {
    n.next = null
  }
  if (n.next !== null) {
    h()
    print(n.next.value)
  }
}
// error: 25:11: error[E0502]: property 'value' does not exist on type 'null | Node'
// case: narrowing_fields_assigned_in_loop
class Node {
  value: i64
  next: Node | null
  constructor(value: i64, next: Node | null) {
    this.value = value
    this.next = next
  }
  cut(this: Mut<this>) {
    this.next = null
  }
  bump(this: Mut<this>) {
    this.value = this.value + 10
  }
}
function reset(n: Mut<Node>) {
  n.next = null
}
function main() {
  let n = new Node(1, new Node(2, null))
  if (n.next !== null) {
    for (let i = 0; i < 2; i++) {
      print(n.next.value)
      n.next = null
    }
  }
}
// error: 22:13: error[E0502]: property 'value' does not exist on type 'null | Node'
// case: narrowing_fields_lent_in_loop
class Node {
  value: i64
  next: Node | null
  constructor(value: i64, next: Node | null) {
    this.value = value
    this.next = next
  }
  cut(this: Mut<this>) {
    this.next = null
  }
  bump(this: Mut<this>) {
    this.value = this.value + 10
  }
}
function reset(n: Mut<Node>) {
  n.next = null
}
function main() {
  let n = new Node(1, new Node(2, null))
  if (n.next !== null) {
    for (let i = 0; i < 2; i++) {
      print(n.next.value)
      reset(n)
    }
  }
}
// error: 23:13: error[E0109]: can't mutably borrow this here: earlier in this loop a field it reaches was read as narrowed by what was known before the loop
// case: narrowing_fields_member_lent_in_loop
class Node {
  value: i64
  next: Node | null
  constructor(value: i64, next: Node | null) {
    this.value = value
    this.next = next
  }
  cut(this: Mut<this>) {
    this.next = null
  }
  bump(this: Mut<this>) {
    this.value = this.value + 10
  }
}
function reset(n: Mut<Node>) {
  n.next = null
}
function main() {
  let n = new Node(1, new Node(2, new Node(3, null)))
  if (n.next !== null && n.next.next !== null) {
    for (let i = 0; i < 2; i++) {
      print(n.next.next.value)
      n.next.cut()
    }
  }
}
// error: 23:7: error[E0109]: can't call 'cut' on this here
// case: narrowing_fields_written_in_branch
class Node {
  value: i64
  next: Node | null
  constructor(value: i64, next: Node | null) {
    this.value = value
    this.next = next
  }
  cut(this: Mut<this>) {
    this.next = null
  }
  bump(this: Mut<this>) {
    this.value = this.value + 10
  }
}
function reset(n: Mut<Node>) {
  n.next = null
}
function main() {
  let n = new Node(1, new Node(2, null))
  if (n.next === null) return
  if (n.value > 0) {
    n.next = null
  }
  print(n.next.value)
}
// error: 24:9: error[E0502]: property 'value' does not exist on type 'null | Node'
// case: narrowing_fields_mutating_this
type Leaf = { kind: "leaf"; v: i64 }
class Slot {
  item: Leaf | null
  constructor(item: Leaf | null) {
    this.item = item
  }
  clear(this: Mut<this>) {
    this.item = null
  }
  take(this: Mut<this>): i64 {
    if (this.item !== null) {
      this.clear()
      return this.item.v
    }
    return 0
  }
}
function main() {}
// error: 13:14: error[E0502]: property 'v' does not exist on type 'null | { kind: "leaf"; v: i64 }'
// case: narrowing_fields_predicates
class A { a: i64; constructor() { this.a = 1 } }
class B { b: i64; constructor() { this.b = 2 } }
type H = { x: A | B; y: i64 | string; z: { kind: "p"; p: i64 } | { kind: "q"; q: i64 } | null }
function isA(v: Ref<A | B>): v is A {
  return v instanceof A
}
function f(h: H): i64 {
  let s = 0
  if (h.x instanceof A) s = s + h.x.a
  if (isA(h.x)) s = s + h.x.a * 10
  if (!(typeof h.y === "string")) s = s + h.y
  if (h.z?.kind !== "q") return s
  return s + h.z.q
}
function main() {
  print(f({ x: new A(), y: 5, z: { kind: "q", q: 100 } }), f({ x: new B(), y: "s", z: null }))
}
// expect: 116 0
// case: narrowing_fields_wrong_predicate
class A { a: i64; constructor() { this.a = 1 } }
class B { b: i64; constructor() { this.b = 2 } }
type H = { x: A | B; y: i64 | string; z: { kind: "p"; p: i64 } | { kind: "q"; q: i64 } | null }
function isA(v: Ref<A | B>): v is A {
  return true
}
function f(h: H): i64 {
  let s = 0
  if (h.x instanceof A) s = s + h.x.a
  if (isA(h.x)) s = s + h.x.a * 10
  if (!(typeof h.y === "string")) s = s + h.y
  if (h.z?.kind !== "q") return s
  return s + h.z.q
}
function main() {
  print(f({ x: new B(), y: "s", z: null }))
}
// panic: the type predicate 'isA' said 'h.x' is 'A', but it holds a 'B'
// case: narrowing_fields_destructured
type P = { a: string | null; b: i64 }
function main() {
  let p: P = { a: "x", b: 1 }
  if (p.a !== null) {
    [p.a, p.b] = [null, 2]
    print(p.a.length)
  }
}
// error: 6:11: error[E0502]: property 'length' does not exist on type 'null | string'
// case: narrowing_fields_updated
// '+=' and '++' read a narrowed field and write it back as the same member.
type P = { a: string | null; b: i64 | null }
function main() {
  let p: P = { a: "x", b: 1 }
  if (p.a !== null && p.b !== null) {
    p.b++
    p.a += "y"
    print(p.a, p.b)
  }
}
// expect: xy 2
