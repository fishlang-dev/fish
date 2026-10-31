// A panic in a debug build prints the program's own call stack after its reason, innermost first:
// the panicking function at the panic, then each caller at its call.

// case: three_deep
function add(a: i64, b: i64): i64 {
  return a + b;
}

function total(xs: i64[]): i64 {
  let t = 0;
  for (const x of xs) t = add(t, x);
  return t;
}

function main() {
  console.log(total([1, 9223372036854775807]));
}
// panic: attempt to add with overflow
// stderr: panicked at three_deep.fsh:2:10:
// stderr: attempt to add with overflow
// stderr: stack backtrace:
// stderr:    0: add at three_deep.fsh:2:10
// stderr:    1: total at three_deep.fsh:7:27
// stderr:    2: main at three_deep.fsh:12:15

// case: recursion
function down(n: i64): i64 {
  if (n === 0) return 10 / n;
  return down(n - 1);
}

function main() {
  console.log(down(2));
}
// panic: attempt to divide by zero
// stderr: stack backtrace:
// stderr:    0: down at recursion.fsh:2:23
// stderr:    1: down at recursion.fsh:3:10
// stderr:    2: down at recursion.fsh:3:10
// stderr:    3: main at recursion.fsh:7:15

// case: method_and_static
class Counter {
  n: i64;
  constructor(n: i64) {
    this.n = n;
  }
  bump(by: i64): i64 {
    return Counter.check(this.n + by);
  }
  get doubled(): i64 {
    return this.bump(this.n);
  }
  static check(n: i64): i64 {
    const xs = [1, 2, 3];
    return xs[n as usize];
  }
}

function main() {
  const c = new Counter(2);
  console.log(c.doubled);
}
// panic: index out of bounds: the len is 3 but the index is 4
// stderr: stack backtrace:
// stderr:    0: Counter.static check at method_and_static.fsh:14:12
// stderr:    1: Counter.bump at method_and_static.fsh:7:12
// stderr:    2: Counter.get doubled at method_and_static.fsh:10:12
// stderr:    3: main at method_and_static.fsh:20:15

// case: closure_in_map
function scale(xs: i64[], by: i64): i64[] {
  return xs.map((x) => x * by);
}

function main() {
  console.log(scale([1, 2], 9223372036854775807));
}
// panic: attempt to multiply with overflow
// stderr: stack backtrace:
// stderr:    0: <arrow 2:17> at closure_in_map.fsh:2:24
// stderr:    1: scale at closure_in_map.fsh:2:10
// stderr:    2: main at closure_in_map.fsh:6:15

// case: generic_instance
function firstOf<T>(xs: T[]): T {
  return xs[3].clone();
}

function main() {
  console.log(firstOf(["a", "b"]));
}
// panic: index out of bounds: the len is 2 but the index is 3
// stderr: stack backtrace:
// stderr:    0: firstOf at generic_instance.fsh:2:10
// stderr:    1: main at generic_instance.fsh:6:15

// case: task_panic
async function pick(xs: i64[], at: usize): Promise<i64> {
  await sleep(10);
  return xs[at];
}

async function work(): Promise<i64> {
  const v = await pick([1, 2], 7);
  return v;
}

async function main() {
  const v = await spawn(work());
  console.log(v);
}
// panic: index out of bounds: the len is 2 but the index is 7
// stderr: stack backtrace:
// stderr:    0: pick at task_panic.fsh:3:10
// stderr:    1: work at task_panic.fsh:7:13
// stderr: spawned at task_panic.fsh:12:19

// case: task_panic_awaited
// An awaiter re-raising a task's panic prints its own task's stack, not the one that panicked.
async function pick(xs: i64[], at: usize): Promise<i64> {
  await sleep(10);
  return xs[at];
}

async function collect(h: JoinHandle<i64>): Promise<i64> {
  const v = await h;
  return v;
}

async function relay(): Promise<i64> {
  const v = await collect(spawn(pick([1, 2], 7)));
  return v;
}

