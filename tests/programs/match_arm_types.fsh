function small(n: i64): u8 {
  return match (n) {
    case 0 => 1,
    case _ => 2,
  };
}

function pick(n: i64): u8 {
  return n === 0 ? 3 : 4;
}

function mixed(n: i64, x: u8): u8 {
  const v = match (n) {
    case 0 => x,
    case _ => 7,
  };
  return v;
}

function main() {
  const k = 1;
  const s = match (k) {
    case 0 => "zero",
    case _ => "many",
  };
  console.log(s + "!", small(0), small(5), pick(0), pick(1), mixed(0, 9), mixed(1, 9));
}
// expect: many! 1 2 3 4 9 7
