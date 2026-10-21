type A = { kind: "a"; x: i64 }
type B = { kind: "b"; x: i64; y: i64 }

function idi(k: Ref<i64>): Ref<i64> {
  return k
}

function bad(u: Ref<A | B>): Ref<i64> {
  return idi(u.x)
}

function main() {}
// error: can't return a reference to a temporary or a copy
