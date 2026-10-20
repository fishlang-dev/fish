class Circle {
  constructor(public r: i64) {}

  set radius(value: i64) {
    this.r = value
  }
}

function main() {
  const c = new Circle(1)
  c.radius = 4
}
// error: cannot assign to 'c.radius' because 'c' is a constant
