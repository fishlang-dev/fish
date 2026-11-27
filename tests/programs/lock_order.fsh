// case: lock_order_inverted
// panic: lock order inversion: this takes the lock made at lock_order_inverted.fsh:5:13 while holding the lock made at lock_order_inverted.fsh:6:13, taken at lock_order_inverted.fsh:12:3, but before the lock made at lock_order_inverted.fsh:5:13 was held, taken at lock_order_inverted.fsh:8:3, while the lock made at lock_order_inverted.fsh:6:13 was taken at lock_order_inverted.fsh:9:5; two tasks taking them in these orders at once would wait on each other forever
// expect: first order 3
// Taking two locks in one order and later the other panics, though nothing deadlocked.
function main() {
  const a = new Lock(1);
  const b = new Lock(2);
  let total = 0;
  a.update((x) => {
    b.update((y) => { total = x + y; });
  });
  console.log("first order", total);
  b.update((y) => {
    a.update((x) => { total = x * y; });
  });
  console.log("unreached");
}
// case: lock_order_consistent
// expect: 3
// expect: 5
// The same order every time is fine, and so is a lock taken alone in between.
function main() {
  const a = new Lock(1);
  const b = new Lock(2);
  let total = 0;
  a.update((x) => {
    b.update((y) => { total = x + y; });
  });
  console.log(total);
  b.update((y) => { y += 1; });
  a.update((x) => {
    b.update((y) => { total = x * 2 + y; });
  });
  console.log(total);
}
// case: lock_order_release
// mode: release
// expect: 3
// expect: 2
// A release build compiles no checking, so the inversion runs.
function main() {
  const a = new Lock(1);
  const b = new Lock(2);
  let total = 0;
  a.update((x) => {
    b.update((y) => { total = x + y; });
  });
  console.log(total);
  b.update((y) => {
    a.update((x) => { total = x * y; });
  });
  console.log(total);
}
// case: lock_order_chain
// panic: lock order inversion: this takes the lock made at lock_order_chain.fsh:4:13 while holding the lock made at lock_order_chain.fsh:6:13
// A cycle through a third lock is found too: a before b, b before c, then c before a.
function main() {
  const a = new Lock(0);
  const b = new Lock(0);
  const c = new Lock(0);
  a.update((x) => { b.update((y) => { y += x; }); });
  b.update((y) => { c.update((z) => { z += y; }); });
  c.update((z) => { a.update((x) => { x += z; }); });
}
// case: lock_order_shared
// panic: lock order inversion: this takes the lock made at lock_order_shared.fsh:6:16 while holding the lock made at lock_order_shared.fsh:7:14
// Shared values' locks are checked across tasks: one task takes from's then to's, the next
// to's then from's, as two transfers between the same accounts in opposite directions would.
type Account = { balance: i64 };
async function main() {
  const from = shared<Account>({ balance: 100 });
  const to = shared<Account>({ balance: 0 });
  const one = spawn(transfer(from.clone(), to.clone(), 10));
  await one;
  const two = spawn(transfer(to.clone(), from.clone(), 5));
  await two;
}
async function transfer(source: shared<Account>, target: shared<Account>, amount: i64): Promise<void> {
  source.update((s) => {
    target.update((t) => {
      s.balance -= amount;
      t.balance += amount;
    });
  });
}
// case: lock_order_deadlock
// panic: lock order inversion: this takes the lock made at lock_order_deadlock.fsh:
// Two tasks on two threads each holding the lock the other is taking would wait forever; the
// second to try is told instead, the lock it waits on known by where its word is.
type Pair = { a: Lock<i64>; b: Lock<i64>; inA: Atomic<i64>; inB: Atomic<i64> };
async function main() {
  const p = shared<Pair>({ a: new Lock(1), b: new Lock(2), inA: new Atomic(0), inB: new Atomic(0) });
  const one = spawn(first(p.clone()));
  const two = spawn(second(p.clone()));
  await one;
  await two;
}
async function first(p: shared<Pair>): Promise<void> {
  p.a.update((x) => {
    p.inA.store(1);
    while (p.inB.load() === 0) {}
    p.b.update((y) => { y += x; });
  });
}
async function second(p: shared<Pair>): Promise<void> {
  p.b.update((y) => {
    p.inB.store(1);
    while (p.inA.load() === 0) {}
    p.a.update((x) => { x += y; });
  });
}
