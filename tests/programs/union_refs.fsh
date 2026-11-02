// case: union_refs_option_fields
// An Option of a reference is a field of an object or a class, empty as 'null' or 'undefined',
// and a check on the field narrows it to the reference.
class Item {
  n: i64 = 1
}
type View = { item: Ref<Item> | undefined; label: string }
class Holder {
  item: Ref<Item> | null = null
  constructor(item: Ref<Item> | null) {
    this.item = item
  }
  get(): i64 {
    return this.item !== null ? this.item.n : 0
  }
}
function find(items: Ref<Item[]>, i: usize): Ref<Item> | undefined {
  if (i < items.length) return items[i]
  return undefined
}
function wrap(x: Ref<Item>): View {
  return { item: x, label: "wrapped" }
}
function main() {
  const it = new Item()
  const v: View = { item: it, label: "v" }
  if (v.item !== undefined) console.log(v.label, v.item.n)
  const e: View = { item: undefined, label: "e" }
  console.log(e.label, e.item === undefined)
  console.log(new Holder(it).get(), new Holder(null).get())
  const items = [new Item(), new Item()]
  const found = { at: find(items, 1), missing: find(items, 5) }
  console.log(found.at !== undefined, found.missing !== undefined)
  const w = wrap(it)
  if (w.item !== undefined) console.log(w.label, w.item.n)
}
// expect: v 1
// expect: e true
// expect: 1 0
// expect: true false
// expect: wrapped 1
// case: union_refs_option_field_change
class Item {
  n: i64 = 1
}
type View = { item: Ref<Item> | undefined }
function main() {
  let it = new Item()
  const v: View = { item: it }
  it.n = 5
  if (v.item !== undefined) console.log(v.item.n)
}
// error: cannot change 'it.n' while 'v' borrows 'it' and is used later
// case: union_refs_option_field_class_change
class Item {
  n: i64 = 1
}
class Holder {
  item: Ref<Item> | null
  constructor(item: Ref<Item> | null) {
    this.item = item
  }
}
function main() {
  let it = new Item()
  const h = new Holder(it)
  it = new Item()
  console.log(h.item !== null)
}
// error: cannot change 'it' while 'h' borrows 'it' and is used later
// case: union_refs_option_field_mut
// A 'Mut' in an Option field writes through, and its source waits until the holder's last use.
class Item {
  n: i64 = 1
}
type View = { item: Mut<Item> | null }
function main() {
  let it = new Item()
  const v: View = { item: it }
  if (v.item !== null) v.item.n = 4
  console.log(it.n)
}
// expect: 4
// case: union_refs_option_field_mut_used
class Item {
  n: i64 = 1
}
type View = { item: Mut<Item> | null }
function main() {
  let it = new Item()
  const v: View = { item: it }
  console.log(it.n)
  if (v.item !== null) v.item.n = 4
}
// error: cannot use 'it.n' while 'v' borrows 'it' mutably and is used later
// case: union_refs_option_field_mut_copied
class Item {
  n: i64 = 1
}
type View = { item: Mut<Item> | null }
function main() {
  let it = new Item()
  const v: View = { item: it }
  const w = v
  if (v.item !== null) v.item.n = 2
  if (w.item !== null) w.item.n = 3
}
// error: 'v.item' can't be used here because 'v' was moved
// case: union_refs_option_field_outlived
class Item {
  n: i64 = 1
}
type View = { item: Ref<Item> | null }
function main() {
  let v: View = { item: null }
  {
    const it = new Item()
    v = { item: it }
  }
  if (v.item !== null) console.log(v.item.n)
}
// error: 'it' doesn't live long enough: 'v' still borrows it after its block ends
// case: union_refs_option_field_assigned
class Item {
  n: i64 = 1
}
type View = { item: Ref<Item> | null }
function main() {
  let v: View = { item: null }
  let it = new Item()
  v.item = it
  it = new Item()
  if (v.item !== null) console.log(v.item.n)
}
// error: cannot change 'it' while 'v' borrows 'it' and is used later
// case: union_refs_option_field_returned_local
class Item {
  n: i64 = 1
}
type View = { item: Ref<Item> | null }
function make(): View {
  const it = new Item()
  return { item: it }
}
function main() {
  console.log(make().item !== null)
}
// error: can't return a reference to 'it', which belongs to this function
// case: union_refs_option_field_returned_borrow
class Item {
  n: i64 = 1
}
type View = { item: Ref<Item> | null }
function wrap(x: Ref<Item>): View {
  return { item: x }
}
function main() {
  let it = new Item()
  const v = wrap(it)
  it = new Item()
  if (v.item !== null) console.log(v.item.n)
}
// error: cannot change 'it' while 'v' borrows 'it' and is used later
// case: union_refs_option_field_store_local
class Item {
  n: i64 = 1
}
class Holder {
  item: Ref<Item> | null = null
  set(this: Mut<this>) {
    const local = new Item()
    this.item = local
  }
}
function main() {}
// error: can't store in 'this' a reference to 'local', which belongs to this function
// case: union_refs_option_literal_property
class Item {
  n: i64 = 1
}
function find(items: Ref<Item[]>, i: usize): Ref<Item> | undefined {
  if (i < items.length) return items[i]
  return undefined
}
function main() {
  let items = [new Item()]
  const v = { item: find(items, 0) }
  items = []
  if (v.item !== undefined) console.log(v.item.n)
}
// error: cannot change 'items' while 'v' borrows 'items' and is used later
// case: union_refs_tagged
// A tagged union's members hold references; the tag picks the member a literal goes into, and
// a check on it, a switch or a match gives the member's reference.
class Expr {
  text = "e"
}
class Stmt {
  line: i64 = 3
}
type AnyNode = { of: "expr"; node: Ref<Expr> } | { of: "stmt"; node: Ref<Stmt> }
function show(n: AnyNode): string {
  if (n.of === "expr") return n.node.text
  return `line ${n.node.line}`
}
function shown(n: Ref<AnyNode>): string {
  switch (n.of) {
    case "expr":
      return n.node.text
    case "stmt":
      return `line ${n.node.line}`
  }
  return ""
}
function pick(e: Ref<Expr>, s: Ref<Stmt>, expr: boolean): AnyNode {
  if (expr) return { of: "expr", node: e }
  return { of: "stmt", node: s }
}
function main() {
  const e = new Expr()
  const s = new Stmt()
  const a: AnyNode = { of: "expr", node: e }
  const b: AnyNode = { of: "stmt", node: s }
  console.log(shown(a), shown(b))
  console.log(show(pick(e, s, true)), show(pick(e, s, false)))
  const m = match (a) {
    case { of: "expr", node } => node.text,
    case { of: "stmt", node } => `line ${node.line}`,
  }
  console.log(m)
}
// expect: e line 3
// expect: e line 3
// expect: e
// case: union_refs_tagged_mut
// A 'Mut' member writes through once narrowed, and its source waits for the union's last use.
class A {
  n: i64 = 1
}
class B {
  s = "b"
}
type Node = { of: "a"; node: Mut<A> } | { of: "b"; node: Mut<B> }
function main() {
  let a = new A()
  const n: Node = { of: "a", node: a }
  if (n.of === "a") n.node.n = 7
  console.log(a.n)
}
// expect: 7
// case: union_refs_tagged_mut_used
class A {
  n: i64 = 1
}
class B {
  s = "b"
}
type Node = { of: "a"; node: Mut<A> } | { of: "b"; node: Mut<B> }
function main() {
  let a = new A()
  const n: Node = { of: "a", node: a }
  console.log(a.n)
  if (n.of === "a") n.node.n = 7
}
// error: cannot use 'a.n' while 'n' borrows 'a' mutably and is used later
// case: union_refs_tagged_mut_twice
class A {
  n: i64 = 1
}
class B {
  s = "b"
}
type Node = { of: "a"; node: Mut<A> } | { of: "b"; node: Mut<B> }
function main() {
  let a = new A()
  const n: Node = { of: "a", node: a }
  const m: Node = { of: "a", node: a }
  if (n.of === "a") n.node.n = 7
  if (m.of === "a") m.node.n = 8
}
// error: cannot use 'a' while 'n' borrows 'a' mutably and is used later
// case: union_refs_tagged_change
class A {
  n: i64 = 1
}
class B {
  s = "b"
}
type Node = { of: "a"; node: Ref<A> } | { of: "b"; node: Ref<B> }
function main() {
  let a = new A()
  const n: Node = { of: "a", node: a }
  a.n = 3
  if (n.of === "a") console.log(n.node.n)
}
// error: cannot change 'a.n' while 'n' borrows 'a' and is used later
// case: union_refs_tagged_returned_local
class A {
  n: i64 = 1
}
class B {
  s = "b"
}
type Node = { of: "a"; node: Ref<A> } | { of: "b"; node: Ref<B> }
function make(): Node {
  const a = new A()
  return { of: "a", node: a }
}
function main() {}
// error: can't return a reference to 'a', which belongs to this function
// case: union_refs_tagged_outlived
class A {
  n: i64 = 1
}
class B {
  s = "b"
}
type Node = { of: "a"; node: Ref<A> } | { of: "b"; node: Ref<B> }
function show(n: Ref<Node>) {
  if (n.of === "a") console.log(n.node.n)
}
function main() {
  const b = new B()
  let n: Node = { of: "b", node: b }
  {
    const a = new A()
    n = { of: "a", node: a }
  }
  show(n)
}
// error: 'a' doesn't live long enough: 'n' still borrows it after its block ends
// case: union_refs_tagged_temporary
class A {
  n: i64 = 1
}
class B {
  s = "b"
}
type Node = { of: "a"; node: Ref<A> } | { of: "b"; node: Ref<B> }
function main() {
  const n: Node = { of: "b", node: new B() }
  console.log(n.of)
}
// error: 'n' would keep borrowing this temporary, which is gone once its statement ends
// case: union_refs_tagged_returned_borrow
// A union a function builds from its parameters borrows what was lent to the call.
class A {
  n: i64 = 1
}
class B {
  s = "b"
}
type Node = { of: "a"; node: Ref<A> } | { of: "b"; node: Ref<B> }
function first(a: Ref<A>, b: Ref<B>): Node {
  return { of: "a", node: a }
}
function main() {
  let a = new A()
  let b = new B()
  const n = first(a, b)
  b = new B()
  console.log(n.of)
}
// error: cannot change 'b' while 'n' borrows 'b' and is used later
// case: union_refs_tagged_narrowed_kept
class A {
  n: i64 = 1
}
class B {
  s = "b"
}
type Node = { of: "a"; node: Ref<A> } | { of: "b"; node: Ref<B> }
function get(n: Ref<Node>): Ref<A> | null {
  if (n.of === "a") return n.node
  return null
}
function main() {
  let a = new A()
  const n: Node = { of: "a", node: a }
  const r = get(n)
  a.n = 4
  if (r !== null) console.log(r.n)
}
// error: cannot change 'a.n' while 'r' borrows 'a' and is used later
// case: union_refs_tagged_field
// A class field holds a tagged union of references, changed member by member.
class A {
  n: i64 = 1
}
class B {
  s = "b"
}
type Node = { of: "a"; node: Ref<A> } | { of: "b"; node: Ref<B> }
class Walker {
  at: Node
  count = 0
  constructor(at: Node) {
    this.at = at
  }
  step(this: Mut<this>) {
    this.count++
    if (this.at.of === "a") console.log(this.at.node.n)
    else console.log(this.at.node.s)
  }
}
function main() {
  const a = new A()
  const b = new B()
  let w = new Walker({ of: "a", node: a })
  w.step()
  w.at = { of: "b", node: b }
  w.step()
  console.log(w.count)
}
// expect: 1
// expect: b
// expect: 2
// case: union_refs_tagged_nested
class A {
  n: i64 = 1
}
class B {
  s = "b"
}
type Node = { of: "a"; node: Ref<A> } | { of: "b"; node: Ref<B> }
type Wrap = { inner: Node; k: i64 }
function main() {
  let a = new A()
  const w: Wrap = { inner: { of: "a", node: a }, k: 1 }
  a.n = 2
  console.log(w.inner.of)
}
// error: cannot change 'a.n' while 'w' borrows 'a' and is used later
// case: union_refs_tagged_conditional
class A {
  n: i64 = 1
}
class B {
  s = "b"
}
type Node = { of: "a"; node: Ref<A> } | { of: "b"; node: Ref<B> }
function main() {
  let a = new A()
  const b = new B()
  const n: Node | null = a.n > 0 ? { of: "a", node: a } : { of: "b", node: b }
  a.n = 2
  if (n !== null) console.log(n.of)
}
// error: cannot change 'a.n' while 'n' borrows 'a' and is used later
// case: union_refs_alias_lifetime
// An alias names the lifetime of the references it holds, so a function's result borrows only
// the arguments with that lifetime; written without it, the lifetime is elided.
class Item {
  n: i64 = 1
}
type View<L extends Lifetime> = { item: Ref<Item, L> | null }
type Pair<L extends Lifetime> = { of: "one"; x: Ref<Item, L> } | { of: "none" }
function pick<L extends Lifetime>(a: Ref<Item, L>, _b: Ref<Item>): View<L> {
  return { item: a }
}
function main() {
  let a = new Item()
  let b = new Item()
  const v = pick(a, b)
  b = new Item()
  if (v.item !== null) console.log(v.item.n, b.n)
  const p: Pair = { of: "one", x: a }
  if (p.of === "one") console.log(p.x.n)
}
// expect: 1 1
// expect: 1
// case: union_refs_alias_lifetime_wrong
class Item {
  n: i64 = 1
}
type View<L extends Lifetime> = { item: Ref<Item, L> | null }
function pick<L extends Lifetime>(_a: Ref<Item, L>, b: Ref<Item>): View<L> {
  return { item: b }
}
function main() {}
// error: the returned reference points into 'b', but its lifetime ties it to '_a'
// case: union_refs_alias_lifetime_undeclared
class Item {
  n: i64 = 1
}
type View<L extends Lifetime> = { item: Ref<Item, L> | null }
function pick(a: Ref<Item>): View<Q> {
  return { item: a }
}
function main() {}
// error: cannot find lifetime 'Q'; declare it as '<Q extends Lifetime>'
// case: union_refs_alias_lifetime_kept
class Item {
  n: i64 = 1
}
type View<L extends Lifetime> = { item: Ref<Item, L> | null }
function pick<L extends Lifetime>(a: Ref<Item, L>, _b: Ref<Item>): View<L> {
  return { item: a }
}
function main() {
  let a = new Item()
  let b = new Item()
  const v = pick(a, b)
  a = new Item()
  if (v.item !== null) console.log(v.item.n)
}
// error: cannot change 'a' while 'v' borrows 'a' and is used later
// case: union_refs_alias_lifetime_generic
class Item {
  n: i64 = 1
}
type View<T, L extends Lifetime> = { item: Ref<T, L> | null }
function pick<L extends Lifetime>(a: Ref<Item, L>, _b: Ref<Item>): View<Item, L> {
  return { item: a }
}
function main() {
  let a = new Item()
  let b = new Item()
  const v = pick(a, b)
  b = new Item()
  const w: View<Item> = { item: b }
  if (v.item !== null) console.log(v.item.n)
  if (w.item !== null) console.log(w.item.n)
}
// expect: 1
// expect: 1
// case: union_refs_tagged_shorthand
// A shorthand property lends its variable to the member the tag picks.
class Expr {
  text: string
  constructor(text: string) {
    this.text = text
  }
}
type N = { of: "e"; node: Ref<Expr> } | { of: "n"; n: i64 }
function main() {
  const node = new Expr("x")
  const a: N = { of: "e", node }
  if (a.of === "e") console.log(a.node.text)
}
// expect: x
// case: union_refs_tagged_shorthand_change
class Expr {
  text: string
  constructor(text: string) {
    this.text = text
  }
}
type N = { of: "e"; node: Ref<Expr> } | { of: "n"; n: i64 }
function main() {
  let node = new Expr("x")
  const a: N = { of: "e", node }
  node = new Expr("y")
  if (a.of === "e") console.log(a.node.text)
}
// error: cannot change 'node' while 'a' borrows 'node' and is used later
// case: union_refs_equality
// Values holding references compare what the references point to, as a reference on its own does.
@derive(Eq)
class Expr {
  text: string
  constructor(text: string) {
    this.text = text
  }
}
type N = { of: "e"; node: Ref<Expr> } | { of: "n"; n: i64 }
type R = { r: Ref<Expr> }
function main() {
  const e = new Expr("x")
  const same = new Expr("x")
  const other = new Expr("y")
  const a: N = { of: "e", node: e }
  const b: N = { of: "e", node: e }
  const c: N = { of: "e", node: same }
  const d: N = { of: "e", node: other }
  console.log(a === b, a === c, a === d, a !== d)
  const k = 5
  const k2 = 5
  const o1: R = { r: e }
  const o2: R = { r: same }
  const i1: { n: Ref<i64> } = { n: k }
  const i2: { n: Ref<i64> } = { n: k2 }
  console.log(o1 === o2, i1 === i2)
}
// expect: true true false true
// expect: true true
// case: union_refs_tagged_no_tag
class Expr {
  text: string
  constructor(text: string) {
    this.text = text
  }
}
type N = { node: Ref<Expr>; k: i64 } | { node: Ref<Expr>; j: string }
function main() {
  const e = new Expr("o")
  const a: N = { node: e, k: 1 }
}
// error: can't choose which member of '{ j: string; node: Ref<Expr> } | { k: i64; node: Ref<Expr> }' this object goes into: a member holding references is chosen by its literal fields
// case: union_refs_tagged_tag_not_literal
class Expr {
  text: string
  constructor(text: string) {
    this.text = text
  }
}
type N = { of: "e"; node: Ref<Expr> } | { of: "n"; n: i64 }
function main() {
  const e = new Expr("x")
  const t: "e" = "e"
  const a: N = { of: t, node: e }
}
// error: can't choose which member of