async function main() {
  const v = await spawn(relay());
  console.log(v);
}
// panic: a task this awaited panicked: a task this awaited panicked: index out of bounds: the len is 2 but the index is 7
// stderr: stack backtrace:
// stderr:    0: pick at task_panic_awaited.fsh:4:10
// stderr: spawned at task_panic_awaited.fsh:13:27
// stderr: panicked at task_panic_awaited.fsh:8:13:
// stderr: a task this awaited panicked: index out of bounds: the len is 2 but the index is 7
// stderr: await 'handle.join()' to catch it as a TaskPanic instead
// stderr: stack backtrace:
// stderr:    0: collect at task_panic_awaited.fsh:8:13
// stderr:    1: relay at task_panic_awaited.fsh:13:13
// stderr: spawned at task_panic_awaited.fsh:18:19
// stderr: panicked at task_panic_awaited.fsh:18:13:

// case: task_after_task
function half(n: i64): i64 {
  return 10 / n;
}

async function quiet(n: i64): Promise<i64> {
  await yieldNow();
  return half(n);
}

async function loud(n: i64): Promise<i64> {
  await sleep(5);
  return half(n);
}

async function main() {
  const a = await spawn(quiet(2));
  console.log(a);
  const b = await spawn(loud(0));
  console.log(b);
}
// expect: 5
// panic: attempt to divide by zero
// stderr: stack backtrace:
// stderr:    0: half at task_after_task.fsh:2:10
// stderr:    1: loud at task_after_task.fsh:12:10
// stderr: spawned at task_after_task.fsh:18:19

// case: await_chain
async function c(n: i64): Promise<i64> {
  await yieldNow();
  return 10 / n;
}

async function b(n: i64): Promise<i64> {
  const r = await c(n);
  return r;
}

async function a(n: i64): Promise<i64> {
  const r = await b(n);
  return r;
}

async function main() {
  const v = await a(0);
  console.log(v);
}
// panic: attempt to divide by zero
// stderr: stack backtrace:
// stderr:    0: c at await_chain.fsh:3:10
// stderr:    1: b at await_chain.fsh:7:13
// stderr:    2: a at await_chain.fsh:12:13
// stderr:    3: main at await_chain.fsh:17:13

// case: sleep_in_middle
async function c(n: i64): Promise<i64> {
  return 10 / n;
}

async function b(n: i64): Promise<i64> {
  await sleep(5);
  const r = await c(n);
  return r;
}

async function a(n: i64): Promise<i64> {
  const r = await b(n);
  return r;
}

async function main() {
  const v = await a(0);
  console.log(v);
}
// panic: attempt to divide by zero
// stderr: stack backtrace:
// stderr:    0: c at sleep_in_middle.fsh:2:10
// stderr:    1: b at sleep_in_middle.fsh:7:13
// stderr:    2: a at sleep_in_middle.fsh:12:13
// stderr:    3: main at sleep_in_middle.fsh:17:13

// case: generator_body
function* shares(from: i64): Generator<i64> {
  for (let i = from; i >= 0; i--) yield 6 / i;
}

function sum(): i64 {
  let s = 0;
  for (const x of shares(2)) s += x;
  return s;
}

function main() {
  console.log(sum());
}
// panic: attempt to divide by zero
// stderr: stack backtrace:
// stderr:    0: shares at generator_body.fsh:2:41
// stderr:    1: sum at generator_body.fsh:7:3
// stderr:    2: main at generator_body.fsh:12:15

// case: async_generator_body
async function* ticks(n: i64): AsyncGenerator<i64> {
  for (let i = n; i >= 0; i--) {
    await yieldNow();
    yield 12 / i;
  }
}

async function main() {
  for await (const t of ticks(2)) console.log(t);
}
// expect: 6
// expect: 12
// panic: attempt to divide by zero
// stderr: stack backtrace:
// stderr:    0: ticks at async_generator_body.fsh:4:11
// stderr:    1: main at async_generator_body.fsh:9:3

// case: depth_limit
function deep(n: i64): i64 {
  if (n === 0) return 1 / n;
  return deep(n - 1);
}

