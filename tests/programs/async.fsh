// case: async_arrow_cell
// error: it holds a 'Cell<i64>', which changes without a lock, so only one thread may use it
async function main() {
  const c = new Cell(1);
  const h = spawn(async () => c.get());
  const n = await h;
}
// case: async_arrow_changes
// error: this async arrow changes 'n', which it captured
async function main() {
  let arr = [1, 2, 3];
  const f = () => {
    arr.push(4);
    return arr.length;
  };
  const a = f();
  const b = f();
  console.log(a, b);
  let n = 0;
  const g = async () => {
    n += 1;
    return n;
  };
  const c = await g();
  const d = await g();
  console.log(c, d, n);
}
// case: async_arrow_moves
// error: can't be used here because 'items' was moved
async function main() {
  const items = [1, 2, 3];
  const h = spawn(async () => {
    await yieldNow();
    return items.length;
  });
  console.log(items.length);
  const n = await h;
}
// case: async_arrow_ref_after_await
// expect: abc!
async function main() {
  const s = "abc" + "";
  const r: Ref<string> = s;
  const f = async () => {
    await yieldNow();
    return r + "!";
  };
  const v = await f();
  console.log(v);
}
// case: async_arrow_ref_capture
// error: cannot move 's' while 'p' borrows 's'
function consume(xs: string[]): i64 { return xs.length as i64; }
async function main() {
  const s = ["abc" + "", "def" + ""];
  const r: Ref<string[]> = s;
  const f = async () => {
    return r[0] + r[1];
  };
  const p = f();
  const n = consume(s);
  const v = await p;
  console.log(v, n);
}
// case: async_arrow_spawn_drops
// expect: 1
async function main() {
  const s2 = "s" + "";
  const f = async () => s2.length as i64;
  const t = spawn(f());
  const got = await t;
  console.log(got);
}
// case: async_arrows
// expect: 7 hello world
// expect: 128 64
async function main() {
  const base = 5;
  const greet = "hello" + "";
  const add = async (n: i64) => {
    await yieldNow();
    return n + base;
  };
  const say = async (who: string) => {
    await sleep(1);
    return greet + " " + who;
  };
  const a = await add(2);
  const b = await say("world" + "");
  console.log(a, b);
  let tasks: JoinHandle<i64>[] = [];
  for (let k = 0; k < 64; k++) {
    const twice = k * 0 + 2;
    tasks.push(spawn(async () => {
      await yieldNow();
      return twice;
    }));
  }
  let sum = 0;
  let count = 0;
  for (let k = 0; k < 64; k++) {
    const t = tasks.pop()!;
    const got = await t;
    sum += got;
    count++;
  }
  console.log(sum, count);
}
// case: async_await_compound
async function two(): Promise<i64> { await yieldNow(); return 2; }
async function main() {
  let x = 1;
  x += await two();
  console.log(x);
}
// error: 'await' can only be assigned with '=' to a variable or a field for now
// case: async_await_in_arm
async function one(): Promise<i64> {
  return 1;
}

async function main() {
  const n = 1;
  match (n) {
    case 1 => {
      await one();
    },
    case _ => {},
  }
}
// error: 'await' inside match arms are not supported yet
// case: async_await_in_expression
async function one(): Promise<i64> {
  return 1;
}

async function main() {
  console.log(1 + (await one()));
}
// error: 'await' inside an expression isn't supported yet; give its value a name first
// case: async_await_in_try_finally
async function one(): Promise<i64> {
  return 1;
}

async function main() {
  try {
    await one();
  } finally {
    console.log("done");
  }
}
// error: 'await' statements in a 'try' with a 'finally' are not supported yet
// case: async_await_indexed_field
type P = { s: string, inner: { t: string } };
async function two(): Promise<string> { await yieldNow(); return "two" + 2; }
async function main() {
  let ps: P[] = [{ s: "a" + 1, inner: { t: "b" + 1 } }];
  let i: usize = 0;
  ps[i].s = await two();
  console.log(ps[0].s);
}
// error: 'await' can only be assigned with '=' to a variable or a field for now
// case: async_await_lends_temporary
async function first(xs: Ref<string[]>): Promise<string> {
  await yieldNow();
  return xs[0] + "!";
}

