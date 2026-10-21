function check(n: i64): string {
  match (n) {
    case 0 => {
      return "zero";
    },
    case _ => {},
  }
  return "fell through";
}

function main() {
  console.log(check(0));
}
// error: this match's value isn't used, so a 'return' in its arm can't give one
