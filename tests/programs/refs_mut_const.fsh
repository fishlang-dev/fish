type P = { x: i64 }

function lookMut(p: Mut<P>): i64 {
  return p.x
}

function main() {
  const p: P = { x: 4 }
  print(lookMut(p))
}
// error: cannot mutably borrow 'p' because it is a constant
