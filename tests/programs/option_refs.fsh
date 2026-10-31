// case: option_refs
// A lookup gives a borrow or nothing, checked with '!== null' before use; '?.', '??' with a
// place to lend, '!' and '?:' against null work on it, and the narrowed reference passes on.
class Item {
  id: i64
  count: i64 = 0
  constructor(id: i64) {
    this.id = id
  }
}
function find(items: Ref<Item[]>, id: i64): Ref<Item> | null {
  for (let i = 0; i < items.length; i++) {
    if (items[i].id === id) return items[i]
  }
  return null
}
function show(it: Ref<Item>) {
  console.log(`item ${it.id} count ${it.count}`)
}
function describe(it: Ref<Item> | null): string {
  if (it === null) return "nothing"
  return `item ${it.id}`
}
function largest(items: Ref<Item[]>): Ref<Item> | null {
  let best: Ref<Item> | null = null
  for (const it of items) {
    if (best === null || it.id > best!.id) best = it
  }
  return best
}
function either(it: Ref<Item>, keep: boolean): Ref<Item> | null {
  return keep ? it : null
}
function main() {
  const items = [new Item(1), new Item(2)]
  const fallback = new Item(0)
  const a = find(items, 1)
  if (a !== null) show(a)
  if (find(items, 7) === null) console.log("none")
  show(find(items, 7) ?? fallback)
  show(find(items, 2)!)
  console.log(find(items, 2)?.id ?? -1)
  console.log(find(items, 3)?.id ?? -1)
  let c: Ref<Item> | null = null
  console.log(c === null)
  c = find(items, 2)
  console.log(describe(c), describe(null), describe(items[0]))
  console.log(describe(largest(items)))
  const none: Item[] = []
  console.log(describe(largest(none)))
  console.log(describe(either(fallback, true)), describe(either(fallback, false)))
  const o: Option<Ref<Item>> = find(items, 1)
  console.log(o)
}
// expect: item 1 count 0
// expect: none
// expect: item 0 count 0
// expect: item 2 count 0
// expect: 2
// expect: -1
// expect: true
// expect: item 2 nothing item 1
// expect: item 2
// expect: nothing
// expect: item 0 nothing
// expect: Item { id: 1, count: 0 }
// case: option_refs_mut
// A 'Mut<T> | null' writes through once narrowed, and its borrow ends at its last use.
class Item {
  id: i64
  count: i64 = 0
  constructor(id: i64) {
    this.id = id
  }
}
function find(items: Ref<Item[]>, id: i64): Ref<Item> | null {
  for (let i = 0; i < items.length; i++) {
    if (items[i].id === id) return items[i]
  }
  return null
}
function findMut(items: Mut<Item[]>, id: i64): Mut<Item> | null {
  for (let i = 0; i < items.length; i++) {
    if (items[i].id === id) return items[i]
  }
  return null
}
function bump(it: Mut<Item> | null) {
  if (it !== null) it.count++
}
function main() {
  let items = [new Item(1)]
  const a = find(items, 1)
  if (a !== null) console.log(a.id)
  items.push(new Item(2))
  const m = findMut(items, 2)
  if (m !== null) m.count = 3
  const n = findMut(items, 2)
  bump(n)
  bump(n)
  bump(items[0])
  bump(null)
  console.log(items[0].count, items[1].count)
  const moved = items
  console.log(moved.length)
}
// expect: 1
// expect: 1 5
// expect: 2
// case: option_refs_change_source
class Item {
  id: i64 = 1
}
function find(items: Ref<Item[]>, id: i64): Ref<Item> | null {
  for (let i = 0; i < items.length; i++) {
    if (items[i].id === id) return items[i]
  }
  return null
}
function main() {
  let items = [new Item()]
  const a = find(items, 1)
  items.push(new Item())
  if (a !== null) console.log(a.id)
}
// error: cannot change 'items' while 'a' borrows 'items' and is used later
// case: option_refs_change_narrowed
class Item {
  id: i64 = 1
}
function find(items: Ref<Item[]>, id: i64): Ref<Item> | null {
  for (let i = 0; i < items.length; i++) {
    if (items[i].id === id) return items[i]
  }
  return null
}
function main() {
  let items = [new Item()]
  const a = find(items, 1)
  if (a !== null) {
    items.push(new Item())
    console.log(a.id)
  }
}
// error: cannot change 'items' while 'a' borrows 'items' and is used later
// case: option_refs_move_source
class Item {
  id: i64 = 1
}
function find(items: Ref<Item[]>, id: i64): Ref<Item> | null {
  for (let i = 0; i < items.length; i++) {
    if (items[i].id === id) return items[i]
  }
  return null
}
function main() {
  const items = [new Item()]
  const a = find(items, 1)
  const moved = items
  if (a !== null) console.log(a.id)
}
// error: cannot move 'items' while 'a' borrows 'items' and is used later
// case: option_refs_move_fallback
class Item {
  id: i64 = 1
}
function find(items: Ref<Item[]>, id: i64): Ref<Item> | null {
  return null
}
function main() {
  const items = [new Item()]
  const fallback = new Item()
  const a = find(items, 5) ?? fallback
  const gone = fallback
  console.log(a.id)
}
// error: cannot move 'fallback' while 'a' borrows 'fallback' and is used later
// case: option_refs_mut_read
class Item {
  id: i64 = 1
}
function findMut(items: Mut<Item[]>, id: i64): Mut<Item> | null {
  for (let i = 0; i < items.length; i++) {
    if (items[i].id === id) return items[i]
  }
  return null
}
function main() {
  let items = [new Item()]
  const m = findMut(items, 1)
  console.log(items.length)
  if (m !== null) m.id = 2
}
// error: cannot use 'items.length' while 'm' borrows 'items' mutably and is used later
// case: option_refs_mut_twice
class Item {
  id: i64 = 1
}
function findMut(items: Mut<Item[]>, id: i64): Mut<Item> | null {
  for (let i = 0; i < items.length; i++) {
    if (items[i].id === id) return items[i]
  }
  return null
}
function main() {
  let items = [new Item()]
  const m = findMut(items, 1)
  const n = findMut(items, 1)
  if (m !== null) m.id = 2
}
// error: cannot use 'items' while 'm' borrows 'items' mutably and is used later
// case: option_refs_mut_copied
// A copy of a 'Mut<T> | null' borrows it mutably, so only one of them is used at a time.
class Item {
  count: i64 = 0
}
function pick(it: Mut<Item>): Mut<Item> | null {
  return it
}
function touch(it: Mut<Item>, n: i64) {
  it.count = n
}
function main() {
  let item = new Item()
  const m = pick(item)
  const n = m
  touch(m!, 1)
  touch(n!, 2)
}
// error: cannot use 'm' while 'n' borrows 'm' mutably and is used later
// case: option_refs_method
// A method gives a borrow of what its object holds, or nothing; by elision it borrows 'this'.
class Item {
  id: i64
  name: string
  constructor(id: i64, name: string) {
    this.id = id
    this.name = name
  }
}
class Store {
  items: Item[] = []
  add(this: Mut<this>, item: Item) {
    this.items.push(item)
  }
  get(id: i64): Ref<Item> | null {
    for (const it of this.items) {
      if (it.id === id) return it
    }
    return null
  }
  getMut(this: Mut<this>, id: i64): Mut<Item> | null {
    for (let i = 0; i < this.items.length; i++) {
      if (this.items[i].id === id) return this.items[i]
    }
    return null
  }
}
function pick<A extends Lifetime>(a: Ref<Item, A>, b: Ref<Item>, first: boolean): Ref<Item, A> | null {
  if (first && a.id !== b.id) return a
  return null
}
function main() {
  let store = new Store()
  store.add(new Item(1, "one"))
  store.add(new Item(2, "two"))
  const x = store.get(2)
  if (x !== null) console.log(x.name)
  console.log(store.get(5)?.name ?? "none")
  const m = store.getMut(1)
  if (m !== null) m.name = "uno"
  console.log(store.get(1)!.name)
  const p = new Item(3, "three")
  const q = new Item(4, "four")
  console.log(pick(p, q, true)?.name ?? "none")
}
// expect: two
// expect: none
// expect: uno
// expect: three
// case: option_refs_method_borrows_this
class Item {
  id: i64 = 0
}
class Store {
  items: Item[] = []
  get(id: i64): Ref<Item> | null {
    return this.items.length > 0 ? this.items[0] : null
  }
}
function main() {
  let s = new Store()
  s.items.push(new Item())
  const x = s.get(0)
  s.items.push(new Item())
  console.log(x !== null)
}
// error: cannot change 's.items' while 'x' borrows 's' and is used later
// case: option_refs_two_params
class Item {
  id: i64 = 0
}
function pick(a: Ref<Item>, b: Ref<Item>): Ref<Item> | null {
  return a
}
function main() {}
// error: this function returns a reference and takes several, so say which it points into
// case: option_refs_wrong_lifetime
class Item {
  id: i64 = 0
}
function pick<A extends Lifetime>(a: Ref<Item, A>, b: Ref<Item>): Ref<Item, A> | null {
  return b
}
function main() {}
// error: the returned reference points into 'b', but its lifetime ties it to 'a'
// case: option_refs_nothing_borrowed
function local(): Ref<i64> | null {
  const n = 5
  return n
}
function main() {}
// error: this function returns a reference but borrows nothing it could point into
// case: option_refs_local
function local(x: Ref<i64>): Ref<i64> | null {
  const n = 5
  if (x > 0) return n
  return null
}
function main() {}
// error: can't return a reference to 'n', which belongs to this function
// case: option_refs_field
class C {
  r: Ref<i64> | null = null
}
function main() {}
// error: unions holding references are not supported yet
// case: option_refs_object_literal
function f(x: Ref<i64>): Ref<i64> | null {
  return x
}
function main() {
  const n = 1
  const o = { r: f(n) }
}
// error: unions holding references are not supported yet
// case: option_refs_two_refs
function f(x: Ref<i64> | Ref<string>) {}
function main() {}
// error: unions holding references are not supported yet
// case: option_refs_array
function f(xs: (Ref<i64> | null)[]) {}
function main() {}
// error: arrays of references are not supported yet
// case: option_refs_unwrap_call
// 'find(...)!' borrows what the lookup does.
class Item {
  id: i64 = 1
}
function find(items: Ref<Item[]>, id: i64): Ref<Item> | null {
  for (let i = 0; i < items.length; i++) {
    if (items[i].id === id) return items[i]
  }
  return null
}
function main() {
  let items = [new Item()]
  const r = find(items, 1)!
  items = [new Item()]
  console.log(r.id)
}
// error: cannot change 'items' while 'r' borrows 'items' and is used later
// case: option_refs_unwrap_local
class Item {
  id: i64 = 1
}
function find(items: Ref<Item[]>, id: i64): Ref<Item> | null {
  for (let i = 0; i < items.length; i++) {
    if (items[i].id === id) return items[i]
  }
  return null
}
function main() {
  let items = [new Item()]
  const a = find(items, 1)
  const r: Ref<Item> = a!
  items = [new Item()]
  console.log(r.id)
}
// error: cannot change 'items' while 'r' borrows 'items' and is used later
// case: option_refs_unwrap_move
class Item {
  id: i64 = 1
}
function find(items: Ref<Item[]>, id: i64): Ref<Item> | null {
  for (let i = 0; i < items.length; i++) {
    if (items[i].id === id) return items[i]
  }
  return null
}
function take(xs: Item[]) {}
function main() {
  const items = [new Item()]
  const r = find(items, 1)!
  take(items)
  console.log(r.id)
}
// error: cannot move 'items' while 'r' borrows 'items' and is used later
// case: option_refs_unwrap_method
class Item {
  id: i64 = 1
}
class Store {
  items: Item[] = []
  get(id: i64): Ref<Item> | null {
    for (const it of this.items) if (it.id === id) return it
    return null
  }
}
function main() {
  let s = new Store()
  s.items.push(new Item())
  const x = s.get(1)!
  s.items = []
  console.log(x.id)
}
// error: cannot change 's.items' while 'x' borrows 's' and is used later
// case: option_refs_unwrap_mut
class Item {
  id: i64 = 1
}
function findMut(items: Mut<Item[]>, id: i64): Mut<Item> | null {
  for (let i = 0; i < items.length; i++) {
    if (items[i].id === id) return items[i]
  }
  return null
}
function main() {
  let items = [new Item()]
  const m = findMut(items, 1)
  const r = m!
  items = [new Item()]
  r.id = 2
}
// error: cannot change 'items' while 'r' borrows 'items' mutably and is used later
// case: option_refs_unwrap_mut_shared
class Item {
  id: i64 = 1
}
function findMut(items: Mut<Item[]>, id: i64): Mut<Item> | null {
  for (let i = 0; i < items.length; i++) {
    if (items[i].id === id) return items[i]
  }
  return null
}
function main() {
  let items = [new Item()]
  const m = findMut(items, 1)
  const r: Ref<Item> = m!
  items[0].id = 3
  console.log(r.id)
}
// error: cannot change 'items[0].id' while 'r' borrows 'items' mutably and is used later
// case: option_refs_unwrap_field
class Item {
  id: i64 = 1
}
class Outer {
  inner: Item = new Item()
}
function findO(xs: Ref<Outer[]>): Ref<Outer> | null {
  if (xs.length > 0) return xs[0]
  return null
}
function main() {
  let xs = [new Outer()]
  const o = findO(xs)
  const r: Ref<Item> = o!.inner
  xs = []
  console.log(r.id)
}
// error: cannot change 'xs' while 'r' borrows 'xs' and is used later
// case: option_refs_unwrap_object
class Item {
  id: i64 = 1
}
function find(items: Ref<Item[]>, id: i64): Ref<Item> | null {
  for (let i = 0; i < items.length; i++) {
    if (items[i].id === id) return items[i]
  }
  return null
}
function main() {
  let items = [new Item()]
  const o = { r: find(items, 1)! }
  items = [new Item()]
  console.log(o.r.id)
}
// error: cannot change 'items' while 'o' borrows 'items' and is used later
// case: option_refs_unwrap_tuple
class Item {
  id: i64 = 1
}
function find(items: Ref<Item[]>, id: i64): Ref<Item> | null {
  for (let i = 0; i < items.length; i++) {
    if (items[i].id === id) return items[i]
  }
  return null
}
function main() {
  let items = [new Item()]
  const t: [Ref<Item>, i64] = [find(items, 1)!, 1]
  items = [new Item()]
  console.log(t[0].id)
}
// error: cannot change 'items' while 't' borrows 'items' and is used later
// case: option_refs_unwrap_closure
class Item {
  id: i64 = 1
}
function find(items: Ref<Item[]>, id: i64): Ref<Item> | null {
  for (let i = 0; i < items.length; i++) {
    if (items[i].id === id) return items[i]
  }
  return null
}
function main() {
  let items = [new Item()]
  const r = find(items, 1)!
  const f = () => r.id
  items = [new Item()]
  console.log(f())
}
// error: cannot change 'items' while 'f' borrows 'items' and is used later
// case: option_refs_unwrap_mut_twice
class Item {
  id: i64 = 1
}
function findMut(items: Mut<Item[]>, id: i64): Mut<Item> | null {
  for (let i = 0; i < items.length; i++) {
    if (items[i].id === id) return items[i]
  }
  return null
}
function main() {
  let items = [new Item()]
  const m = findMut(items, 1)!
  const n = findMut(items, 1)!
  m.id = 2
  n.id = 3
}
// error: cannot use 'items' while 'm' borrows 'items' mutably and is used later
// case: option_refs_unwrap_mut_args
class Item {
  id: i64 = 1
}
function findMut(items: Mut<Item[]>, id: i64): Mut<Item> | null {
  for (let i = 0; i < items.length; i++) {
    if (items[i].id === id) return items[i]
  }
  return null
}
function two(a: Mut<Item>, b: Mut<Item>) {}
function main() {
  let items = [new Item()]
  two(findMut(items, 1)!, findMut(items, 1)!)
}
// error: cannot use 'items' while 'items' is lent mutably to 'two' for this call
// case: option_refs_unwrap_move_out
class Item {
  tags: i64[] = [1]
}
class Outer {
  inner: Item = new Item()
}
function findO(xs: Ref<Outer[]>): Ref<Outer> | null {
  if (xs.length > 0) return xs[0]
  return null
}
function main() {
  const xs = [new Outer()]
  const o = findO(xs)
  let v = o!.inner
  v.tags.push(4)
}
// error: 'o!.inner' can't be moved out of 'o', which only borrows it; use 'o!.inner.clone()'
// case: option_refs_unwrap_return_local
class Item {
  id: i64 = 1
}
function find(items: Ref<Item[]>, id: i64): Ref<Item> | null {
  for (let i = 0; i < items.length; i++) {
    if (items[i].id === id) return items[i]
  }
  return null
}
function g(x: Ref<Item>): Ref<Item> {
  const local = [new Item()]
  return find(local, 1)!
}
function main() {}
// error: can't return a reference to 'local', which belongs to this function
// case: option_refs_conditional_place
class Item {
  id: i64 = 1
}
function main() {
  let items = [new Item()]
  const r: Ref<Item> | null = items.length > 0 ? items[0] : null
  items = [new Item()]
  console.log(r!.id)
}
// error: cannot change 'items' while 'r' borrows 'items[...]' and is used later
// case: option_refs_unwrap_ok
// 'x!' passed on or returned borrows what the Option does, and a '?:' lends a place it chooses.
class Item {
  id: i64
  constructor(id: i64) {
    this.id = id
  }
}
function find(items: Ref<Item[]>, id: i64): Ref<Item> | null {
  for (let i = 0; i < items.length; i++) {
    if (items[i].id === id) return items[i]
  }
  return null
}
function g(xs: Ref<Item[]>): Ref<Item> {
  return find(xs, 1)!
}
function h(xs: Ref<Item[]>): Ref<Item> {
  const a = find(xs, 2)
  return a!
}
function main() {
  let items = [new Item(1), new Item(2)]
  console.log(g(items).id, h(items).id)
  const r: Ref<Item> | null = items.length > 1 ? items[1] : null
  console.log(r!.id)
  items.push(new Item(3))
  console.log(items.length)
}
// expect: 1 2
// expect: 2
// expect: 3
// case: option_refs_through_wrappers
class Item {
  name: string;
  constructor(name: string) { this.name = name; }
}
function first(xs: Ref<Item[]>): Ref<Item> {
  return xs[0];
}
function main(): void {
  let items = [new Item("a")];
  const r = first(items) satisfies Ref<Item>;
  items = [new Item("b")];
  console.log(r.name);
}
// error: cannot change 'items' while 'r' borrows 'items' and is used later
// case: option_refs_through_unsafe
class Item {
  name: string;
  constructor(name: string) { this.name = name; }
}
function first(xs: Ref<Item[]>): Ref<Item> {
  return xs[0];
}
function main(): void {
  let items = [new Item("a")];
  const r = unsafe { first(items) };
  items = [new Item("b")];
  console.log(r.name);
}
// error: cannot change 'items' while 'r' borrows 'items' and is used later
// case: option_refs_through_as
class Item {
  name: string;
  constructor(name: string) { this.name = name; }
}
function find(xs: Ref<Item[]>): Ref<Item> | null {
  return xs.length > 0 ? xs[0] : null;
}
function main(): void {
  let items = [new Item("a")];
  const r = (find(items) as Ref<Item> | null)!;
  items = [new Item("b")];
  console.log(r.name);
}
// error: cannot change 'items' while 'r' borrows 'items' and is used later
