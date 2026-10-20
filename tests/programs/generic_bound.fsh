interface Shape {
  area(): i64
}

function total<S extends Shape>(s: S): i64 {
  return s.area()
}

function main() {
  print(total({ x: 1 }))
}
// error: type '{ x: i64 }' does not satisfy the constraint 'Shape': method 'area' is missing in type '{ x: i64 }' but required in type 'Shape'