async function main() {
  const x = await first(["a" + 1, "b" + 2]);
  console.log(x);
}
// error: the awaited Promise would keep borrowing this temporary
// case: async_await_not_promise
async function main() {
  const x = 5;
  const y = await x;
}
// error: 'await' needs a Promise, like an async function's call, not 'i64'
// case: async_await_outside
async function one(): Promise<i64> {
  return 1;
}

function main() {
  const x = await one();
}
// error: 'await' can only be used inside an 'async' function
// case: async_bare_yield_now
async function save(n: i64) { console.log(n); }
async function main() { yieldNow(); }
// error: this Promise does nothing until it's awaited
// case: async_basic
async function double(n: i64): Promise<i64> {
  console.log("doubling", n);
  await yieldNow();
  return n * 2;
}

async function name(prefix: string): Promise<string> {
  await yieldNow();
  const made = prefix + "-named";
  await yieldNow();
  return made;
}

async function greet(who: string) {
  const d = await double(21);
  console.log(who, d);
}

async function sum(n: i64): Promise<i64> {
  let total = 0;
  for (let i = 0; i < n; i++) {
    const d = await double(i);
    total += d;
  }
  return total;
}

async function main() {
  console.log("start");
  await greet("hi" + 1);
  const p = double(4);
  console.log("made but not run");
  let x = 0;
  x = await p;
  console.log(x);
  const total = await sum(3);
  console.log(total);
  const n = await name("x" + 1);
  console.log(n);
  await yieldNow();
  console.log("end");
}
// expect: start
// expect: doubling 21
// expect: hi1 42
// expect: made but not run
// expect: doubling 4
// expect: 8
// expect: doubling 0
// expect: doubling 1
// expect: doubling 2
// expect: 6
// expect: x1-named
// expect: end
// case: async_borrows_argument
async function first(xs: Ref<string[]>): Promise<string> {
  await yieldNow();
  return xs[0];
}

async function main() {
  let arr = ["a" + 1];
  const f = first(arr);
  arr.push("b");
  const x = await f;
  console.log(x);
}
// error: cannot change 'arr' while 'f' borrows 'arr' and is used later
// case: async_bound_borrows
// error: cannot move 'l' while 'f' borrows 'l'
class Store {
  name: string;
  constructor(n: string) { this.name = n; }
  async load(extra: i64): Promise<string> {
    await yieldNow();
    return this.name + `${extra}`;
  }
}
interface Loader { load(extra: i64): Promise<string>; }
async function viaBound(l: Loader): Promise<string> {
  const f = l.load(7);
  const moved = l;
  const n = await f;
  return n;
}
async function main() {
  const d = await viaBound(new Store("abc" + ""));
  console.log(d);
}
// case: async_clone_borrowing_handle
// expect: 7
// expect: v1
async function one(n: i64): Promise<string> { await yieldNow(); return "v" + n; }
function look(h: Ref<JoinHandle<string>>): i64 { return 7; }
async function main() {
  const h = spawn(one(1));
  const f = () => look(h);
  const g = f.clone();
  console.log(g());
  const v = await h;
  console.log(v);
}
// case: async_clone_future_holding_handle
// error: can't clone a JoinHandle, or a value holding one
async function one(): Promise<string> {
  await yieldNow();
  return "one" + 1;
}

async function waitOn(h: JoinHandle<string>): Promise<string> {
  return await h;
}

async function main() {
  const f = waitOn(spawn(one()));
  const g = f.clone();
  console.log(await f, await g);
}
// case: async_clone_future_shared
// expect: 2
async function work(n: i64): Promise<i64> {
  const local = shared({ n: 1 });
  await yieldNow();
  return n;
}
async function main() {
  const f = work(1);
  const f2 = f.clone();
  const a = await f;
  const b = await f2;
  console.log(a + b);
}
// case: async_clone_handle
// error: can't clone a JoinHandle, or a value holding one: only one place can await a task's result
async function one(): Promise<string> {
  await yieldNow();
  return "one" + 1;
}

async function main() {
  const h = spawn(one());
  const h2 = h.clone();
  console.log(await h, await h2);
}
// case: async_clone_handle_generic
// error: can't clone a JoinHandle, or a value holding one
async function one(): Promise<string> {
  await yieldNow();
  return "one" + 1;
}

function dup<T>(x: Ref<T>): T {
  return x.clone();
}

