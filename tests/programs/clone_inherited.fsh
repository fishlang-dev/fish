// A base's own clone() makes a base, so a derived class without one gets the compiler's copy;
// Copy values clone too.
class Base {
  n: i64 = 1
  clone(): Base {
    let b = new Base()
    b.n = this.n + 100
    return b
  }
}

class Derived extends Base {
  m: i64 = 2
}

function main() {
  const d = new Derived()
  const e: Derived = d.clone()
  const five = 5
  print(e.n, e.m, d.clone().n, new Base().clone().n, five.clone())
}
// expect: 1 2 1 101 5
