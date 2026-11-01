// case: callable_async_atomic
// error: this async function captures 'holder', which holds an Atomic
// Each call of an async callable works on a copy of its captures, so an Atomic can't be one.
type Fn = () => Promise<i64>;
async function main(): Promise<void> {
  const holder = { n: new Atomic(0) };
  const f: Fn = async () => holder.n.add(1);
  const a = await f();
}
// case: callable_borrowing
// error: this closure borrows 'name', but a stored callable owns what it captures
function main() {
  const name = "abc" + "";
  const f = (n: i64) => n + (name.length as i64);
  let handlers: ((n: i64) => i64)[] = [];
  handlers.push(f);
}
// case: callable_calls
// expect: 3 8 10 -2
// expect: 5 11
// expect: clicked 7
// expect: 20 21
type Request = { path: string; n: i64 };

class Button {
  onClick: (n: i64) => string;
  constructor(onClick: (n: i64) => string) {
    this.onClick = onClick;
  }
  press(n: i64): string {
    return this.onClick(n);
  }
}

function adder(by: i64): (x: i64) => i64 {
  return (x) => x + by;
}

function apply(f: (x: i64) => i64, x: i64): i64 {
  return f(x);
}

function main() {
  const tag = "x" + "";
  let handlers: ((r: Request) => i64)[] = [];
  handlers.push((r) => r.n + 1);
  handlers.push((r) => r.n * 4 + (tag.length as i64) - 1);
  handlers.push((r) => r.n + (r.path.length as i64) + 6);
  const req: Request = { path: "/a" + "", n: 2 };
  console.log(handlers[0](req.clone()), handlers[1](req.clone()), handlers[2](req), handlers[0]({ path: "", n: -3 }));
  const add2 = adder(2);
  const add5 = adder(5);
  console.log(add2(3), add5(6));
  const label = "clicked " + "";
  const b = new Button(move (n) => label + n);
  console.log(b.press(7));
  let f: (x: i64) => i64 = (x) => x * 2;
  const first = apply(f, 10);
  f = adder(11);
  console.log(first, f(10));
}
// case: callable_cell
// error: may cross to another thread, so it can't hold a 'Cell<i64>', which changes without a lock
function main() {
  const c = new Cell(1);
  let handlers: ((n: i64) => i64)[] = [];
  handlers.push((n) => n + c.get());
}
// case: callable_changing
// error: this closure changes 'count', which it captures, but a stored callable can't change what it captures; keep that state in an 'Atomic' or a 'Lock'
function main() {
  let count = 0;
  let handlers: ((n: i64) => i64)[] = [];
  handlers.push((n) => {
    count++;
    return n + count;
  });
}
// case: callable_clone_deep
// expect: 11 21
// expect: 11 21
// A stored callable capturing other callables clones each of them through its own vtable.
type Fn = (n: i64) => i64;
function main() {
  let fns: Fn[] = [];
  fns.push((n: i64) => n + 1);
  fns.push((n: i64) => n * 2 + 1);
  const holder = { fns: fns };
  const both: Fn = (n: i64) => holder.fns[0](n) * 100 + holder.fns[1](n);
  const again = both.clone();
  console.log(both(10) / 100, both(10) % 100);
  console.log(again(10) / 100, again(10) % 100);
}
// case: callable_clone_shares
// expect: 0
// expect: 1
// A callable's clone shares it, and so the state its captured Dyn keeps in an Atomic.
interface Counter { next(): i64; }
class Ticks { n: Atomic<i64> = new Atomic(0); next(): i64 { return this.n.add(1); } }
type Fn = () => i64;
function main() {
  const counter: Dyn<Counter> = new Ticks();
  const holder = { counter: counter };
  const tick: Fn = () => holder.counter.next();
  console.log(tick());
  const again = tick.clone();
  console.log(again());
}
// case: callable_element_moved
// error: 'fs[0]' can't be used here because 'fs' was moved
function eat(fs: ((n: i64) => string)[]): i64 { return 1 }
function main() {
  const s = "orig" + "";
  let fs: ((n: i64) => string)[] = [(n) => s + n];
  eat(fs);
  print(fs[0](1));
}
// case: callable_fewer_params
// expect: 7
function main() {
  let fs: ((m: string) => i64)[] = [];
  fs.push(() => 7);
  print(fs[0]("x" + ""));
}
// case: callable_fewer_params_panic
// expect: 5
// panic: attempt to divide by zero
function main() {
  let fs: ((n: i64, m: string) => i64)[] = [];
  fs.push((n) => 10 / n);
  print(fs[0](2, "a" + ""));
  print(fs[0](0, "b" + ""));
}
// case: callable_generic
// expect: 5
function wrap<T>(v: T): (x: T) => T { return (x) => x }
function main() {
  const a = wrap(1);
  print(a(5));
}
// case: callable_in_shared
// expect: 800
type Hooks = { scale: (n: i64) => i64; hits: Atomic<i64> };

async function work(h: shared<Hooks>): Promise<i64> {
  for (let i = 0; i < 100; i++) {
    h.hits.add(h.scale(1));
    await yieldNow();
  }
  return 0;
}

