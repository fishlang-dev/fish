class P {
  x = 0
}

function bad(q: Ref<P>): Ref<P> {
  const r: Ref<P> = new P()
  return r
}

function main() {}
// error: 'r' would keep borrowing this temporary, which is gone once its statement ends
