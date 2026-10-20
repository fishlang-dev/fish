class Point {
  constructor(public x: i64) {}
}

function take(p: Point) {}

function main() {
  const o = { x: 1 }
  take(o)
}
// error: argument of type '{ x: i64 }' is not assignable to parameter of type 'Point'
