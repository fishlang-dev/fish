class P {
  x = 0
}

function bad(r: Ref<P>, q: P): Ref<P> {
  return q
}

function main() {}
// error: can't return a reference to 'q', which belongs to this function
