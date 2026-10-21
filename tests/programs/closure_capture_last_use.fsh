// A variable a closure captures is used for as long as the closure is.
type P = { x: i64 }
function main() {
  let p: P = { x: 1 }
  const m: Mut<P> = p
  const r: Ref<P> = p
  print(r.x)
  const g = () => { m.x = 5 }
  g()
  print(r.x)
}
// error: cannot use 'p' while 'm' borrows 'p' mutably and is used later
