// expect: a1
// expect: b2
// A loop over a shared value's fixed array field in an async function.
type S = { a: FixedArray<string, 2> };
async function main() {
  const s = shared<S>({ a: ["a" + 1, "b" + 2] });
  for (const v of s.a) console.log(v);
}
