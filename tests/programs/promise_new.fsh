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
// case: promise_resolve_reject
// expect: 5 str
// expect: rejected
// expect: typed
// expect: 1 two
// expect: 3
// expect: no
async function main(): Promise<void> throws Error {
  const a = await Promise.resolve(5);
  const s = await Promise.resolve<string>("str");
  await Promise.resolve();
  console.log(a, s);
  try {
    await Promise.reject(new Error("rejected"));
  } catch (e) {
    console.log(e.message);
  }
  try {
    const n = await Promise.reject<i64>(new Error("typed"));
    console.log(n);
  } catch (e) {
    console.log(e.message);
  }
  const all = await Promise.all([Promise.resolve(1), Promise.resolve("two")]);
  console.log(all[0], all[1]);
  const settled = await Promise.allSettled([Promise.resolve(3), Promise.reject<i64>(new Error("no"))]);
  const [x, y] = settled;
  if (x.status === "fulfilled") console.log(x.value);
  if (y.status === "rejected") console.log(y.reason.message);
}
// case: promise_reject_nothing
// error: 'Promise.reject' takes the error it throws
async function main() { await Promise.reject(); }
// case: promise_resolve_void_value
// error: a 'Promise<void>' gives nothing, so 'Promise.resolve' takes no value for it
async function main() { await Promise.resolve<void>(1); }
// case: promise_reject_stored
// error: a stored 'Promise<i64>' can't throw yet
function f(): Promise<i64> { return Promise.reject(new Error("x")); }
function main() {}
// case: promise_new_generic
// expect: 5 s
async function wrap<T>(v: T): Promise<T> {
  return await new Promise<T>((resolve) => { resolve(v); });
}
async function main(): Promise<void> {
  const a = await wrap(5);
  const b = await wrap("s");
  console.log(a, b);
}
// case: promise_reject_generic
// expect: str
// expect: 7
async function fail<T>(v: T): Promise<i64> throws T {
  return await Promise.reject(v);
}
async function main(): Promise<void> {
  try { await fail("str"); } catch (e) { console.log(e); }
  try { await fail(7); } catch (e) { console.log(e); }
}
// case: promise_new_generic_reject
// expect: nf
// expect: plain
class NotFound { message = "nf"; }
async function failWith<E>(err: E): Promise<i64> throws E {
  const n = await new Promise<i64>((resolve, reject: (e: E) => void) => { reject(err); });
  return n;
}
async function main(): Promise<void> {
  try { const x = await failWith(new NotFound()); } catch (e) { console.log(e.message); }
  try { const y = await failWith("plain"); } catch (e) { console.log(e); }
}
// case: promise_new_option
// expect: null
async function main(): Promise<void> {
  const a = await new Promise<string | null>((resolve) => { resolve(null); });
  console.log(a);
}
// case: promise_new_parameter
// expect: 5 6
async function use(p: Promise<i64>): Promise<i64> { const v = await p; return v + 1; }
async function main(): Promise<void> {
  const a = await use(new Promise((resolve) => { resolve(4); }));
  const b = await use(Promise.resolve(5));
  console.log(a, b);
}
// case: promise_new_declared_reject
// expect: nf
class NotFound { message = "nf"; }
function ex(resolve: (value: i64) => void, reject: (reason: NotFound) => void): void { reject(new NotFound()); }
async function main(): Promise<void> {
  try { const v = await new Promise<i64>(ex); console.log(v); } catch (e) { console.log(e.message); }
}
// case: promise_new_executor_parameter
// expect: 11
function make(ex: (resolve: (v: i64) => void) => void): Promise<i64> { return new Promise<i64>(ex); }
async function main(): Promise<void> {
  const a = await make((resolve) => { resolve(11); });
  console.log(a);
}
// case: promise_resolve_met
// expect: null 1
function maybe(): Promise<string | null> { return Promise.resolve(null); }
function num(): Promise<f64> { return Promise.resolve(1); }
async function main(): Promise<void> {
  const a = await maybe();
  const b = await num();
  console.log(a, b);
}
// case: promise_new_awaited_as
// expect: 2
async function main(): Promise<void> {
  const x: i64 = await new Promise((resolve) => { resolve(2); });
  console.log(x);
}
// case: promise_new_async_executor
// error: an executor runs at once, so it can't be async
async function main() { const x = await new Promise<i64>(async (resolve) => { resolve(1); }); }
// case: promise_resolve_nested
// error: 'Promise.resolve' of a Promise would hold one Promise inside another
async function main() { const x = await Promise.resolve(Promise.resolve(3)); }
// case: promise_resolve_missing_value
// error: 'Promise.resolve' takes the value it gives, of type 'i64'
async function main() { const x = await Promise.resolve<i64>(); }
// case: generic_callback_given_callbacks
// expect: got 5
// expect: got s
function run<T>(executor: (resolve: (value: T) => void) => void): void { executor((value) => { console.log("got", value); }); }
function wrap<T>(v: T): void { run<T>((resolve) => { resolve(v); }); }
function main() { wrap(5); wrap("s"); }
// case: promise_new_executor_gives_promise
// error: an executor runs at once and what it gives is dropped, so the Promise it gives would never run
async function later(resolve: (value: i64) => void): Promise<void> { await sleep(1); resolve(42); }
async function main(): Promise<void> {
  const v = await new Promise<i64>((resolve) => later(resolve));
  console.log(v);
}
// case: callable_literal_not_base
// error: type '() => "a"' is not assignable to type '() => string'
function main() {
  const f: () => "a" = () => "a";
  const g: () => string = f;
  console.log(g());
}
// case: callable_base_not_literal
// error: type '(d: "a") => void' is not assignable to type '(s: string) => void'
function main() {
  const f: (d: "a") => void = (d) => { console.log("got", d); };
  const g: (s: string) => void = f;
  g("b");
}
// case: promise_with_resolvers
// expect: 1
// expect: failed
// expect: later
// expect: void
// expect: 5 s
// The first settle wins; a resolve passed on and called later wakes the awaiting task.
async function later(resolve: (value: string) => void): Promise<void> {
  await sleep(5);
  resolve("later");
}
async function wrap<T>(v: T): Promise<T> throws Error {
  const { promise, resolve } = Promise.withResolvers<T>();
  resolve(v);
  return await promise;
}
async function main(): Promise<void> throws Error {
  const { promise, resolve, reject } = Promise.withResolvers<i64>();
  resolve(1);
  resolve(2);
  reject(new Error("ignored"));
  const a = await promise;
  console.log(a);
  const r = Promise.withResolvers<string>();
  r.reject(new Error("failed"));
  try {
    await r.promise;
  } catch (e) {
    console.log(e.message);
  }
  const l = Promise.withResolvers<string>();
  const both = await Promise.all([l.promise, later(l.resolve)]);
  console.log(both[0]);
  const v = Promise.withResolvers<void>();
  v.resolve();
  await v.promise;
  console.log("void");
  const x = await wrap(5);
  const y = await wrap("s");
  console.log(x, y);
}
// case: promise_with_resolvers_no_type
// error: can't tell what this Promise gives; write it, as in 'Promise.withResolvers<i64>()'
async function main() { const { promise } = Promise.withResolvers(); }
// case: promise_with_resolvers_arguments
// error: 'Promise.withResolvers' takes no arguments
async function main() { const { promise } = Promise.withResolvers<i64>(1); }
// case: promise_with_resolvers_resolve_type
// error: argument of type '"s"' is not assignable to parameter of type 'i64'
async function main() { const { resolve } = Promise.withResolvers<i64>(); resolve("s"); }
// case: promise_with_resolvers_throws
// error: 'main' must declare 'throws Error' after its return type since this Promise can throw 'Error'
async function main() { const r = Promise.withResolvers<i64>(); r.resolve(1); const v = await r.promise; }
