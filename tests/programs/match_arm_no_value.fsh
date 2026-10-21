function f(n: i64): i64 {
  return match (n) {
    case 0 => {
      if (n > 0) return 1;
    },
    case _ => 2,
  };
}

function main() {
  console.log(f(0));
}
// error: this arm can reach its end without giving a value; give one with 'return'
