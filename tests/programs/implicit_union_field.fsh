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
