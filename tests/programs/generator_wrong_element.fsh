function* words(): Generator<string> {
  yield "a";
}

function sum(g: Generator<i64>): i64 {
  let total = 0;
  for (const v of g) total += v;
  return total;
}

function main() {
  console.log(sum(words()));
}
// error: it yields 'string', not 'i64'
