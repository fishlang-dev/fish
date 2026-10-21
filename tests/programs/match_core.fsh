enum Color {
  Red,
  Green,
  Blue,
}

type Dir = "up" | "down";

function name(c: Color): string {
  return match (c) {
    case Color.Red => "red",
    case Color.Green | Color.Blue => "cool",
  };
}

function size(n: i64): string {
  return match (n) {
    case 0 => "none",
    case 1 | 2 => "few",
    case k if k < 0 => "negative " + k,
    case _ => "many",
  };
}

function flip(d: Dir): Dir {
  return match (d) {
    case "up" => "down",
    case "down" => "up",
  };
}

function main() {
  const b = true;
  const yes = match (b) {
    case true => 1,
    case false => 0,
  };
  console.log(name(Color.Red), name(Color.Blue), size(0), size(2), size(-3), size(9), flip("up"), yes);
  const word: string = "hi" + 1;
  match (word) {
    case "hi1" => console.log("matched", word),
    case w => console.log("other", w),
  };
  const small: u8 = 7;
  const label = match (small) {
    case 7 => "seven",
    case _ => "?",
  };
  const maybe: i64 | null = null;
  const m = match (maybe) {
    case null => -1,
    case v => v,
  };
  console.log(label, m);
}
// expect: red cool none few negative -3 many down 1
// expect: matched hi1
// expect: seven -1
