// References as type arguments: a generic box and a generic identity keep their source
// borrowed like the reference itself.
class P {
  x = 3
}

class Box<T> {
  v: T
  constructor(v: T) {
    this.v = v
  }
  get(): T {
    return this.v.clone()
  }
}

function id<T>(t: T): T {
  return t
}

function main() {
  const p = new P()
  const b = new Box(p.clone())
  const r: Ref<P> = p
  const boxed = new Box(r)
  const same = id(r)
  print(b.get().x, boxed.v.x, same.x)
}
// expect: 3 3 3
