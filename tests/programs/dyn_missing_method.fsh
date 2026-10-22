// error: method 'area' is missing in type 'Circle' but required in type 'Shape'
interface Shape {
  area(): i64;
}

class Circle {
  r: i64 = 1;
}

function main() {
  const s: Dyn<Shape> = new Circle();
}