async function main() {
  const h = spawn(one());
  const g = dup(h);
  const a = await h;
  const b = await g;
  console.log(a, b);
}
// case: async_converting_reference
async function main() {
  const s = "ww" + 1;
  const r: Ref<i64 | string> = s;
  await yieldNow();
  if (typeof r === "string") console.log("str", r);
}
// error: references that convert their value inside async functions are not supported yet
// case: async_cstring
declare function strlen(s: Ptr<u8>): usize;
async function main() {
  const p = cString("hello" + 1);
  await yieldNow();
  const n = unsafe { strlen(p) };
  console.log(n);
}
// error: 'cString' inside async functions are not supported yet
// case: async_deep_recursion
// expect: 100000
function depth(n: i64): i64 {
  if (n === 0) return 0;
  return depth(n - 1) + 1;
}
async function main() {
  console.log(depth(100000));
}
// case: async_dyn
// expect: 3328 64
// expect: 12 20
type Request = { path: string; n: i64 };

interface Handler {
  handle(req: Request): Promise<i64>;
}

class Doubler {
  async handle(req: Request): Promise<i64> {
    await yieldNow();
    return req.n * 2;
  }
}

class Tagger {
  tag: string;
  constructor(tag: string) {
    this.tag = tag;
  }
  async handle(req: Request): Promise<i64> {
    await sleep(1);
    return req.n + (this.tag.length as i64) + (req.path.length as i64);
  }
}

async function serve(hs: Dyn<Handler>[], n: i64): Promise<i64> {
  let total = 0;
  for (const h of hs) {
    const got = await h.handle({ path: "/x" + "", n: n });
    total += got;
  }
  return total;
}

async function main() {
  let tasks: JoinHandle<i64>[] = [];
  for (let k = 0; k < 64; k++) {
    let hs: Dyn<Handler>[] = [new Doubler(), new Tagger("ab" + "")];
    tasks.push(spawn(serve(hs, 16)));
  }
  let sum = 0;
  let count = 0;
  for (let k = 0; k < 64; k++) {
    const t = tasks.pop()!;
    const got = await t;
    sum += got;
    count++;
  }
  console.log(sum, count);
  const scale = 2;
  const ops: ((n: i64) => Promise<i64>)[] = [async (n) => n * scale, async (n) => {
    await yieldNow();
    return n + 10;
  }];
  const a = await ops[0](6);
  const b = await ops[1](10);
  console.log(a, b);
}
// case: async_dyn_borrows
// error: while 'f' borrows 'h'
interface Handler {
  handle(n: i64): Promise<i64>;
}

class Doubler {
  async handle(n: i64): Promise<i64> {
    return n * 2;
  }
}

class Tripler {
  async handle(n: i64): Promise<i64> {
    return n * 3;
  }
}

async function main() {
  let h: Dyn<Handler> = new Doubler();
  const f = h.handle(4);
  h = new Tripler();
  const got = await f;
}
// case: async_dyn_ref_argument
// error: cannot move 's' while 'f' borrows 's[...]'
interface H { h(x: Ref<string>): Promise<string>; }
class C {
  async h(x: Ref<string>): Promise<string> {
    await yieldNow();
    return x + "!";
  }
}
function consume(xs: string[]): i64 { return xs.length as i64; }
async function main() {
  const d: Dyn<H> = new C();
  let s = ["abc" + "x", "def" + "y"];
  const f = d.h(s[1]);
  const n = consume(s);
  const v = await f;
  console.log(v, n);
}
// case: async_dyn_spawn
// error: 'spawn' needs a Promise from an async function's call, not 'Promise<i64>'
interface Handler {
  handle(n: i64): Promise<i64>;
}

class Doubler {
  async handle(n: i64): Promise<i64> {
    return n * 2;
  }
}

async function main() {
  const h: Dyn<Handler> = new Doubler();
  const t = spawn(h.handle(4));
}
// case: async_errors
class Oops {
  why: string;
  constructor(why: string) {
    this.why = why;
  }
}

type Box = { name: string };

async function risky(n: i64): Promise<string> throws Oops {
  const held = "held" + n;
  await yieldNow();
  if (n > 1) throw new Oops("too big " + n);
  return held + "!";
}

async function careful(n: i64): Promise<string> {
  try {
    const s = await risky(n);
    return "ok " + s;
  } catch (e) {
    return "caught " + e.why;
  }
}

async function passes(n: i64): Promise<string> throws Oops {
  const s = await risky(n);
  return "passed " + s;
}

