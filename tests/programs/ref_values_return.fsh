// A function can return a value holding references into its parameters; the caller keeps
// them borrowed while the value is used.
class P {
  x = 1
}

type View = { r: Ref<P>; n: i64 }

function view(p: Ref<P>, n: i64): View {
  return { r: p, n }
}

function main() {
  const p = new P()
  const v = view(p, 3)
  print(v.r.x + v.n)
}
// expect: 4
