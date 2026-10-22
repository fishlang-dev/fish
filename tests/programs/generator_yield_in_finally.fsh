function* g(): Generator<i64> {
  try {
    yield 1;
  } finally {
    yield 2;
  }
}

function main() {
  const it = g();
}
// error: 'yield' statements in a 'try' with a 'finally' are not supported yet
