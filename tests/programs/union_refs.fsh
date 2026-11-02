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
