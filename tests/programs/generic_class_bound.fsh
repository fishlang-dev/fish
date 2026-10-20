interface Measured {
  size(): i64
}

class Sized<T extends Measured> {
  constructor(public item: T) {}
}

function main() {
  new Sized(1)
}
// error: type 'i64' does not satisfy the constraint 'Measured': method 'size' is missing in type 'i64' but required in type 'Measured'