async function borrows(b: Ref<Box>, xs: Ref<string[]>): Promise<string> {
  const name = b.name;
  const first = xs[0];
  await yieldNow();
  const own: Box = { name: "own" + 1 };
  const r: Ref<Box> = own;
  await yieldNow();
  return name + first + r.name;
}

async function main() throws Oops {
  const a = await careful(1);
  const b = await careful(5);
  console.log(a, b);
  const box: Box = { name: "box" + 1 };
  const xs = ["x" + 2];
  const c = await borrows(box, xs);
  console.log(c);
  const unused = risky(7);
  const later = passes(9);
  const d = await passes(1);
  console.log(d);
  const e = await later;
  console.log(e);
}
// expect: ok held1! caught too big 5
// expect: box1x2own1
// expect: passed held1!
// fails: Error: Oops
// case: async_function_param
// expect: 7
// expect: 20 x
// expect: 200 hi / x
async function twice(f: (n: i64) => Promise<i64>, start: i64): Promise<i64> {
  const a = await f(start);
  const b = await f(a);
  return b;
}
class Headers {
  names: string[] = [];
  values: string[] = [];
  get(name: string): string | null {
    const lower = name.toLowerCase();
    for (let i = 0; i < this.names.length; i++) {
      if (this.names[i] === lower) return this.values[i];
    }
    return null;
  }
  set(this: Mut<this>, name: string, value: string) {
    this.names.push(name.toLowerCase());
    this.values.push(value);
  }
}
class Request { method: string; path: string; headers: Headers; constructor(method: string, path: string, headers: Headers) { this.method = method; this.path = path; this.headers = headers; } }
class Response { status: i64; body: string; constructor(body: string, status: i64) { this.body = body; this.status = status; } }
type Options = { port: i64 };
async function run(options: Options, handler: (req: Request) => Promise<Response>): Promise<void> {
  let h = new Headers();
  h.set("Host", "x");
  const req = new Request("GET", "/", h);
  const res = await handler(req);
  console.log(res.status, res.body);
}

// Awaiting a call of a function-typed parameter gives what the closure it was given gives.
async function main(): Promise<void> {
  const step = 3;
  const label = "x";
  const t = await twice(async (n: i64) => n + step, 1);
  console.log(t);
  const s = await twice(async (n: i64) => { await yieldNow(); return n * 2; }, 5);
  console.log(s, label);
  await run({ port: 8 }, async (req: Request) => new Response(`hi ${req.path} ${req.headers.get("HOST") ?? "none"}`, 200));
}
// case: async_generator
async function* g(): Generator<i64> {
  yield 1;
}

function main() {}
// error: async generators are not supported yet
// case: async_handle_out_of_array
// error: can't be moved out of its array; use 'pop()'
async function one(n: i64): Promise<string> { await yieldNow(); return "v" + n; }
async function main() {
  const hs = [spawn(one(1))];
  const a = await hs[0];
}
// case: async_inferred_enum
// expect: true false
enum Color { Red, Green, Blue }
async function g() { await yieldNow(); return Color.Blue; }
async function main() { const y = await g(); console.log(y === Color.Blue, y === Color.Red); }
// case: async_inferred_string
// expect: x
async function f() { return "x"; }
async function main() { const x = await f(); console.log(x); }
// case: async_main_ends_while_busy
// expect: main done
async function spin(): Promise<i64> {
  let total = 0;
  for (let i = 0; i < 4000000000000; i++) total += i % 7;
  return total;
}
async function main() {
  const s = spawn(spin());
  await sleep(50);
  console.log("main done");
}
// case: async_method_borrows
// error: cannot change 's.count' while 'f' borrows 's'
class Store {
  count: i64 = 3;
  async load(this: Ref<this>): Promise<i64> {
    await yieldNow();
    return this.count;
  }
}

async function main() {
  let s = new Store();
  const f = s.load();
  s.count = 5;
  const n = await f;
}
// case: async_method_spawn
// expect: 9
class Job {
  n: i64;
  constructor(n: i64) {
    this.n = n;
  }
  async run(this: Own<this>): Promise<i64> {
    await yieldNow();
    return this.n * 3;
  }
}

async function main() {
  const j = new Job(3);
  const h = spawn(j.run());
  const n = await h;
  console.log(n);
}
// case: async_methods
// expect: 3 alpha
// expect: 10
// expect: 10
class Store {
  name: string;
  count: i64;
  constructor(name: string) {
    this.name = name;
    this.count = 3;
  }
  async load(this: Ref<this>, extra: i64): Promise<i64> {
    await yieldNow();
    return this.count + extra;
  }
  async label(): Promise<string> {
    await sleep(1);
    return this.name;
  }
  async consume(this: Own<this>): Promise<i64> {
    await yieldNow();
    return this.count + (this.name.length as i64) + 2;
  }
}

