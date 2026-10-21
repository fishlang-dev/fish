function main() {
  const n: i64 = 3;
  const x = match (n) {
    case k if k > 0 => 1,
  };
}
// error: this match doesn't cover every 'i64'
