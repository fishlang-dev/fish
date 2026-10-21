enum Shape {
  Circle(f64),
  Rect(f64, f64),
  Empty,
}

function f(s: Shape): i64 {
  return match (s) {
    case Circle(_) => 1,
    case Rect(_, _) => 2,
  };
}

function main() {}
// error: this match doesn't cover Shape.Empty; add 'case Shape.Empty =>', or 'case _ =>' for the rest
