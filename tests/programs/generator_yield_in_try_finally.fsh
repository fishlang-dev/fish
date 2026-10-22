function* g(): Generator<i64> {
  try {
    yield 1;
    yield 2;
  } finally {
    console.log("cleanup");
  }
}
function main() {
  for (const x of g()) {
    console.log(x);
    break;
  }
  console.log("after");
}
// error: 'yield' statements in a 'try' with a 'finally' are not supported yet
