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
  a.x = 3
  print(f.x)
}
// error: cannot change 'a.x' while 'f' borrows 'a' and is used later
