class Point {
  x: i64

  constructor(skip: boolean) {
    if (skip) return
    this.x = 1
  }
}

function main() {}
// error: a constructor can't return before every field is assigned
