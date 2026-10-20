type Locked = { readonly id: i64 } & { readonly id: i64; note: i64 }

function main() {
  let l: Locked = { id: 1, note: 2 }
  l.id = 3
}
// error: cannot assign to 'id' because it is a read-only property
