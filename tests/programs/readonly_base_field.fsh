class Base {
  readonly n: i64 = 0
}

class Derived extends Base {
  constructor() {
    super()
    this.n = 2
  }
}

function main() {
  print(new Derived().n)
}
// error: cannot assign to 'n' because it is a read-only property
