async function* g(): Generator<i64> {
  yield 1;
}

function main() {}
// error: async generators are not supported yet
