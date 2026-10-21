enum Shape {
  Circle(f64),
  Rect(f64, f64),
  Empty,
}

function f(s: Shape): i64 {
  return match (s) {
    case Circle(_) => 1,
    case Rect(1.0, _) => 2,
    case Empty => 3,
  };
}

function main() {}
// error: this match doesn't cover Shape.Rect(_, _)