interface Loader {
  load(extra: i64): Promise<i64>;
}

async function viaBound(l: Ref<Loader>): Promise<i64> {
  const n = await l.load(7);
  return n;
}

async function main() {
  const s = new Store("alpha" + "");
  const a = await s.load(0);
  const b = await s.label();
  console.log(a, b);
  const c = await s.consume();
  console.log(c);
  const t = new Store("x" + "");
  const d = await viaBound(t);
  console.log(d);
}
// case: async_mut_method_lends
// error: cannot use 'c' while 'a' borrows 'c' mutably
class C {
  xs: string[];
  constructor() { this.xs = ["a" + ""]; }
  async bump(this: Mut<this>): Promise<i64> {
    await yieldNow();
    for (let i = 0; i < 100; i++) this.xs.push("b" + "");
    return this.xs.length as i64;
  }
  first(): Ref<string> { return this.xs[0]; }
}
async function main() {
  let c = new C();
  const a = c.bump();
  const r = c.first();
  const x = await a;
  console.log(x, r);
}
// case: async_own_method_temporary
// expect: 2
class C {
  tag: string;
  constructor(t: string) { this.tag = t; }
  async take(this: Own<this>): Promise<i64> {
    await yieldNow();
    return this.tag.length as i64;
  }
}
async function main() {
  const got = await new C("ab" + "").take();
  console.log(got);
}
// case: async_panic
async function pick(xs: string[], at: usize): Promise<string> {
  const note = "picked " + xs.length;
  await yieldNow();
  return note + xs[at];
}

async function outer(): Promise<string> {
  const held = "outer" + 1;
  await yieldNow();
  const a = await pick(["a" + 1], 0);
  console.log(a, held);
  const b = await pick(["b" + 2], 4);
  return b;
}

async function main() {
  const top = "main" + 1;
  const r = await outer();
  console.log(r, top);
}
// expect: picked 1a1 outer1
// panic: index out of bounds
// case: async_panic_while_busy
// panic: index out of bounds
async function spin(): Promise<i64> {
  let total = 0;
  for (let i = 0; i < 4000000000000; i++) total += i % 7;
  return total;
}
async function boom(xs: i64[]): Promise<i64> {
  await sleep(50);
  return xs[3];
}
async function main() {
  const s = spawn(spin());
  const v = await spawn(boom([1]));
  console.log(v);
}
// case: async_promise_in_class
class Wrap<T> { v: T; constructor(v: T) { this.v = v; } }
async function word(s: string): Promise<string> { await yieldNow(); return s + "!"; }
async function main() {
  const w = new Wrap(word("a" + 1));
  const x = await w.v;
  console.log(x);
  const w2 = new Wrap(word("never" + 1));
}
// expect: a1!
// case: async_promise_parameter
async function word(s: string): Promise<string> { await yieldNow(); return s + "!"; }
async function num(): Promise<i64> { await yieldNow(); return 7; }
async function twice(p: Promise<string>, q: Promise<string>): Promise<string> {
  const a = await p;
  const b = await q;
  return a + b;
}
async function main() {
  const r = await twice(word("a" + 1), word("b" + 1));
  console.log(r);
  const unused = twice(word("c" + 1), word("d" + 1));
}
// expect: a1!b1!
// case: async_reassign_promise
async function save(n: i64) { console.log(n); }
async function main() { let p = save(1); p = save(2); await p; }
// expect: 2
// case: async_recursive
async function count(n: i64): Promise<i64> {
  if (n === 0) return 0;
  const rest = await count(n - 1);
  return rest + 1;
}

async function main() {
  await count(3);
}
// error: an async function can't await another of itself
// case: async_sleep
async function after(ms: i64, label: string): Promise<string> {
  await sleep(ms);
  console.log(label);
  return label + "!";
}

async function nap(ms: i64): Promise<i64> {
  await sleep(ms);
  return ms;
}

