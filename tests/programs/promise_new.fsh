// case: promise_new_settles
// expect: 5
// expect: no
// expect: x
// expect: void
// A second settle is ignored, its value dropped.
async function main(): Promise<void> throws Error {
  const a = await new Promise<i64>((resolve, reject) => { resolve(5); });
  console.log(a);
  try {
    await new Promise<string>((resolve, reject) => { reject(new Error("no")); resolve("late"); });
  } catch (e) {
    console.log(e.message);
  }
  const p = new Promise<string>((resolve) => { resolve("x"); resolve("y"); });
  const v = await p;
  console.log(v);
  await new Promise<void>((resolve) => { resolve(); });
  console.log("void");
}
// case: promise_new_later
// expect: delayed
// expect: 42
// expect: sleep won
// A resolve kept and called later wakes the awaiting task; one never called waits forever.
function delay(ms: i64, v: string): Promise<string> {
  return new Promise((resolve) => { resolve(v); });
}
async function later(resolve: (value: i64) => void): Promise<void> {
  await sleep(10);
  resolve(42);
}
async function main(): Promise<void> {
  const s = await delay(5, "delayed");
  console.log(s);
  let saved: ((value: i64) => void) | null = null;
  const p = new Promise<i64>((resolve) => { saved = resolve; });
  const r = saved;
  if (r !== null) {
    const both = await Promise.all([p, later(r)]);
    console.log(both[0]);
  }
  const never = new Promise<string>((resolve) => {});
  const won = await Promise.race([never, delay(1, "sleep won")]);
  console.log(won);
}
// case: promise_new_executors
// expect: 3 4 one 2
// expect: bad
function ex(resolve: (value: i64) => void): void { resolve(3); }
async function main(): Promise<void> throws Error {
  const a = await new Promise<i64>(ex);
  const run = (resolve: (value: i64) => void, reject: (reason: Error) => void) => { resolve(4); };
  const b = await new Promise<i64>(run);
  const all = await Promise.all([new Promise<string>((resolve) => { resolve("one"); }), new Promise<i64>((resolve, reject) => { resolve(2); })]);
  console.log(a, b, all[0], all[1]);
  const settled = await Promise.allSettled([new Promise<i64>((resolve, reject) => { reject(new Error("bad")); })]);
  const s0 = settled[0];
  if (s0.status === "rejected") console.log(s0.reason.message);
}
// case: promise_new_enclosing_throws
// expect: nf
// Reject takes what the function declares it throws.
class NotFound { message = "nf"; }
async function f(): Promise<i64> throws NotFound { return await new Promise<i64>((res, rej) => { rej(new NotFound()); }); }
async function main() { try { const a = await f(); } catch (e) { console.log(e.message); } }
// case: promise_new_stored_reject
// error: a Promise stored as a 'Promise<i64>' can't throw yet, so its executor can't take 'reject'
function load(): Promise<i64> { return new Promise((resolve, reject) => { resolve(1); }); }
function main() {}
// case: promise_new_no_type
// error: can't tell what this Promise gives; write it, as in 'new Promise<i64>((resolve, reject) => resolve(1))'
async function main() { const x = await new Promise((resolve) => { resolve(1); }); }
// case: promise_new_not_function
// error: 'new Promise' takes an executor, a function given 'resolve' and 'reject'
async function main() { const x = await new Promise<i64>(5); }
// case: promise_new_reject_annotation
// error: 'g' must declare 'throws NotFound' after its return type since this Promise can throw 'NotFound'
class NotFound { message = "nf"; }
async function g(): Promise<i64> { return await new Promise<i64>((res, rej: (e: NotFound) => void) => { rej(new NotFound()); }); }
async function main() {}
// case: promise_new_reject_not_function
// error: 'reject' takes the error it fails with, as in 'reject: (reason: Error) => void', not 'string'
async function main() { const x = await new Promise<i64>((res, rej: string) => { res(1); }); }
// case: promise_new_resolve_type
// error: argument of type '"s"' is not assignable to parameter of type 'i64'
async function main() { const x = await new Promise<i64>((res) => { res("s"); }); }
