// expect: v4 v5 l1
// expect: 9
// An async function giving a tuple.
async function get(n: i64): Promise<[i64, string]> { return [n, "v" + n]; }
async function run(): Promise<i64> {
  const t = await get(4);
  const [n, s] = await get(5);
  const local: [string, i64] = ["l" + 1, 1];
  await get(6);
  console.log(t[1], s, local[0]);
  return t[0] + n;
}
async function main() { const r = await run(); console.log(r); }
