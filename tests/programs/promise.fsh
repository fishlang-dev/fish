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
// error: 'Promise.all' takes an array of Promises, as in 'Promise.all([a(), b()])' or a 'Promise<T>[]', not 'Promise<i64>'
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
// case: promise_all_array
// expect: [ 10, 20, 30, 40 ] true
// expect: 7
async function after(ms: i64, v: i64): Promise<i64> {
  await sleep(ms);
  return v;
}
async function main() {
  let ps: Promise<i64>[] = [];
  for (let i = 1; i <= 4; i++) ps.push(after(120 - 20 * i, 10 * i));
  const start = Date.now();
  const all = await Promise.all(ps);
  console.log(all, Date.now() - start < 200);
  let qs: Promise<i64>[] = [];
  qs.push(after(300, 1));
  qs.push(after(10, 7));
  const first = await Promise.race(qs);
  console.log(first);
}
// case: promise_race_array_cancelled
// expect: listener got 5
// expect: 0
async function waiting(ch: Channel<i64>): Promise<i64> {
  const v = await ch.receive();
  return v!;
}
async function after(ms: i64, v: i64): Promise<i64> {
  await sleep(ms);
  return v;
}
async function main() {
  const ch = new Channel<i64>(1);
  let ps: Promise<i64>[] = [];
  ps.push(waiting(ch.clone()));
  ps.push(after(20, 0));
  const r = await Promise.race(ps);
  const t = spawn(waiting(ch.clone()));
  await sleep(20);
  await ch.send(5);
  const got = await t;
  console.log("listener got", got);
  const empty: Promise<i64>[] = [];
  const none = await Promise.all(empty);
  console.log(none.length);
}
// case: promise_all_mixed_boxed
// expect: 1 2
async function after(ms: i64, v: i64): Promise<i64> {
  await sleep(ms);
  return v;
}
async function main() {
  const p: Promise<i64> = after(10, 1);
  const [a, b] = await Promise.all([p, after(5, 2)]);
  console.log(a, b);
}
// case: promise_all_wrong_array
// error: 'Promise.all' takes an array of Promises, as in 'Promise.all([a(), b()])' or a 'Promise<T>[]', not 'i64[]'
async function main() {
  const xs = [1, 2];
  const r = await Promise.all(xs);
}
// case: promise_all_yield_alone
// expect: done true
async function main() {
  const [x] = await Promise.all([yieldNow()]);
  console.log("done", x === null);
}
// case: promise_void_array
// expect: tick 10
// expect: tick 20
// expect: all done 2
// expect: tick 5
// expect: race done
async function tick(ms: i64): Promise<void> {
  await sleep(ms);
  console.log("tick", ms);
}
async function main() {
  let ps: Promise<void>[] = [];
  ps.push(tick(20));
  ps.push(tick(10));
  const all = await Promise.all(ps);
  console.log("all done", all.length);
  let qs: Promise<void>[] = [];
  qs.push(tick(30));
  qs.push(tick(5));
  await Promise.race(qs);
  console.log("race done");
}
// case: promise_wait_same_channel
// expect: 9 1 true
async function sender(ch: Channel<i64>): Promise<i64> {
  await sleep(100);
  await ch.send(1);
  return 0;
}
async function timed(ch: Ref<Channel<i64>>): Promise<i64> {
  const r = await Promise.race([ch.receive(), sleep(20)]);
  return 9;
}
async function main() {
  const ch = new Channel<i64>(1);
  const t = spawn(sender(ch.clone()));
  const start = Date.now();
  const [a, b] = await Promise.all([ch.receive(), timed(ch)]);
  console.log(b, a!, Date.now() - start < 1000);
  await t;
}
// case: promise_wait_same_semaphore
// expect: 9 true
async function holder(g: shared<{ gate: Semaphore }>): Promise<i64> {
  const p = await g.gate.acquire();
  await sleep(100);
  return 0;
}
async function timed(g: Ref<shared<{ gate: Semaphore }>>): Promise<i64> {
  const r = await Promise.race([g.gate.acquire(), sleep(20)]);
  return 9;
}
async function main() {
  const g = shared({ gate: new Semaphore(1) });
  const t = spawn(holder(g.clone()));
  await sleep(10);
  const start = Date.now();
  const [p, a] = await Promise.all([g.gate.acquire(), timed(g)]);
  console.log(a, Date.now() - start < 1000);
  await t;
}
// case: promise_wait_same_signal
// expect: aborted true
async function main() {
  const c = new AbortController();
  const s = c.signal;
  const t = spawn(abortLater(c));
  const start = Date.now();
  try {
    const [a, b] = await Promise.all([sleep(10, s), sleep(3000, s)]);
    console.log("no abort");
  } catch (e) {
    console.log("aborted", Date.now() - start < 1000);
  }
  await t;
}
async function abortLater(c: AbortController): Promise<i64> {
  await sleep(100);
  c.abort();
  return 0;
}
// case: promise_aborted_sleep_keeps_sibling
// expect: f aborted
// expect: done 1 true
async function f(s: AbortSignal): Promise<i64> {
  try {
    await sleep(10, s);
  } catch (e) {
    console.log("f aborted");
  }
  return 1;
}
async function main() {
  const c = new AbortController();
  c.abort();
  const start = Date.now();
  const [a, b] = await Promise.all([sleep(100), f(c.signal)]);
  console.log("done", b, Date.now() - start < 1000);
}
// case: promise_all_nested
// error: 'Promise.all' can't be in another Promise's list; give it an async function of its own
async function f(): Promise<i64> { return 1; }
async function main() {
  const [a, b] = await Promise.all([Promise.all([f()]), f()]);
}
// case: promise_race_stale_wait
// expect: race got 1
// expect: other got 2 true
async function late(ch: Ref<Channel<i64>>): Promise<i64> {
  await sleep(10);
  const v = await ch.receive();
  return v!;
}
async function other(ch: Channel<i64>): Promise<i64> {
  const v = await ch.receive();
  return v!;
}
async function feeder(ch: Channel<i64>): Promise<i64> {
  await sleep(30);
  await ch.send(1);
  await sleep(50);
  await ch.send(2);
  return 0;
}
async function main() {
  const ch = new Channel<i64>(1);
  const f = spawn(feeder(ch.clone()));
  // ch.receive() waits from the start; late's receive joins at 10 ms, behind it.
  const r = await Promise.race([late(ch), ch.receive()]);
  console.log("race got", r);
  const t = spawn(other(ch.clone()));
  const start = Date.now();
  const got = await t;
  console.log("other got", got, Date.now() - start < 1000);
  await f;
}
// case: promise_race_stale_send
// expect: race done
// expect: sum 320 true
async function lateSend(ch: Ref<Channel<i64>>): Promise<i64> {
  await sleep(10);
  await ch.send(20);
  return 1;
}
async function drainer(ch: Channel<i64>): Promise<i64> {
  await sleep(30);
  const a = await ch.receive();
  await sleep(50);
  const b = await ch.receive();
  await sleep(20);
  const c = await ch.receive();
  return a! + b! + c!;
}
async function otherSend(ch: Channel<i64>): Promise<i64> {
  await ch.send(300);
  
  return 0;
}
async function main() {
  const ch = new Channel<i64>(1);
  await ch.send(0);
  const d = spawn(drainer(ch.clone()));
  // ch.send(10) queues first; lateSend's send joins at 10 ms behind it.
  const r = await Promise.race([lateSend(ch), ch.send(10)]);
  console.log("race done");
  const o = spawn(otherSend(ch.clone()));
  const start = Date.now();
  await o;
  const sum = await d;
  console.log("sum", sum, Date.now() - start < 1000);
}
// case: promise_all_settled_and_any
// expect: fulfilled 1 fulfilled
// expect: b x
// expect: { status: 'fulfilled', value: 1 }
// expect: any 7
// expect: All promises were rejected 2 a b
// expect: 2 3 fulfilled
// expect: empty All promises were rejected 0
class Boom {
  message: string;
  constructor(m: string) { this.message = m; }
}
async function after(ms: i64, v: i64): Promise<i64> {
  await sleep(ms);
  return v;
}
async function fail(ms: i64, m: string): Promise<i64> throws Boom {
  await sleep(ms);
  throw new Boom(m);
}
async function tick(): Promise<void> {
  await sleep(5);
}
async function main() {
  const [a, b, c] = await Promise.allSettled([after(20, 1), fail(10, "x"), tick()]);
  console.log(a.status, a.value, c.status);
  if (b.status === "rejected") console.log("b", b.reason.message);
  console.log(a);
  const first = await Promise.any([fail(5, "early"), after(30, 7), after(60, 8)]);
  console.log("any", first);
  try {
    const none = await Promise.any([fail(5, "a"), fail(15, "b")]);
    console.log(none);
  } catch (e) {
    console.log(e.message, e.errors.length, e.errors[0].message, e.errors[1].message);
  }
  let ps: Promise<i64>[] = [];
  ps.push(after(10, 3));
  ps.push(after(5, 4));
  const outcomes = await Promise.allSettled(ps);
  console.log(outcomes.length, outcomes[0].value, outcomes[1].status);
  const empty: Promise<i64>[] = [];
  try {
    const one = await Promise.any(empty);
    console.log(one);
  } catch (e) {
    console.log("empty", e.message, e.errors.length);
  }
}
// case: promise_any_cancels_the_rest
// expect: listener got 3
async function after(ms: i64, v: i64): Promise<i64> {
  await sleep(ms);
  return v;
}
async function listener(ch: Channel<i64>): Promise<i64> {
  const v = await ch.receive();
  return v!;
}
async function main() {
  const ch = new Channel<i64>(1);
  const r = await Promise.any([ch.receive(), after(20, 1)]);
  const t = spawn(listener(ch.clone()));
  await sleep(20);
  await ch.send(3);
  const got = await t;
  console.log("listener got", got);
}
// case: promise_any_never_fails
// expect: 2
async function after(ms: i64, v: i64): Promise<i64> {
  await sleep(ms);
  return v;
}
async function main() {
  const r = await Promise.any([after(30, 1), after(5, 2)]);
  console.log(r);
}
// case: promise_settled_status_narrows
// error: this comparison appears to be unintentional
async function after(ms: i64): Promise<i64> {
  await sleep(ms);
  return ms;
}
async function main() {
  const [a] = await Promise.allSettled([after(5)]);
  if (a.status === "rejected") console.log("never");
}
// case: promise_any_empty_list
// error: 'Promise.any' needs a Promise to wait for
async function main() {
  const r = await Promise.any([]);
}
// case: promise_any_instanceof
// expect: agg [ 'a?', 'b?' ]
class Boom {
  message: string;
  constructor(m: string) { this.message = m; }
}
async function fail(ms: i64, m: string): Promise<string> throws Boom {
  await sleep(ms);
  throw new Boom(m + "?");
}
async function both(): Promise<void> throws AggregateError<Boom> | Boom {
  const s = await Promise.any([fail(2, "a"), fail(1, "b")]);
  const t = await fail(1, "c");
}
async function main() {
  try {
    await both();
  } catch (e) {
    if (e instanceof AggregateError) console.log("agg", e.errors.map((x) => x.message));
    else console.log("boom", e.message);
  }
}
