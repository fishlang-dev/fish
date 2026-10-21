function main() {
  const n: i64 = 3;
  const x = match (n) {
    case "s" => 1,
    case _ => 2,
  };
}
// error: this pattern can never match a 'i64'
