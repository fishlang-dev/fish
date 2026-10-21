class P {
  x = 1
}

type View = { r: Ref<P> }

function view(p: Ref<P>): View {
  const local = new P()
  return { r: local }
}

function main() {}
// error: can't return a reference to 'local', which belongs to this function
