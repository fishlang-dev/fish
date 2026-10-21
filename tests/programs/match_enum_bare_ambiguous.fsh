enum Color {
  Red,
  Green,
}

enum Light {
  Red = 10,
  Off = 11,
}

function h(x: Color | Light): string {
  return match (x) {
    case Red => "red",
    case _ => "rest",
  };
}

function main() {
  console.log(h(Light.Red));
}
// error: 'Red' is a member of 'Color' and 'Light'; name which, as 'Color.Red'
