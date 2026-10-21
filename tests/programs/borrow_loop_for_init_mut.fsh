// A mutable reference declared in a for initializer keeps what it borrows, and assigning to
// it writes through, on every pass.
type P = { x: i64 }

function main() {
  let q: P = { x: 2 }
  let i = 0
  for (let m: Mut<P> = q; i < 3; i++) {
    m = { x: m.x + 10 }
  }
  print(q.x)
}
// expect: 32
