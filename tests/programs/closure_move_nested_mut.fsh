// A nested `move` closure changing through a captured `Mut` makes the outer closure borrow it mutably.
type P = { x: i64 }
function main() {
  let p: P = { x: 1 }
  const m: Mut<P> = p
  const mid = () => {
    const inner = move () => { m.x = m.x + 1 }
    inner()
  }
  const r: Ref<P> = m
  print(r.x)
  mid()
  print(r.x)
}
// error: cannot use 'm' while 'mid' borrows 'm' mutably and is used later
