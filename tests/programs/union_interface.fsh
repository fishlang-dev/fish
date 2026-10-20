interface Shape {
  area(): i64
}

function main() {
  const x: Shape | i64 = 1
}
// error: an interface can't be a union member
