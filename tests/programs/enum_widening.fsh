enum Mode {
  Off,
  On,
}

class Light {
  mode = Mode.Off

  toggle(this: Mut<this>) {
    this.mode = this.mode === Mode.On ? Mode.Off : Mode.On
  }
}

class Box<T> {
  constructor(public value: T) {}

  set(this: Mut<this>, value: T) {
    this.value = value
  }
}

function pick<T>(first: boolean, a: T, b: T): T {
  return first ? a : b
}

function main() {
  let m = Mode.Off
  m = Mode.On
  let light = new Light()
  light.toggle()
  let b = new Box(Mode.On)
  b.set(Mode.Off)
  let s = { mode: Mode.Off }
  s.mode = Mode.On
  print(m, light.mode, b.value, pick(false, Mode.On, Mode.Off), s.mode)
}
// expect: 1 1 0 0 1
