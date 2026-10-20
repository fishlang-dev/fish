class Circle {
  constructor(public r: i64) {}

  set radius(value: i64) {
    this.r = value
  }
}

function main() {
  print(new Circle(1).radius)
}
// error: property 'radius' has a setter but no getter
