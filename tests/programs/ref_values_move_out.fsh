class Inner {
  v = 0
}

class P {
  inner = new Inner()
}

type Holder = { r: Ref<P> }

function take(i: Inner): i64 {
  return i.v
}

function main() {
  const p = new P()
  const h: Holder = { r: p }
  print(take(h.r.inner))
}
// error: 'h.r.inner' can't be moved out of 'h.r', which only borrows it
