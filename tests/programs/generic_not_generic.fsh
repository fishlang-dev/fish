class Point {}

function main() {
  const p: Point<i64> = new Point()
}
// error: type 'Point' is not generic
