class Temperature {
  private kelvin: i64

  constructor(celsius: i64) {
    this.kelvin = celsius + 273
  }

  get celsius(): i64 {
    return this.kelvin - 273
  }

  set celsius(value: i64) {
    this.kelvin = value + 273
  }

  get boiling(): boolean {
    return this.celsius >= 100
  }
}

class Box {
  constructor(public inner: Temperature) {}
}

function main() {
  let t = new Temperature(20)
  print(t.celsius, t.boiling)
  t.celsius = 99
  print(t.celsius, t.boiling)
  t.celsius += 1
  print(t.celsius, t.boiling)
  t.celsius++
  print(t.celsius = 5, t.celsius)
  let b = new Box(new Temperature(1))
  b.inner.celsius *= 30
  print(b.inner.celsius)
  print(new Temperature(-40).celsius)
}
// expect: 20 false
// expect: 99 false
// expect: 100 true
// expect: 5 5
// expect: 30
// expect: -40