async function main() {
  const hooks = shared<Hooks>({ scale: (n) => n, hits: new Atomic(0) });
  let tasks: JoinHandle<i64>[] = [];
  for (let k = 0; k < 8; k++) tasks.push(spawn(work(hooks.clone())));
  for (let k = 0; k < 8; k++) {
    const t = tasks.pop()!;
    await t;
  }
  console.log(hooks.hits.load());
}
// case: callable_lent_during_call
// error: cannot move 'f' while 'f' is lent to 'f' for this call
function eat(f: (n: i64) => string): i64 { return 1 }
function main() {
  const s = "orig" + "";
  const f: (n: i64) => string = (n) => s + n;
  print(f(eat(f)));
}
// case: callable_narrow_result
// expect: 3
type A = { a: i64 };
function main() {
  const s = "x" + "";
  const g = move (n: i64) => ({ a: n, b: s + "" });
  let fs: ((n: i64) => A)[] = [];
  fs.push(g);
  print(fs[0](3).a);
}
// case: callable_object_param
// expect: 11
type H = { f: (x: i64) => i64 };
function callIt(h: H, x: i64): i64 { return h.f(x) }
function main() {
  const h: H = { f: (x) => x + 10 };
  print(callIt(h, 1));
}
// case: callable_once
// error: this closure moves 'items' out of what it captures, so it can run only once
function take(xs: i64[]): i64 {
  return 1;
}

function main() {
  const items = [1, 2];
  const f = move (n: i64) => n + take(items);
  let handlers: ((n: i64) => i64)[] = [];
  handlers.push(f);
}
// case: callable_optional_async
// expect: async callback 7
// expect: async callback 30
// An optional async callback field, given as an async arrow.
type Opts = { n: i64; done?: (n: i64) => Promise<i64> };
async function run(o: Opts): Promise<void> {
  const cb = o.done;
  if (cb !== null) {
    const r = await cb(o.n);
    console.log("async callback", r);
  }
}
async function main(): Promise<void> {
  const add = 5;
  await run({ n: 2, done: async (n) => n + add });
  const o: Opts = { n: 3, done: async (n) => n * 10 };
  await run(o);
  await run({ n: 1 });
}
// case: callable_optional_field
// expect: listening 108
// expect: no callback
// expect: none yet
// An optional callback field: a union of a stored callable and null, narrowed before calling.
type Info = { port: i64 };
type Options = { port: i64; onListen?: (info: Info) => void };
function start(options: Options) {
  const listen = options.onListen;
  if (listen !== null) listen({ port: options.port });
  else console.log("no callback");
}
function main() {
  const base = 100;
  start({ port: 8, onListen: (info: Info) => console.log("listening", info.port + base) });
  start({ port: 9 });
  let cb: ((n: i64) => i64) | null = null;
  if (cb === null) console.log("none yet");
}
// case: callable_storing
// expect: built 3 2
type Config = { name: string; size: i64 };

class Button {
  label: string;
  onClick: (n: i64) => i64;
  constructor(label: string, onClick: (n: i64) => i64) {
    this.label = label;
    this.onClick = onClick;
  }
}

function main() {
  const prefix = "item" + "";
  const config: Config = { name: "c" + "", size: 3 };
  let handlers: ((n: i64) => i64)[] = [];
  handlers.push((n) => n + 1);
  handlers.push((n) => n + (prefix.length as i64));
  handlers.push((n) => n * config.size);
  let current: (n: i64) => i64 = (n) => n;
  const step = 2;
  current = (n) => n * step;
  const b = new Button("ok" + "", (n) => n - 1);
  const list: ((n: i64) => i64)[] = [(n) => n, (n) => -n];
  console.log("built", handlers.length, list.length);
}
// case: callable_tasks
// expect: 6 6
// expect: 1344 32
async function run(fs: ((n: i64) => i64)[], n: i64): Promise<i64> {
  let total = 0;
  for (const f of fs) {
    total += f(n);
    await yieldNow();
  }
  return total;
}

function main2(): i64 {
  const word = "abc" + "";
  const f: (n: i64) => i64 = (n) => n + (word.length as i64);
  const g = f.clone();
  return g(3);
}

async function main() {
  const tag = "tag" + "";
  const f: (n: i64) => i64 = (n) => n + (tag.length as i64);
  const g = f.clone();
  console.log(f(3), main2());
  let tasks: JoinHandle<i64>[] = [];
  for (let k = 0; k < 32; k++) {
    let fs: ((n: i64) => i64)[] = [(n) => n * 2, (n) => n + (tag.length as i64)];
    tasks.push(spawn(run(fs, 13)));
  }
  let sum = 0;
  let count = 0;
  for (let k = 0; k < 32; k++) {
    const t = tasks.pop()!;
    const got = await t;
    sum += got;
    count++;
  }
  console.log(sum + g(0) - 3, count);
}
// case: callable_void_result
// expect: 1
function main() {
  let fs: ((a: i64) => void)[] = [];
  fs.push((a) => "x" + a);
  fs[0](1);
  fs[0](2);
  print(1);
}

// case: callable_parameter_property
// expect: 2 6 10
class Holder {
  constructor(public f: (n: i64) => i64) {}
}
class Scaled {
  constructor(private readonly by: (n: i64) => i64, public base: i64) {}
  run(): i64 { return this.by(this.base); }
}
function main() {
  const k = 3;
  const a = new Holder((n: i64): i64 => n + 1);
  const b = new Holder(move (n: i64): i64 => n * k);
  const s = new Scaled((n: i64): i64 => n * 2, 5);
  console.log(a.f(1), b.f(2), s.run());
}
