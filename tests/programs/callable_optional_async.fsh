// expect: async callback 7
// expect: async callback 30
// An optional async callback field, given as an async arrow.
type Opts = { n: i64; done?: (n: i64) => Promise<i64> };
async function run(o: Opts): Promise<void> {
  const cb = o.done;
  if (cb !== null) {
    const r = await cb(o.n);
    console.log("async callback", r);
  }
}
async function main(): Promise<void> {
  const add = 5;
  await run({ n: 2, done: async (n) => n + add });
  const o: Opts = { n: 3, done: async (n) => n * 10 };
  await run(o);
  await run({ n: 1 });
}
