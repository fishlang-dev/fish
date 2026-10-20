class Circle {
  constructor(public r: i64) {}

  get diameter(): i64 {
    return this.r * 2
  }
}

function main() {
  let c = new Circle(1)
  c.diameter = 4
}
// error: cannot assign to 'diameter' because it is a read-only property
