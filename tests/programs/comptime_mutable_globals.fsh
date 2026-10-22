// expect: 8000 9 true
// A top-level const holding an Atomic or a Lock is a global the program changes, from any thread.
const HITS = new Atomic(0);
const NAMES = new Lock(["a"]);
const FLAG = new Atomic(false);
async function work(): Promise<i64> {
  for (let i = 0; i < 1000; i++) HITS.add(1);
  NAMES.update((names) => { names.push("x"); });
  return 0;
}
async function main(): Promise<void> {
  let hs: JoinHandle<i64>[] = [];
  for (let i = 0; i < 8; i++) hs.push(spawn(work()));
  while (hs.length > 0) { const h = hs.pop()!; const r = await h; }
  FLAG.store(true);
  const count = NAMES.update((names) => names.length as i64);
  console.log(HITS.load(), count, FLAG.load());
}
