class Point {
  x: i64
  y: i64

  constructor(x: i64) {
    this.x = x
    this.y = this.x
  }
}

function main() {}
// error: 'this' can't be used until every field is assigned
// error:     this.y = this.x
// error:              ^^^^
