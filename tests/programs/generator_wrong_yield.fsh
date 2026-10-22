function* g(): Generator<i64> {
  yield "a";
}

function main() {
  const it = g();
}
// error: type '"a"' is not assignable to the generator's 'Generator<i64>'
