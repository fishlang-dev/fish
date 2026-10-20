interface Shape {
  scaled(by: i64): i64
}

class Square {
  scaled(by: boolean): i64 {
    return 1
  }
}

function main() {
  const s: Shape = new Square()
}
// error: type 'Square' is not assignable to type 'Shape': types of method 'scaled' are incompatible
