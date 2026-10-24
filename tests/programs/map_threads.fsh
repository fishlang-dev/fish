// expect: 0
// Maps made at once on many worker threads all hash with one seed.
async function work(n: i64): Promise<i64> {
  let m = new Map<i64, i64>();
  for (let i = 0; i < 64; i++) m.set(i * 1000 + n, i);
  await yieldNow();
  let lost = 0;
  for (let i = 0; i < 64; i++) if (!m.has(i * 1000 + n)) lost++;
  return lost;
}
async function main() {
  let hs: JoinHandle<i64>[] = [];
  for (let n = 0; n < 16; n++) hs.push(spawn(work(n)));
  let lost = 0;
  while (hs.length > 0) { const h = hs.pop()!; const l = await h; lost += l; }
  console.log(lost);
}
