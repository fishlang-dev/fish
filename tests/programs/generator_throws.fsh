function* g(): Generator<i64> throws string {
  yield 1;
}

function main() {
  const it = g();
}
// error: generators that throw are not supported yet
