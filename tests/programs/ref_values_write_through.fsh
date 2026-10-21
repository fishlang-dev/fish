class P {
  x = 0
}

type Holder = { r: Ref<P> }

function main() {
  let p = new P()
  let h: Holder = { r: p }
  h.r.x = 2
}
// error: cannot assign to 'h.r.x' because 'h.r' is a shared reference ('Ref'), which only reads
