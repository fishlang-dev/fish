// A result borrows only what its lifetime ties it to, and only until its last use.
class P {
  x = 0
}

function first<A extends Lifetime>(x: Ref<P, A>, y: Ref<P>): Ref<P, A> {
  return x
}

function main() {
  let a: P = { x: 1 }
  let b: P = { x: 2 }
  const f = first(a, b)
  b.x = 5
  print(f.x)
  a.x = 3
  print(a.x, b.x)
}
// expect: 1
// expect: 3 5
