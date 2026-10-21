// A value lacking a nested optional field is copied in with it empty.
type In = { v: i64; w?: i64 }
type P = { a: i64; i: In }
function g(p: P): i64 { let x = p; x.i.w = 5; return x.i.w ?? 0 }
function main() {
  const q = { a: 1, i: { v: 2 } }
  print(g(q))
}
// expect: 5
