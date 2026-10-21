type P = { x: i64 }

function f(a: Ref<i64>, b: i64): i64 {
  return a * 100 + b
}

function main() {
  let p: P = { x: 1 }
  const r: Ref<P> = p
  print(f(r.x, p.x++))
}
// error: cannot change 'p.x' while 'r' borrows 'p' and is used later