async function main() {
  const c = spawn(after(150, "third" + 3));
  const a = spawn(after(50, "first" + 1));
  const b = spawn(after(100, "second" + 2));
  const ra = await a;
  const rb = await b;
  const rc = await c;
  console.log(ra, rb, rc);
  let waits: JoinHandle<i64>[] = [];
  for (let i = 0; i < 3; i++) waits.push(spawn(nap(300)));
  let total = 0;
  while (waits.length > 0) {
    const h = waits.pop()!;
    const got = await h;
    total += got;
  }
  console.log(total);
  await sleep(0);
  console.log("done");
}
// expect: first1
// expect: second2
// expect: third3
// expect: first1! second2! third3!
// expect: 900
// expect: done
// case: async_spawn
class Oops {
  why: string;
  constructor(why: string) {
    this.why = why;
  }
}

async function work(n: i64): Promise<i64> {
  let total = 0;
  for (let i = 0; i <= n; i++) {
    total += i;
    if (i % 50 === 0) await yieldNow();
  }
  return total;
}

async function label(n: i64): Promise<string> {
  await yieldNow();
  return "task" + n;
}

async function forever(name: string) {
  const held = name + "!";
  for (let i = 0; i < 1000000000000; i++) await yieldNow();
  console.log(held);
}

async function fails(n: i64): Promise<i64> throws Oops {
  await yieldNow();
  if (n > 2) throw new Oops("failed " + n);
  return n;
}

async function main() throws Oops {
  let handles: JoinHandle<i64>[] = [];
  for (let i = 0; i < 300; i++) handles.push(spawn(work(i)));
  let sum = 0;
  while (handles.length > 0) {
    const h = handles.pop()!;
    const v = await h;
    sum += v;
  }
  console.log(sum);
  const names = spawn(label(7));
  const n = await names;
  console.log(n);
  spawn(forever("detached" + 1));
  const ok = await spawn(fails(1));
  console.log(ok);
  try {
    const bad = await spawn(fails(5));
    console.log(bad);
  } catch (e) {
    console.log("caught", e.why);
  }
}
// expect: 4499950
// expect: task7
// expect: 1
// expect: caught failed 5
// case: async_spawn_borrows
async function first(xs: Ref<string[]>): Promise<string> {
  await yieldNow();
  return xs[0];
}

async function main() {
  const names = ["a" + 1];
  const h = spawn(first(names));
  const x = await h;
  console.log(x);
}
// error: 'spawn' runs this Promise on another thread, so it must own everything it uses; it holds a 'Ref<string[]>', which borrows from this function
// case: async_spawn_not_promise
async function main() {
  spawn(5);
}
// error: 'spawn' needs a Promise from an async function's call, not 'i64'
// case: async_spawn_outside
async function two(): Promise<i64> {
  return 2;
}

function main() {
  spawn(two());
}
// error: 'spawn' can only be used inside an 'async' function, where the runtime is running
// case: async_spawn_panic
async function pick(xs: string[], at: usize): Promise<string> {
  const note = "picking " + at;
  await sleep(20);
  return note + xs[at];
}

async function slow(): Promise<string> {
  const held = "slow" + 1;
  await sleep(10000);
  return held;
}

async function main() {
  const background = spawn(slow());
  const ok = await spawn(pick(["a" + 1], 0));
  console.log(ok);
  const bad = await spawn(pick(["b" + 2], 3));
  console.log(bad);
}
// expect: picking 0a1
// panic: index out of bounds
// case: async_stored_future_temporary
async function first(xs: Ref<string[]>): Promise<string> {
  await yieldNow();
  return xs[0] + "!";
}
async function main() {
  const p = first(["a" + 1, "b" + 2]);
  const x = await p;
  console.log(x);
}
// error: 'p' would keep borrowing this temporary
// case: async_unused_promise
async function save(n: i64) {
  console.log(n);
}

async function main() {
  save(1);
}
// error: this Promise does nothing until it's awaited, since Fish's promises are lazy; add 'await'
// case: async_wrong_return_type
async function one(): i64 {
  return 1;
}

async function main() {
  await one();
}
// error: an async function's return type is 'Promise<T>', the type of what it gives once awaited
// case: async_yield_stress
async function spin(n: i64, label: string): Promise<i64> {
  let total = 0;
  for (let i = 0; i < n; i++) {
    const s = label + i;
    await yieldNow();
    total += s.length as i64;
  }
  return total;
}

async function main() {
  let sum = 0;
  for (let round = 0; round < 50; round++) {
    const got = await spin(200, "x" + round);
    sum += got;
  }
  console.log(sum);
}
// expect: 52500
