// case: abort_clone
// expect: false false
// expect: true true
function main() {
  const c = new AbortController();
  const a = c.signal;
  const b = a.clone();
  const d = c.clone();
  console.log(a.aborted, b.aborted);
  d.abort();
  c.abort();
  console.log(a.aborted, b.aborted);
}
// case: abort_duplicate_wake
// expect: aborted
// expect: main got 1
// expect: second got 2
async function aborter(c: AbortController): Promise<i64> {
  await sleep(10);
  c.abort();
  return 0;
}
async function second(ch: Channel<i64>): Promise<i64> {
  await sleep(150);
  const v = await ch.receive();
  return v!;
}
async function sender(ch: Channel<i64>): Promise<i64> {
  await sleep(200);
  await ch.send(1);
  await ch.send(2);
  return 0;
}
async function main() {
  const c = new AbortController();
  const s = c.signal;
  const a = spawn(aborter(c));
  try {
    await sleep(100, s);
  } catch (e) {
    console.log("aborted");
  }
  await a;
  const ch = new Channel<i64>(2);
  const w = spawn(second(ch.clone()));
  const t = spawn(sender(ch.clone()));
  const v = await ch.receive();
  console.log("main got", v!);
  const r = await w;
  console.log("second got", r);
  await t;
}
// case: abort_no_property
// error: property 'reason' does not exist on type 'AbortSignal'
function main() {
  const c = new AbortController();
  const r = c.signal.reason;
}
// case: abort_read_only
// error: 'aborted' is read-only: the runtime keeps it
function main() {
  let c = new AbortController();
  let s = c.signal;
  s.aborted = true;
}
// case: abort_shadowed_error
// error: which isn't the 'AbortError' that 'f' throws
function f<AbortError>(s: Ref<AbortSignal>, x: AbortError): i64 throws AbortError {
  s.throwIfAborted();
  return 1;
}
function main() {
  const c = new AbortController();
  c.abort();
  try {
    const v = f(c.signal, 5);
    console.log(v);
  } catch (e) {
    console.log("caught", e);
  }
}
// case: abort_stress
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
// case: abort_throw_if_aborted
// expect: false
// expect: stopped This operation was aborted
// expect: true
// expect: wrapped This operation was aborted
async function work(signal: AbortSignal): Promise<i64> throws AbortError {
  let n = 0;
  while (true) {
    signal.throwIfAborted();
    n++;
    await yieldNow();
  }
  return n;
}

class ApiError implements From<AbortError> {
  why: string;
  constructor(why: string) {
    this.why = why;
  }
  static from(e: AbortError): ApiError {
    return new ApiError("wrapped " + e.message);
  }
}

function check(signal: Ref<AbortSignal>): i64 throws ApiError {
  signal.throwIfAborted();
  return 1;
}

async function main() {
  const c = new AbortController();
  console.log(c.signal.aborted);
  const h = spawn(work(c.signal));
  await sleep(10);
  c.abort();
  try {
    const n = await h;
    console.log("finished", n);
  } catch (e) {
    console.log("stopped", e.message);
  }
  const signal = c.signal;
  console.log(signal.aborted);
  try {
    const one = check(signal);
  } catch (e) {
    console.log(e.why);
  }
}
// case: abort_timeout
// expect: timed out
// expect: got hello
// expect: false
async function late(ch: Channel<string>): Promise<i64> {
  await sleep(5);
  await ch.send("hello" + "");
  return 0;
}

async function main() {
  const quiet = new Channel<string>(1);
  try {
    const v = await quiet.receive(AbortSignal.timeout(30));
    console.log("received", v!);
  } catch (e) {
    console.log("timed out");
  }
  const busy = new Channel<string>(1);
  const h = spawn(late(busy.clone()));
  try {
    const v = await busy.receive(AbortSignal.timeout(100000));
    console.log("got", v!);
  } catch (e) {
    console.log("timed out too");
  }
  await h;
  const pending = AbortSignal.timeout(100000);
  console.log(pending.aborted);
}
// case: abort_timeout_sync
// error: 'AbortSignal.timeout' needs the async runtime's timer, which runs when 'main' is an async function
function main() {
  const t = AbortSignal.timeout(1);
  console.log(t.aborted);
}
// case: abort_undeclared
// error: 'step' must declare 'throws AbortError' after its return type since 'throwIfAborted' can throw 'AbortError'
function step(signal: Ref<AbortSignal>): i64 {
  signal.throwIfAborted();
  return 1;
}

function main() {
  const c = new AbortController();
  console.log(step(c.signal));
}
// case: abort_waits
// expect: sleep aborted
// expect: acquire aborted
// expect: receive aborted
// expect: send aborted
// expect: done 7 5
async function sleeper(signal: AbortSignal): Promise<string> throws AbortError {
  await sleep(100000, signal);
  return "slept";
}

async function acquirer(sem: shared<{ gate: Semaphore }>, signal: AbortSignal): Promise<string> throws AbortError {
  const permit = await sem.gate.acquire(signal);
  return "acquired";
}

async function receiver(ch: Channel<string>, signal: AbortSignal): Promise<string> throws AbortError {
  const v = await ch.receive(signal);
  return "received";
}

async function sender(ch: Channel<string>, signal: AbortSignal): Promise<string> throws AbortError {
  await ch.send("one" + "", signal);
  await ch.send("two" + "", signal);
  return "sent";
}

async function main(): Promise<void> throws AbortError {
  const c = new AbortController();
  const gate = shared({ gate: new Semaphore(1) });
  const held = await gate.gate.acquire();
  const empty = new Channel<string>(1);
  const full = new Channel<string>(1);
  const a = spawn(sleeper(c.signal));
  const b = spawn(acquirer(gate.clone(), c.signal));
  const d = spawn(receiver(empty.clone(), c.signal));
  const f = spawn(sender(full.clone(), c.signal));
  await sleep(30);
  c.abort();
  try {
    const v = await a;
  } catch (e) {
    console.log("sleep aborted");
  }
  try {
    const v = await b;
  } catch (e) {
    console.log("acquire aborted");
  }
  try {
    const v = await d;
  } catch (e) {
    console.log("receive aborted");
  }
  try {
    const v = await f;
  } catch (e) {
    console.log("send aborted");
  }
  const other = new AbortController();
  await sleep(5, other.signal);
  const spare = new Semaphore(1);
  const p = await spare.acquire(other.signal);
  const got = await full.receive(other.signal);
  console.log("done", 7, got!.length + 2);
}
