class P {
  x = 0
}

function first(x: Ref<P>, y: Ref<P>): Ref<P> {
  return x
}

function main() {}
// error: this function returns a reference and takes several, so say which it points into
