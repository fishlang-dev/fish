function* g(): Generator<i64> {
  yield 1;
}

function main() {
  let it = g();
  const r = it.next(5);
}
// error: values sent into 'next' are not supported yet
