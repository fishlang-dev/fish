// A closure in a value returned from a function can't borrow its locals.
class S { constructor(public n: i64) {} }
function wrap<T>(t: T) { return { v: t } }
function mk() {
  const s = new S(5)
  return wrap(() => s.n)
}
function clobber(): i64 {
  const a = { a: 11, b: 12, c: 13, d: 14, e: 15, f: 16, g: 17, h: 18 }
  const b = { a: 21, b: 22, c: 23, d: 24, e: 25, f: 26, g: 27, h: 28 }
  return a.a + b.h
}
function main() {
  const w = mk()
  print(clobber())
  const f = w.v
  print(f())
}
// error: can't return a reference to 's', which belongs to this function
