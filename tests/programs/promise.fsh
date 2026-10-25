// case: promise_array_literal
// expect: xa yb
async function slow(s: string): Promise<string> {
  await sleep(1);
  return s + "a";
}

async function inner(s: string): Promise<string> {
  await yieldNow();
  return s + "b";
}

async function main() {
  let arr: Promise<string>[] = [slow("x" + ""), inner("y" + "")];
  const b = arr.pop()!;
  const a = arr.pop()!;
  const x = await a;
  const y = await b;
  console.log(x, y);
}
// case: promise_stored
// expect: 2 hello 30
// expect: 6
async function two(): Promise<i64> {
  await yieldNow();
  return 2;
}

async function triple(n: i64): Promise<i64> {
  await sleep(1);
  return n * 3;
}

async function word(s: string): Promise<string> {
  await yieldNow();
  return s + "llo";
}

function later(n: i64): Promise<i64> {
  return triple(n);
}

class Job {
  run: Promise<i64>;
  constructor(run: Promise<i64>) {
    this.run = run;
  }
}

async function main() {
  let ps: Promise<i64>[] = [];
  ps.push(two());
  ps.push(later(10));
  ps.push(triple(2));
  const w: Promise<string> = word("he" + "");
  const unused: Promise<i64> = triple(5);
  const last = ps.pop()!;
  const mid = ps.pop()!;
  const first = ps.pop()!;
  const x = await first;
  const y = await w;
  const z = await mid;
  console.log(x, y, z);
  const job = new Job(last);
  const r = await job.run;
  console.log(r);
}
// case: promise_stored_borrows
// error: a stored 'Promise<i64>' may be awaited on any thread, so its future can't hold a 'Ref<string>'
async function size(s: Ref<string>): Promise<i64> {
  return s.length as i64;
}

async function main() {
  const s = "abc" + "";
  const p: Promise<i64> = size(s);
  const n = await p;
}
// case: promise_stored_sleep
// error: store the async function's call instead
async function main() {
  const p: Promise<void> = sleep(5);
}
// case: promise_stored_throws
// error: a stored 'Promise<i64>' can't throw yet, and this one can throw 'string'
async function risky(): Promise<i64> throws string {
  throw "no";
}

async function main() {
  const p: Promise<i64> = risky();
}
// case: promise_all_together
// expect: 1 2 x! true
// expect: done
async function after(ms: i64, v: i64): Promise<i64> {
  await sleep(ms);
  return v;
}
async function label(s: Ref<string>): Promise<string> {
  await yieldNow();
  return s + "!";
}
async function main() {
  const start = Date.now();
  const name: string = "x";
  const [a, b, c] = await Promise.all([after(100, 1), after(100, 2), label(name)]);
  console.log(a, b, c, Date.now() - start < 180);
  const [x, y] = await Promise.all([yieldNow(), sleep(5)]);
  console.log(x === null && y === null ? "done" : "?");
}
// case: promise_all_first_error
// expect: boom
// expect: after
class Boom {
  message: string;
  constructor(m: string) { this.message = m; }
}
async function fail(ms: i64): Promise<i64> throws Boom {
  await sleep(ms);
  throw new Boom("boom");
}
async function slow(): Promise<i64> {
  await sleep(200);
  console.log("never");
  return 1;
}
async function main() {
  try {
    const [a, b] = await Promise.all([slow(), fail(20)]);
    console.log(a, b);
  } catch (e) {
    console.log(e.message);
  }
  await sleep(300);
  console.log("after");
}
// case: promise_all_handles
// expect: 3 true
async function work(ms: i64, v: i64): Promise<i64> {
  await sleep(ms);
  return v;
}
async function main() {
  const start = Date.now();
  const [a, b] = await Promise.all([spawn(work(100, 1)), spawn(work(100, 2))]);
  console.log(a + b, Date.now() - start < 180);
}
// case: promise_race_first
// expect: 2
// expect: true
async function after(ms: i64, v: i64): Promise<i64> {
  await sleep(ms);
  return v;
}
async function main() {
  const r = await Promise.race([after(200, 1), after(20, 2)]);
  console.log(r);
  const timed = await Promise.race([after(300, 5), sleep(20)]);
  console.log(timed === null);
}
// case: promise_race_receive_cancelled
// expect: timed out
// expect: listener got 7
async function listener(ch: Channel<i64>): Promise<i64> {
  const v = await ch.receive();
  return v!;
}
async function waiting(ch: Ref<Channel<i64>>): Promise<i64> {
  const v = await ch.receive();
  return v!;
}
async function main() {
  const ch = new Channel<i64>(1);
  const r = await Promise.race([ch.receive(), sleep(30)]);
  if (r === null) console.log("timed out");
  const r2 = await Promise.race([waiting(ch), sleep(30)]);
  const t = spawn(listener(ch.clone()));
  await sleep(20);
  await ch.send(7);
  const got = await t;
  console.log("listener got", got);
}
// case: promise_race_acquire_cancelled
// expect: other went in
async function other(g: shared<{ gate: Semaphore }>): Promise<i64> {
  const p = await g.gate.acquire();
  console.log("other went in");
  return 0;
}
// Holds the gate's one permit while a race for another times out and another task queues.
async function contend(g: shared<{ gate: Semaphore }>): Promise<JoinHandle<i64>> {
  const held = await g.gate.acquire();
  const r = await Promise.race([g.gate.acquire(), sleep(30)]);
  const t = spawn(other(g.clone()));
  await sleep(20);
  return t;
}
async function main() {
  const g = shared({ gate: new Semaphore(1) });
  const t = await contend(g.clone());
  await t;
}
// case: promise_race_sibling_sleep
// expect: 1 true
async function after(ms: i64, v: i64): Promise<i64> {
  await sleep(ms);
  return v;
}
async function quick(): Promise<i64> {
  const r = await Promise.race([after(10, 1), sleep(50)]);
  return 1;
}
async function main() {
  const start = Date.now();
  const [a, b] = await Promise.all([quick(), sleep(150)]);
  console.log(a, Date.now() - start < 1000);
}
// case: promise_all_not_awaited
// error: 'Promise.all' is awaited where it is called, as in 'await Promise.all([a(), b()])'
async function f(): Promise<i64> { return 1; }
async function main() {
  const p = Promise.all([f()]);
}
// case: promise_all_not_a_list
// error: 'Promise.all' takes an array of Promises written in the call
async function f(): Promise<i64> { return 1; }
async function main() {
  const r = await Promise.all(f());
}
// case: promise_race_empty
// error: 'Promise.race' needs a Promise to wait for; an empty race never settles
async function main() {
  const r = await Promise.race([]);
}
// case: promise_all_not_a_promise
// error: 'Promise.all' takes Promises, like an async function's call, not 'i64'
async function main() {
  const r = await Promise.all([1]);
}
// case: promise_all_borrow_conflict
// error: borrow
async function read(x: Ref<i64[]>): Promise<i64> { return x.length as i64; }
async function grow(x: Mut<i64[]>): Promise<i64> { x.push(1); return 0; }
async function main() {
  let xs = [1];
  const [a, b] = await Promise.all([read(xs), grow(xs)]);
}
