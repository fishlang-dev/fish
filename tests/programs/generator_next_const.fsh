function* g(): Generator<i64> {
  yield 1;
}

function main() {
  const it = g();
  const r = it.next();
}
// error: cannot advance 'it' because it is a constant
