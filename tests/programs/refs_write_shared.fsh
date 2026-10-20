type P = { x: i64 }

function main() {
  let p: P = { x: 1 }
  let r: Ref<P> = p
  r.x = 2
}
// error: cannot assign to 'r.x' because 'r' is a shared reference ('Ref'), which only reads
