// Lending a value with readonly fields mutably as a type without them is fine.
class Account { readonly id: i64; n = 0; constructor(id: i64) { this.id = id } }
type Counter = { n: i64 }
function bump(c: Mut<Counter>) { c.n += 1 }
function peek(c: Ref<{ id: i64 }>): i64 { return c.id }
function main() {
  let b = new Account(2)
  bump(b)
  print(b.n, peek(b))
}
// expect: 1 2
