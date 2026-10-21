class P {
  x = 0
}

function bad(r: Ref<P>): Ref<P> {
  const p: P = { x: r.x }
  return p
}

function main() {}
// error: can't return a reference to 'p', which belongs to this function and is gone once it returns
