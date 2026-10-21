enum Color {
  Red,
  Green,
  Blue,
}

function name(c: Color): string {
  return match (c) {
    case Red => "red",
    case Green => "green",
    case Blue => "blue",
  };
}

function main() {
  console.log(name(Color.Red), name(Color.Green), name(Color.Blue));
}
// expect: red green blue
