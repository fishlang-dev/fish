class P {
  x = 3
}

class Box<T> {
  v: T
  constructor(v: T) {
    this.v = v
  }
}

function main() {
  let p = new P()
  const r: Ref<P> = p
  const boxed = new Box(r)
  p.x = 4
  print(boxed.v.x)
}
// error: cannot change 'p.x' while 'boxed' borrows 'p' and is used later
