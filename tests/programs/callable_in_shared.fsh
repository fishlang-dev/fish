// expect: 800
type Hooks = { scale: (n: i64) => i64; hits: Atomic<i64> };

async function work(h: shared<Hooks>): Promise<i64> {
  for (let i = 0; i < 100; i++) {
    h.hits.add(h.scale(1));
    await yieldNow();
  }
  return 0;
}

async function main() {
  const hooks = shared<Hooks>({ scale: (n) => n, hits: new Atomic(0) });
  let tasks: JoinHandle<i64>[] = [];
  for (let k = 0; k < 8; k++) tasks.push(spawn(work(hooks.clone())));
  for (let k = 0; k < 8; k++) {
    const t = tasks.pop()!;
    await t;
  }
  console.log(hooks.hits.load());
}
