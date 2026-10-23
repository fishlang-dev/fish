// expect: a1 2
// expect: b 3
// expect: 1
// A let pattern's parts may change, as their own copies.
function main() {
  const xs: [string, i64][] = [["a" + 1, 1], ["b", 2]];
  for (let [k, v] of xs) {
    v = v + 1;
    console.log(k, v);
  }
  console.log(xs[0][1]);
}
