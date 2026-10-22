function* g(): Generator<i64> {
  yield 1;
}

function* h(): Generator<i64> {
  yield 2;
}

function main() {
  const c = true;
  const it = c ? g() : h();
}
// error: unions holding generators are not supported yet
