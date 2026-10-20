// Narrowed variables, enum members, union shared fields and Copy values of another type are
// lent as copies where they aren't exactly what is borrowed.
type P = { x: i64 }
type U = { kind: "a"; p: P } | { kind: "b"; p: P; z: i64 }

enum Color {
  Red,
  Green,
  Blue,
}

function rb(u: Ref<i64 | boolean>): i64 {
  return u === true ? 1 : u === false ? 2 : 3
}

function rc(c: Ref<Color>): i64 {
  return c
}

function ri(k: Ref<i64>): i64 {
  return k
}

function look(r: Ref<P>): i64 {
  return r.x
}

function via(u: Ref<U>): i64 {
  return look(u.p)
}

function main() {
  const b: P | boolean | i64 = 7
  if (typeof b !== "object") print(rb(b))
  const c: "q" | boolean | i64 = false
  if (c !== "q") print(rb(c))
  const g = Color.Blue
  const one: 1 = 1
  const u: U = { kind: "b", p: { x: 4 }, z: 1 }
  print(rc(Color.Green), ri(Color.Blue), rc(g), ri(one), look(u.p), via(u))
}
// expect: 3
// expect: 2
// expect: 1 2 2 1 4 4
