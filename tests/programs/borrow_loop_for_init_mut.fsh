type P = { x: i64 }

function main() {
  let p: P = { x: 1 }
  let q: P = { x: 2 }
  let i = 0
  for (let m: Mut<P> = q; i < 3; i++) {
    print(p.x)
    print(m.x)
    m = p
  }
}
// error: cannot use 'p.x' while 'm' borrows 'p' mutably and is used later
