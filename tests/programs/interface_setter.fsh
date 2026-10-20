interface HasX {
  x: i64
}

class Holder {
  a = 0

  set v(s: HasX) {
    this.a = s.x
  }
}

function main() {}
// error: a setter's parameter can't have the interface type 'HasX'
