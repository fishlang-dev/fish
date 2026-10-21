type P = { x: i64 }

function main() {
  let p: P = { x: 1 }
  let q: P = { x: 2 }
  let i = 0
  for (let r: Ref<P> = q; i < 3; i++) {
    p.x = i
    print(r.x)
    r = p
  }
}
// error: cannot change 'p.x' while 'r' borrows 'p' and is used later
