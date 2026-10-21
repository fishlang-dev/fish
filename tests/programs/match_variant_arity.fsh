enum Shape {
  Circle(f64),
  Rect(f64, f64),
  Empty,
}

function f(s: Shape): i64 {
  return match (s) {
    case Circle(a, b) => 1,
    case _ => 2,
  };
}

function main() {}
// error: 'Shape.Circle' holds 1 value, so its pattern takes 1
