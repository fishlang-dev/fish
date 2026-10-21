class P {
  x = 1
}

type View = { r: Ref<P>; n: i64 }

function f(p: Ref<P>): Ref<View> {
  const v: View = { r: p, n: 1 }
  const rv: Ref<View> = v
  return rv
}

function main() {}
// error: can't return a reference to 'v', which belongs to this function
