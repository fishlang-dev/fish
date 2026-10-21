enum Shape {
  Circle(f64),
  Rect(f64, f64),
  Empty,
}

function f(o: string | null): i64 {
  return match (o) {
    case Some(x) => 1,
  };
}

function main() {}
// error: this match doesn't cover null
