// case: implicit_field_bound
interface H {
  a: i64 | boolean
}

interface Nested {
  inner: { v: i64 | boolean }
}

class C {
  a: i64 = 3
}

class Flagged {
  a = true
}

function use(h: H): i64 {
  const r = h.a
  if (typeof r === "number") return r * 10
  return r ? 1 : 0
}

function deep(n: Nested): i64 {
  const v = n.inner.v
  return typeof v === "number" ? v : -1
}

function main() {
  print(use(new C()), use(new Flagged()), use({ a: 4 }))
  const wide = { inner: { v: 4 }, extra: 1 }
  print(deep({ inner: { v: 7 } }), deep(wide), deep({ inner: { v: false } }))
}
// expect: 30 1 40
// expect: 7 4 -1
// case: implicit_union_field
interface H {
  v: i64 | boolean
}

type Wide = { v: i64 | boolean; k: i64 }

function use(h: H): i64 {
  const r = h.v
  if (typeof r === "number") return r
  return -1
}

function wide(x: Wide): i64 {
  const v = x.v
  return typeof v === "boolean" ? (v ? 1 : 0) : v + x.k
}

function main() {
  const narrowBool = { v: false }
  const narrowNum = { v: 7, extra: true }
  print(use({ v: false }), use(narrowBool), use(narrowNum))
  const w = { v: 5, k: 10 }
  const t = { v: true, k: 0 }
  print(wide(w), wide(t))
}
// expect: -1 -1 7
// expect: 15 1
