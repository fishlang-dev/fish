// Nor in a field of one.
type P = { x: i64 }
type H = { r: Ref<P> }
function clobber(): i64 {
  const a = { a: 11, b: 12, c: 13, d: 14, e: 15, f: 16, g: 17, h: 18 }
  const b = { a: 21, b: 22, c: 23, d: 24, e: 25, f: 26, g: 27, h: 28 }
  return a.a + b.h
}
function put(f: (a: Ref<P>) => void) {
  const t: P = { x: 42 }
  f(t)
}
function main() {
  let q: P = { x: 1 }
  let h: H = { r: q }
  put((a) => { h.r = a })
  print(clobber())
  print(h.r.x)
}
// error: keeping references in 'h', which this closure captures, is not supported yet
