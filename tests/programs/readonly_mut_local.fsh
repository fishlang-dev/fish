// Nor to a mutable reference variable.
class Account { readonly id: i64; n = 0; constructor(id: i64) { this.id = id } }
type Writable = { id: i64 }
function main() {
  let b = new Account(2)
  const m: Mut<Writable> = b
  m.id = 9
  print(b.id)
}
// error: 'id' is read-only here, so it can't be lent mutably as '{ id: i64 }'
