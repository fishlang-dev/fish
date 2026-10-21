enum Color {
  Red,
  Green,
  Blue,
}

function f(c: Color): i64 {
  return match (c) {
    case Color.Red => 1,
    case Color.Green => 2,
  };
}

function main() {}
// error: this match doesn't cover Color.Blue; add 'case Color.Blue =>', or 'case _ =>' for the rest
