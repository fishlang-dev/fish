class P {
  x = 1
}

function f(m: Mut<P>, n: P): P {
  const old = (m = n)
  return old
}

function main() {}
// error: this assignment's value can't be used: it was moved into what 'm' points to
