function f(n: i64): i64 {
  return match (n) {
    case 0 => {
      return;
    },
    case _ => 2,
  };
}

function main() {
  console.log(f(0));
}
// error: this match gives a value, so a 'return' in its arm needs one
