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
