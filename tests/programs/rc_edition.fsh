// case: rc_edition_aliasing
// @fish-edition rc
// In the reference-counted edition, objects of the file's own classes are shared as in TypeScript.
class Counter {
  n: i64 = 0
}

function main() {
  const a = new Counter()
  const b = a
  b.n = 5
  a.n++
  print(a.n, b.n, a === b)
}
// expect: 6 6 true
// case: rc_edition_methods
// @fish-edition rc
// A method that changes its object runs on the shared object, seen through every name for it.
class Account {
  balance: i64 = 0
  history: i64[] = []
  deposit(amount: i64) {
    this.balance += amount
    this.history.push(amount)
  }
  total(): i64 {
    return this.balance
  }
}

function main() {
  const acct = new Account()
  const same = acct
  acct.deposit(10)
  same.deposit(5)
  print(acct.total(), same.history.length)
}
// expect: 15 2
// case: rc_edition_object_types
// @fish-edition rc
// An object literal of one of the file's types is shared too, passed to functions and changed there.
type Item = { name: string; qty: i64 }
type Cart = { items: Item[] }

function add(cart: Cart, item: Item) {
  cart.items.push(item)
}

function main() {
  const cart: Cart = { items: [] }
  const apple: Item = { name: "apple", qty: 1 }
  add(cart, apple)
  add(cart, apple)
  apple.qty = 3
  let total = 0
  for (const it of cart.items) total += it.qty
  print(cart.items.length, total)
}
// expect: 2 6
// case: rc_edition_identity
// @fish-edition rc
// '===' on shared objects asks whether they are the same object.
class Node {
  label: string
  constructor(label: string) {
    this.label = label
  }
}

function main() {
  const a = new Node("a")
  const b = new Node("a")
  const c = a
  print(a === c, a === b, a !== b)
}
// expect: true false true
// case: rc_edition_cycle
// @fish-edition rc
// A field that can lead back to its own type can make a cycle, which reference counting never frees.
class Node {
  next: Node | null = null
}

function main() {
  const n = new Node()
  print(n.next === null)
}
// warning: 'Node.next' can lead back to a 'Node'
// expect: true
// case: rc_edition_weak
// @fish-edition rc
// A 'Weak' link makes no cycle.
class Parent {
  name: string
  constructor(name: string) {
    this.name = name
  }
}

class Child {
  parent: Weak<Parent>
  constructor(parent: Weak<Parent>) {
    this.parent = parent
  }
}

function main() {
  const p = new Parent("root")
  const c = new Child(p.downgrade())
  const up = c.parent.upgrade()
  if (up !== null) print(up.name)
}
// expect: root
// case: rc_edition_unknown
// @fish-edition counted
function main() {}
// error: an edition directive is written '// @fish-edition native', '// @fish-edition rc' or '// @fish-edition ts-compat'
