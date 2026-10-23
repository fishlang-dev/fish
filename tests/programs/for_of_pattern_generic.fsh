// expect: a1
// expect: b2
// A loop pattern in a generic body, checked again for each instance.
function show<T>(xs: [string, T][]) {
  for (const [k, v] of xs) console.log(k);
}
function main() {
  const a: [string, i64][] = [["a" + 1, 1]];
  const b: [string, boolean][] = [["b" + 2, true]];
  show(a);
  show(b);
}
