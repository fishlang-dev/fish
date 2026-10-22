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
// error: 'yield' inside 'finally' blocks are not supported yet
