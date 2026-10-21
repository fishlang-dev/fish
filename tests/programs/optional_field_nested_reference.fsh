// A reference can't fill in a nested optional field either.
type In = { v: i64; w?: i64 }
type P = { a: i64; i: In }
function g(p: Mut<P>) { p.i.w = 5 }
function main() {
  let q = { a: 1, i: { v: 2 } }
  g(q)
  print(q.a)
}
// error: it has no 'i.w', which a reference can't fill in
