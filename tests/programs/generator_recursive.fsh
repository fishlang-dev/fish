function* a(n: i64): Generator<i64> {
  if (n > 0) for (const x of a(n - 1)) yield x;
  yield n;
}
function main() {
  for (const x of a(3)) console.log(x);
}
// error: a generator can't make another of itself
