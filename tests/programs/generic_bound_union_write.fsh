// A write through a type parameter whose concrete type is a union has to narrow it first.
type A = { kind: 1; a: i64 }
type B = { kind: 2; a: i64; b: i64 }

function put<T extends { a: i64 }>(t: T): i64 {
  let x = t
  x.a = 9
  return x.a
}

function main() {
  const x: A | B = { kind: 2, a: 5, b: 1 }
  print(put(x))
}
// error: can't assign to 'a' through
