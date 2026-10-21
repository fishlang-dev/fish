class P {
  x = 0
}

interface V {
  pick(x: Ref<P>): Ref<P>
}

class C {
  pick<A extends Lifetime>(x: Ref<P, A>): Ref<P, A> {
    return x
  }
}

function h<T extends V>(v: Ref<T>): i64 {
  const p = new P()
  return v.pick(p).x
}

function main() {
  print(h(new C()))
}
// error: returns a reference tied to lifetime 'A' of a parameter
