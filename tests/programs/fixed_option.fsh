// expect: a1 b2
// expect: true
// A fixed array literal where an Option of one is expected.
function f(b: boolean): FixedArray<string, 2> | null {
  if (b) return ["a" + 1, "b" + 2];
  return null;
}
function main() {
  const x = f(true);
  if (x !== null) console.log(x[0], x[1]);
  const y = f(false);
  console.log(y === null);
}
