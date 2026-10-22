function* g(): Generator<i64> {
  const x = 1 + (yield 2);
  yield x;
}

function main() {
  const it = g();
}
// error: 'yield' inside expressions are not supported yet
