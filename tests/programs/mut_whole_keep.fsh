class P {
  x = 1
}

class View {
  r: Ref<P>
  constructor(r: Ref<P>) {
    this.r = r
  }
}

function f(m: Mut<View>) {
  let local = new P()
  m = new View(local)
}

function main() {}
// error: keeping references through the reference 'm' is not supported yet
