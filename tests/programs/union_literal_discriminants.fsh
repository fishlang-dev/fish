type Result = { ok: true; value: i64 } | { ok: false; code: i64 }
type Shape = { kind: 1; r: i64 } | { kind: 2; s: i64 }
type Flag = { on: true }
type Nested = { inner: { tag: "x"; n: i64 } } | { inner: { tag: "y" } }

function describe(r: Result): i64 {
  if (r.ok === true) return r.value
  return -r.code
}

function main() {
  const good: Result = { ok: true, value: 3 }
  const bad: Result = { ok: false, code: 7 }
  print(describe(good), describe(bad), describe({ ok: true, value: 9 }))
  const s: Shape = { kind: 2, s: 5 }
  print(s.kind)
  const f: Flag = { on: true }
  print(f.on)
  const n: Nested = { inner: { tag: "x", n: 4 } }
  print(n.inner.tag)
}
// expect: 3 -7 9
// expect: 2
// expect: true
// expect: x
