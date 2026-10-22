// expect: 32 3 3
async function work(sem: shared<{ gate: Semaphore; inside: Atomic<i64>; most: Atomic<i64>; done: Atomic<i64> }>, n: i64): Promise<i64> {
  const permit = await sem.gate.acquire();
  const now = sem.inside.add(1) + 1;
  let seen = sem.most.load();
  while (now > seen) {
    const was = sem.most.compareExchange(seen, now);
    if (was === seen) break;
    seen = was;
  }
  await yieldNow();
  await sleep(1);
  sem.inside.sub(1);
  sem.done.add(1);
  return n;
}

async function main() {
  const state = shared({ gate: new Semaphore(3), inside: new Atomic(0), most: new Atomic(0), done: new Atomic(0) });
  let handles: JoinHandle<i64>[] = [];
  for (let n = 0; n < 32; n++) handles.push(spawn(work(state.clone(), n)));
  for (let n = 0; n < 32; n++) {
    const h = handles.pop()!;
    await h;
  }
  console.log(state.done.load(), state.most.load(), state.gate.available());
}
