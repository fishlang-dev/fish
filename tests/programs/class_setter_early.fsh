class A {
  x: i64
  y: i64

  constructor() {
    this.v = 5
    this.x = 1
    this.y = 2
  }

  set v(n: i64) {
    print(this.x + this.y + n)
  }
}

function main() {}
// error: 'this' can't be used until every field is assigned
