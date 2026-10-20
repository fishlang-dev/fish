class Base {
  constructor(public x: i64) {}
}

class Derived extends Base {
  constructor() {
    print(1)
    super(1)
  }
}

function main() {}
// error: a derived class's constructor must start with 'super(...)'
