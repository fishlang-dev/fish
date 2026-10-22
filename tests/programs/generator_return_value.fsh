function* g(): Generator<i64> {
  yield 1;
  return 2;
}

function main() {
  const it = g();
}
// error: a generator can't return a value yet; 'return;' ends it
