function main() {
  const n: i64 = 3;
  const x = match (n) {
    case 1 => "a",
  };
}
// error: this match doesn't cover every 'i64'; add 'case _ =>' for the rest
