// expect: 40 2
// expect: 400
type Gate = { sem: Semaphore; done: Atomic<i64>; aborted: Atomic<i64> };

async function worker(g: shared<Gate>, signal: AbortSignal): Promise<i64> {
  try {
    const permit = await g.sem.acquire(signal);
    await yieldNow();
    g.done.add(1);
  } catch (e) {
    g.aborted.add(1);
  }
  return 1;
}

async function consumer(ch: Channel<i64>, signal: AbortSignal, total: shared<{ got: Atomic<i64> }>): Promise<i64> {
  try {
    while (true) {
      const v = await ch.receive(signal);
      if (v === null) break;
      total.got.add(1);
    }
  } catch (e) {
    return 1;
  }
  return 0;
}

async function producer(ch: Channel<i64>): Promise<i64> {
  for (let i = 0; i < 400; i++) {
    await ch.send(i);
    if (i % 50 === 0) await yieldNow();
  }
  ch.close();
  return 0;
}

async function main() {
  const g = shared<Gate>({ sem: new Semaphore(2), done: new Atomic(0), aborted: new Atomic(0) });
  let cancellers: AbortController[] = [];
  let workers: JoinHandle<i64>[] = [];
  for (let n = 0; n < 40; n++) {
    const c = new AbortController();
    workers.push(spawn(worker(g.clone(), c.signal)));
    cancellers.push(c);
  }
  for (let n = 0; n < 40; n++) {
    const c = cancellers.pop()!;
    if (n % 2 === 0) c.abort();
  }
  for (let n = 0; n < 40; n++) {
    const h = workers.pop()!;
    await h;
  }
  console.log(g.done.load() + g.aborted.load(), g.sem.available());
  const ch = new Channel<i64>(2);
  const total = shared({ got: new Atomic(0) });
  let quit: AbortController[] = [];
  let consumers: JoinHandle<i64>[] = [];
  for (let n = 0; n < 8; n++) {
    const c = new AbortController();
    consumers.push(spawn(consumer(ch.clone(), c.signal, total.clone())));
    quit.push(c);
  }
  const p = spawn(producer(ch.clone()));
  await sleep(1);
  for (let n = 0; n < 8; n++) {
    const c = quit.pop()!;
    if (n % 2 === 0) c.abort();
  }
  await p;
  for (let n = 0; n < 8; n++) {
    const h = consumers.pop()!;
    await h;
  }
  console.log(total.got.load());
}
