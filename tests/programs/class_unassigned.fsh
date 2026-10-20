class Point {
  x: i64
  y: i64

  constructor(x: i64) {
    this.x = x
  }
}

function main() {}
// error: property 'y' has no initializer and is not definitely assigned in the constructor
// error:   y: i64
// error:   ^^^^^^
