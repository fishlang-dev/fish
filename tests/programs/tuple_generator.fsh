// expect: 1 a1
// expect: 2 b2
// A generator of tuples gives each as a tuple.
function* pairs(): Generator<[i64, string]> {
  yield [1, "a" + 1];
  const t: [i64, string] = [2, "b" + 2];
  yield t;
}
function main() {
  for (const p of pairs()) console.log(p[0], p[1]);
}
