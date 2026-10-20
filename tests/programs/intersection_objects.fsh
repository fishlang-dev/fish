// `A & B` of object types is one merged struct, merging nested object fields; a field is
// readonly only when both sides say so.
type Named = { name: i64; meta: { created: i64 } }
type Aged = { age: i64; meta: { updated: i64 } }
type Person = Named & Aged

type Locked = { readonly id: i64 } & { readonly id: i64; note: i64 }
type Open = { readonly id: i64 } & { id: i64 }

function describe(p: Named & Aged): i64 {
  return p.name * 1000 + p.age * 100 + p.meta.created * 10 + p.meta.updated
}

function main() {
  let p: Person = { name: 1, age: 2, meta: { created: 3, updated: 4 } }
  p.age = 5
  p.meta.updated = 6
  const same: { age: i64; meta: { created: i64; updated: i64 }; name: i64 } = p
  let o: Open = { id: 1 }
  o.id = 7
  const l: Locked = { id: 8, note: 9 }
  print(describe(p), describe(same), o.id, l.id + l.note)
}
// expect: 1536 1536 7 17
