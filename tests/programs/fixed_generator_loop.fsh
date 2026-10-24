// expect: a1
// expect: b2
// A loop over a borrowed fixed array in a generator.
function* gen(ps: Ref<FixedArray<string, 2>>): Generator<string> {
  for (const p of ps) yield p;
}
function main() {
  const ps: FixedArray<string, 2> = ["a" + 1, "b" + 2];
  for (const s of gen(ps)) console.log(s);
}
