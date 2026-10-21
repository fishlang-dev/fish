class P {
  x = 0
}

function make(): Ref<P> {
  const p: P = { x: 1 }
  return p
}

function main() {}
// error: this function returns a reference but borrows nothing it could point into
