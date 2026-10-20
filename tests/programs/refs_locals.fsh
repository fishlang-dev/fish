// A reference variable can point somewhere else, a ?: of references or of a reference and a
// value works, and a reference can be the right side of a compound assignment.
type P = { x: i64 }

function pick(c: boolean, a: Ref<P>, b: Ref<P>): i64 {
  const r = c ? a : b
  return r.x
}

function mix(c: boolean, k: Ref<i64>): i64 {
  return (c ? k : 3) + 1
}

function add(n: i64, k: Ref<i64>, f: Ref<boolean>): i64 {
  let total = n
  total += k
  let flag = true
  flag &&= f
  return flag ? total : -total
}

function main() {
  const a: P = { x: 1 }
  const b: P = { x: 2 }
  let r: Ref<P> = a
  const first = r.x
  r = b
  print(first, r.x, pick(true, a, b), pick(false, a, b), mix(true, 5), mix(false, 5), add(1, 2, true), add(1, 2, false))
}
// expect: 1 2 1 2 6 4 3 -3
