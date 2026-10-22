function* g(n: i64): Generator<i64> {
  match (n) {
    case 0 => {
      yield 1;
    },
    case _ => {},
  }
}

function main() {
  const it = g(0);
}
// error: 'yield' inside match arms are not supported yet
