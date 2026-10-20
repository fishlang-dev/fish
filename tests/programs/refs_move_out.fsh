type P = { x: i64 }

function own(p: P): i64 {
  return p.x
}

function take(r: Ref<P>): i64 {
  return own(r)
}

function main() {
  const p: P = { x: 1 }
  print(take(p))
}
// error: can't move a value out of a reference to it, which only borrows it; use '.clone()' to hand over a copy
