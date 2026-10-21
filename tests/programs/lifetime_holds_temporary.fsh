class P {
  x = 0
}

function bad(q: Ref<P>): Ref<P> {
  const r: Ref<P> = new P()
  return r
}

function main() {}
// error: can't return a reference to a temporary or a copy
