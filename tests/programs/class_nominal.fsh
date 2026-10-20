class Meters {
  constructor(public value: i64) {}
}

class Feet {
  constructor(public value: i64) {}
}

function main() {
  const m: Meters = new Feet(3)
}
// error: type 'Feet' is not assignable to type 'Meters'
