function count(xs: i64[]): i64 {
  return match (xs) {
    case [] => 0,
    case [_] => 1,
  };
}

function main() {
  console.log(count([]));
}
// error: this match doesn't cover every 'i64[]'; add 'case _ =>' for the rest
