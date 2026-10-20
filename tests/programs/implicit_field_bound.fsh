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
