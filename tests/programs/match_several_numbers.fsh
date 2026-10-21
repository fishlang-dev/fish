function f(x: i32 | u8): string {
  return match (x) {
    case 5 => "five",
    case _ => "other",
  };
}

function main() {
  const v: u8 = 5;
  console.log(f(v));
}
// error: a number can't be matched against 'i32 | u8', which holds several number types
