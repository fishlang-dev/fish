// case: semaphore_clone
// error: can't clone a 'Semaphore' or a 'Permit'
function main() {
  const s = new Semaphore(2);
  const t = s.clone();
}
// case: semaphore_limits
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
// case: semaphore_negative
// panic: a semaphore's number of slots can't be negative
function main() {
  const n = -3;
  const sem = new Semaphore(n);
}
// case: semaphore_permit_copied
// expect: 0 0
// expect: 1
class Holder {
  #p: Permit | null;
  constructor() {
    this.#p = null;
  }
  set p(v: Permit | null) {
    this.#p = v;
  }
}

async function main() {
  const sem = new Semaphore(1);
  const a = await sem.acquire();
  const s = shared({ p: a });
  if (true) {
    const q = s.p;
  }
  const after = sem.available();
  let h = new Holder();
  const b = shared({ inner: { n: 1 } });
  console.log(after, sem.available());
  const sem2 = new Semaphore(1);
  const c = await sem2.acquire();
  h.p = c;
  console.log(sem2.available() + 1);
}
// case: semaphore_permit_scope
// expect: 2 1 2
// expect: 0
async function main() {
  const sem = new Semaphore(2);
  const before = sem.available();
  {
    const permit = await sem.acquire();
    const during = sem.available();
    console.log(before, during, before);
  }
  const p1 = await sem.acquire();
  const p2 = await sem.acquire();
  console.log(sem.available());
}
// case: semaphore_waiting_at_exit
// expect: holding
// expect: main done
async function hold(sem: shared<{ gate: Semaphore }>): Promise<i64> {
  const permit = await sem.gate.acquire();
  console.log("holding");
  await sleep(100000);
  return 1;
}

async function wait(sem: shared<{ gate: Semaphore }>): Promise<i64> {
  await sleep(20);
  const permit = await sem.gate.acquire();
  console.log("never");
  return 2;
}

async function main() {
  const state = shared({ gate: new Semaphore(1) });
  const a = spawn(hold(state.clone()));
  const b = spawn(wait(state.clone()));
  await sleep(60);
  console.log("main done");
}
