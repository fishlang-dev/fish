interface HasX {
  x: i64
}

class Pt {
  constructor(public y: i64, public x: i64) {}
}

class Flat {
  constructor(public x: i64) {}
}

class Holder {
  a: i64

  constructor(s: HasX) {
    this.a = s.x
  }
}

function main() {
  print(new Holder(new Pt(3, 4)).a, new Holder(new Flat(5)).a)
}
// expect: 4 5
