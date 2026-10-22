function* g(): i64 {
  yield 1;
}

function main() {
  const it = g();
}
// error: a generator function's return type is 'Generator<T>', the type of what it yields
