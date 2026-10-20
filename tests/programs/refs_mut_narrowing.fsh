// A mutable reference to a union narrowed to several members can still be read.
type P = { x: i64 }

function rb(u: Ref<i64 | boolean>): i64 {
  return u === true ? 1 : u === false ? 2 : 3
}

function f(u: Mut<i64 | boolean | P>): i64 {
  if (typeof u !== "object") return rb(u)
  return u.x
}

function main() {
  let a: i64 | boolean | P = false
  let b: i64 | boolean | P = { x: 9 }
  print(f(a), f(b))
}
// expect: 2 9
