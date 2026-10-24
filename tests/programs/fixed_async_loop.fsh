// expect: a1 1
// expect: b2 1
// expect: b2
// expect: 0
// A loop over a borrowed fixed array in an async function, across await.
async function tick(): Promise<i64> { return 1; }
async function work(ps: Ref<FixedArray<string, 2>>): Promise<i64> {
  for (const p of ps) { const k = await tick(); console.log(p, k); }
  console.log(ps[1]);
  return 0;
}
async function main() { const ps: FixedArray<string, 2> = ["a" + 1, "b" + 2]; const w = await work(ps); console.log(w); }
