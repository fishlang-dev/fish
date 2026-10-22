// expect: 2
async function work(n: i64): Promise<i64> {
  const local = shared({ n: 1 });
  await yieldNow();
  return n;
}
async function main() {
  const f = work(1);
  const f2 = f.clone();
  const a = await f;
  const b = await f2;
  console.log(a + b);
}