function main() {
  console.log(deep(199));
}
// panic: attempt to divide by zero
// stderr:   62: deep at depth_limit.fsh:3:10
// stderr:   63: deep at depth_limit.fsh:3:10
// stderr: ... 137 more frames

// case: route_handler
function parsePage(text: string): i64 {
  const page = parseInt(text) ?? 1;
  return 100 / page;
}

async function main(): Promise<void> throws IoError {
  let app = new Router();
  app.get("/items/:page", async (req) => new Response("page " + parsePage(req.param("page"))));
  const found = shared({ port: new Atomic(0) });
  const seen = found.clone();
  spawn(serve({ port: 0, hostname: "127.0.0.1", onListen: (info) => { seen.port.store(info.port); } }, app.handler()));
  while (found.port.load() === 0) await sleep(1);
  const conn = await TcpStream.connect("127.0.0.1", found.port.load());
  await conn.write(new TextEncoder().encode("GET /items/0 HTTP/1.1\r\nHost: h\r\n\r\n"));
  const got = await conn.read(4096);
  console.log(got.length);
}
// The handler's panic ends only its task: the client gets a bare 500, and the program goes on.
// expect: 153
// stderr: panicked at route_handler.fsh:3:10:
// stderr: attempt to divide by zero
// stderr: stack backtrace:
// stderr:    0: parsePage at route_handler.fsh:3:10
// stderr:    1: <arrow 8:27> at route_handler.fsh:8:65
// stderr: spawned at route_handler.fsh:11:3

// case: timer_callback
function tick(n: i64): i64 {
  return 10 / n;
}

async function main() {
  setTimeout(() => {
    console.log(tick(0));
  }, 5);
  await sleep(50);
}
// panic: attempt to divide by zero
// stderr: stack backtrace:
// stderr:    0: tick at timer_callback.fsh:2:10
// stderr:    1: <arrow 6:14> at timer_callback.fsh:7:17
// stderr: spawned at timer_callback.fsh:6:3

// case: timer_named_callback
function tick() {
  console.log(10 / (Date.now() - Date.now()));
}

async function main() {
  setTimeout(tick, 5);
  await sleep(50);
}
// panic: attempt to divide by zero
// stderr: stack backtrace:
// stderr:    0: tick at timer_named_callback.fsh:2:15
// stderr: spawned at timer_named_callback.fsh:6:3

// case: function_as_value
function double(x: i64): i64 {
  return x * 2;
}

function apply(xs: i64[]): i64[] {
  return xs.map(double);
}

function main() {
  console.log(apply([1, 4611686018427387904]));
}
// panic: attempt to multiply with overflow
// stderr: stack backtrace:
// stderr:    0: double at function_as_value.fsh:2:10
// stderr:    1: apply at function_as_value.fsh:6:10
// stderr:    2: main at function_as_value.fsh:10:15

// case: private_methods
class A {
  #f(n: i64): i64 { return 1 / n; }
  a(n: i64): i64 { return this.#f(n); }
}

class B extends A {
  #f(n: i64): i64 { return this.a(n) + 2; }
  b(n: i64): i64 { return this.#f(n); }
  static #check(n: i64): i64 { return new B().b(n); }
  static run(n: i64): i64 { return B.#check(n); }
}

class Box<T> {
  #get(n: i64): i64 { return B.run(n); }
  open(n: i64): i64 { return this.#get(n); }
}

function main() {
  console.log(new Box<i64>().open(0));
}
// panic: attempt to divide by zero
// stderr: stack backtrace:
// stderr:    0: A.#f at private_methods.fsh:2:28
// stderr:    1: A.a at private_methods.fsh:3:27
// stderr:    2: B.#f at private_methods.fsh:7:28
// stderr:    3: B.b at private_methods.fsh:8:27
// stderr:    4: B.static #check at private_methods.fsh:9:39
// stderr:    5: B.static run at private_methods.fsh:10:36
// stderr:    6: Box<i64>.#get at private_methods.fsh:14:30
// stderr:    7: Box<i64>.open at private_methods.fsh:15:30
// stderr:    8: main at private_methods.fsh:19:15
