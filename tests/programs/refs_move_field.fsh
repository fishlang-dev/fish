type Inner = { v: i64 }
type P = { inner: Inner }

function own(i: Inner): i64 {
  return i.v
}

function take(r: Ref<P>): i64 {
  const l: Ref<P> = r
  return own(l.inner)
}

function main() {
  const p: P = { inner: { v: 1 } }
  print(take(p))
}
// error: 'l.inner' can't be moved out of 'l', which only borrows it; use 'l.inner.clone()'
