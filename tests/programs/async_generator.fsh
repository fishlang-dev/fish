// case: async_generator_next
async function* ticks(n: i64): AsyncGenerator<i64> {
  console.log("started");
  for (let i = 0; i < n; i++) {
    await sleep(2);
    yield i * 10;
  }
}

async function main() {
  let g = ticks(2);
  console.log("made");
  const a = await g.next();
  if (a.done === false) console.log("got", a.value);
  const b = await g.next();
  if (b.done === false) console.log("got", b.value);
  const c = await g.next();
  const d = await g.next();
  console.log(c.done, d.done);
}
// expect: made
// expect: started
// expect: got 0
// expect: got 10
// expect: true true
// case: async_generator_lazy
async function* loud(): AsyncGenerator<string> {
  console.log("body runs");
  yield "x";
}

async function main() {
  let g = loud();
  await sleep(2);
  console.log("not yet");
  const r = await g.next();
  if (r.done === false) console.log(r.value);
  let unused = loud();
}
// expect: not yet
// expect: body runs
// expect: x
// case: async_generator_method
class Feed {
  items: string[];
  constructor(items: string[]) { this.items = items; }
  async *each(): AsyncGenerator<string> {
    for (const s of this.items) {
      await sleep(1);
      yield s + "?";
    }
  }
}

async function main() {
  const f = new Feed(["a" + 1, "b"]);
  let g = f.each();
  const r = await g.next();
  if (r.done === false) console.log(r.value);
  const q = await g.next();
  if (q.done === false) console.log(q.value);
  const z = await g.next();
  console.log(z.done);
}
// expect: a1?
// expect: b?
// expect: true
// case: async_generator_method_borrows
// error: cannot move 'f' while 'g' borrows 'f' and is used later
class Feed {
  items: string[];
  constructor(items: string[]) { this.items = items; }
  async *each(): AsyncGenerator<string> {
    for (const s of this.items) yield s;
  }
}

async function main() {
  const f = new Feed(["a"]);
  let g = f.each();
  const moved = f;
  const r = await g.next();
}
// case: async_generator_generic
async function* repeat<T>(x: T, n: i64): AsyncGenerator<T> {
  for (let i = 0; i < n; i++) {
    await yieldNow();
    yield x.clone();
  }
}

async function main() {
  let a = repeat("hi" + 1, 2);
  const x = await a.next();
  if (x.done === false) console.log(x.value);
  let b = repeat(7, 1);
  const y = await b.next();
  if (y.done === false) console.log(y.value);
}
// expect: hi1
// expect: 7
// case: async_generator_borrow_across_await
async function* lengths(words: Ref<string[]>): AsyncGenerator<i64> {
  for (const w of words) {
    const local = w + "!";
    const r: Ref<string> = local;
    await sleep(1);
    const n = r.length as i64;
    yield n;
  }
}

async function main() {
  const ws = ["ab", "cde"];
  let g = lengths(ws);
  const p = await g.next();
  if (p.done === false) console.log(p.value);
  const q = await g.next();
  if (q.done === false) console.log(q.value);
}
// expect: 3
// expect: 4
// case: async_generator_reference_at_yield
// error: a reference into 'local' is still in use at this 'yield'
async function* one(): AsyncGenerator<i64> {
  const local = "x" + 1;
  const r: Ref<string> = local;
  await sleep(1);
  yield 1;
  console.log(r);
}

async function main() {
  let g = one();
  const a = await g.next();
}
// case: async_generator_spawned
async function* plain(n: i64): AsyncGenerator<i64> {
  await sleep(1);
  yield n;
}

async function drain(g: AsyncGenerator<i64>): Promise<i64> {
  let held = g;
  const r = await held.next();
  if (r.done === false) return r.value;
  return -1;
}

async function main() {
  const v = await spawn(drain(plain(5)));
  console.log(v);
}
// expect: 5
// case: async_generator_spawn_not_send
// error: 'spawn' runs this Promise on another thread, so it must own everything it uses; it holds a 'Cell<i64>'
async function* counted(c: Cell<i64>): AsyncGenerator<i64> {
  await sleep(1);
  yield c.get();
}

async function drain(g: AsyncGenerator<i64>): Promise<i64> {
  let held = g;
  const r = await held.next();
  if (r.done === false) return r.value;
  return -1;
}

async function main() {
  const h = spawn(drain(counted(new Cell(1))));
  const w = await h;
}
// case: async_generator_cancelled
async function* slow(): AsyncGenerator<string> {
  const held = "kept" + 1;
  await sleep(500);
  yield held;
}

async function first(): Promise<string> {
  let g = slow();
  const r = await g.next();
  if (r.done === false) return r.value;
  return "none";
}

async function quick(): Promise<string> {
  await sleep(5);
  return "quick";
}

async function main() {
  const w = await Promise.race([first(), quick()]);
  console.log(w);
}
// expect: quick
// case: async_generator_next_not_awaited
// error: an async generator's 'next()' is awaited where it is called, as in 'await g.next()'
async function* one(): AsyncGenerator<i64> { yield 1; }

async function main() {
  let g = one();
  const p = g.next();
}
// case: async_generator_wrong_return_type
// error: an async generator function's return type is 'AsyncGenerator<T>'
async function* one(): Promise<i64> { yield 1; }

async function main() {}
// case: async_generator_throws
async function* fetchAll(urls: string[]): AsyncGenerator<string> throws string {
  for (const u of urls) {
    await sleep(1);
    if (u === "down") throw "unreachable host: " + u;
    yield "page " + u;
  }
}

class Feed {
  items: string[];
  constructor(items: string[]) { this.items = items; }
  async *each(): AsyncGenerator<string> throws string {
    for (const s of this.items) {
      await sleep(1);
      if (s === "") throw "empty item";
      yield s + "!";
    }
  }
}

async function main() {
  let g = fetchAll(["a", "down", "b"]);
  try {
    const r = await g.next();
    if (r.done === false) console.log(r.value);
    await g.next();
    console.log("unreachable");
  } catch (e) {
    console.log("caught", e);
  }
  try {
    const after = await g.next();
    console.log("after", after.done);
  } catch (e) {
    console.log("not again", e);
  }
  try {
    for await (const p of fetchAll(["x", "down"])) console.log(p);
  } catch (e) {
    console.log("loop caught", e);
  }
  const f = new Feed(["q" + 1, ""]);
  try {
    for await (const s of f.each()) console.log(s);
  } catch (e) {
    console.log("method caught", e);
  }
}
// expect: page a
// expect: caught unreachable host: down
// expect: after true
// expect: page x
// expect: loop caught unreachable host: down
// expect: q1!
// expect: method caught empty item
// case: async_generator_throws_undeclared
async function* one(): AsyncGenerator<i64> throws string { yield 1; }

async function main() {
  let g = one();
  await g.next();
}
// error: 'main' must declare 'throws string' after its return type since this Promise can throw 'string'
// case: async_generator_throws_dyn
async function* one(): AsyncGenerator<i64> throws string { yield 1; }

async function main() {
  let d: Dyn<AsyncGenerator<i64>> = one();
}
// error: type 'AsyncGenerator<i64> throws string' is not assignable to type 'Dyn<AsyncGenerator<i64>>': its 'next' throws 'string', which 'AsyncGenerator<i64>' doesn't
// case: for_await_generator
async function* ticks(n: i64): AsyncGenerator<string> {
  for (let i = 0; i < n; i++) {
    await sleep(1);
    yield "t" + i;
  }
}

async function* doubled(n: i64): AsyncGenerator<i64> {
  for await (const t of ticks(n)) yield t.length as i64 * 2;
}

async function main() {
  for await (const t of ticks(3)) console.log(t);
  let g = ticks(2);
  for await (const t of g) console.log("held", t);
  for await (const d of doubled(2)) console.log(d);
}
// expect: t0
// expect: t1
// expect: t2
// expect: held t0
// expect: held t1
// expect: 4
// expect: 4
// case: for_await_break_return_drop
async function* words(prefix: string): AsyncGenerator<string> {
  // Held across every yield, so a generator dropped early still has it to drop.
  const kept = [prefix, "kept"];
  for (let i = 0; i < 5; i++) {
    await yieldNow();
    yield prefix + i;
  }
  console.log(kept.join("-"));
}

async function find(): Promise<string> {
  for await (const w of words("r")) {
    if (w === "r1") return w;
  }
  return "none";
}

async function main() {
  for await (const w of words("b")) {
    if (w === "b2") break;
    console.log(w);
  }
  const found = await find();
  console.log(found);
  for await (const w of words("all")) {
    if (w === "all1") continue;
    console.log(w);
  }
}
// expect: b0
// expect: b1
// expect: r1
// expect: all0
// expect: all2
// expect: all3
// expect: all4
// expect: all-kept
// case: for_await_borrowed_generator
async function* nums(): AsyncGenerator<i64> {
  yield 1;
  yield 2;
  yield 3;
}

async function upTo(g: Mut<AsyncGenerator<i64>>, last: i64) {
  for await (const x of g) {
    console.log(x);
    if (x === last) break;
  }
}

async function main() {
  let g = nums();
  await upTo(g, 2);
  const r = await g.next();
  if (r.done === false) console.log("left", r.value);
}
// expect: 1
// expect: 2
// expect: left 3
// case: for_await_shared_generator
// error: a 'for await' loop advances its generator, so it needs a 'Mut' reference to it, not a 'Ref'
async function each(g: Ref<AsyncGenerator<i64>>) {
  for await (const x of g) console.log(x);
}

async function main() {}
// case: for_await_channel
async function main() {
  const ch = new Channel<string>(2);
  const tx = ch.clone();
  const h = spawn(async () => {
    for (let i = 0; i < 4; i++) await tx.send("m" + i);
    tx.close();
  });
  for await (const m of ch) console.log(m);
  await h;
  console.log("closed");
}
// expect: m0
// expect: m1
// expect: m2
// expect: m3
// expect: closed
// case: for_await_channel_reference
async function total(ch: Ref<Channel<i64>>): Promise<i64> {
  let sum = 0;
  for await (const v of ch) sum += v;
  return sum;
}

async function main() {
  const ch = new Channel<i64>(4);
  await ch.send(5);
  await ch.send(6);
  ch.close();
  const t = await total(ch);
  console.log(t);
}
// expect: 11
// case: for_await_array
// error: 'for await' loops over an async generator or a Channel, not 'i64[]'
async function main() {
  const xs = [1, 2];
  for await (const x of xs) console.log(x);
}
// case: for_await_outside_async
// error: 'for await' can only be used inside an 'async' function
async function* one(): AsyncGenerator<i64> { yield 1; }

function main() {
  for await (const x of one()) console.log(x);
}
// case: for_of_async_generator
// error: an async generator's values are awaited, so loop over it with 'for await'
async function* one(): AsyncGenerator<i64> { yield 1; }

async function main() {
  for (const x of one()) console.log(x);
}
// case: async_generator_cancelled_sleep_resumes
// The runner bounds every program, so a generator that never wakes fails as a timeout.
async function* slow(): AsyncGenerator<string> {
  const held = "kept" + 1;
  for (let i = 0; i < 3; i++) {
    await sleep(50);
    yield held + i;
  }
}

async function take(g: Mut<AsyncGenerator<string>>): Promise<string> {
  const r = await g.next();
  if (r.done === false) return r.value;
  return "none";
}

async function quick(): Promise<string> {
  await sleep(5);
  return "quick";
}

async function main() {
  let g = slow();
  const w = await Promise.race([take(g), quick()]);
  console.log(w);
  const r = await g.next();
  if (r.done === false) console.log("after", r.value);
  const s = await g.next();
  if (s.done === false) console.log("after", s.value);
}
// expect: quick
// expect: after kept10
// expect: after kept11
// case: async_generator_cancelled_loop_resumes
async function* ticks(): AsyncGenerator<i64> {
  for (let i = 0; i < 3; i++) {
    await yieldNow();
    await sleep(30);
    yield i;
  }
}

async function take(g: Mut<AsyncGenerator<i64>>): Promise<i64> {
  for await (const x of g) return x;
  return -1;
}

async function soon(): Promise<i64> {
  await sleep(5);
  return 99;
}

async function main() {
  let g = ticks();
  const w = await Promise.race([take(g), soon()]);
  console.log(w);
  const v = await take(g);
  console.log(v);
}
// expect: 99
// expect: 0
// case: async_generator_cancelled_inner_resumes
async function nap(ms: i64): Promise<string> {
  const note = "slept" + ms;
  await sleep(ms);
  return note;
}

async function* naps(): AsyncGenerator<string> {
  for (let i = 0; i < 2; i++) {
    const n = await nap(40);
    yield n + "-" + i;
  }
}

async function take(g: Mut<AsyncGenerator<string>>): Promise<string> {
  const r = await g.next();
  if (r.done === false) return r.value;
  return "none";
}

async function quick(): Promise<string> {
  await sleep(5);
  return "quick";
}

async function main() {
  let g = naps();
  const w = await Promise.race([take(g), quick()]);
  console.log(w);
  const r = await g.next();
  if (r.done === false) console.log("after", r.value);
  for await (const v of g) console.log("rest", v);
}
// expect: quick
// expect: after slept40-0
// expect: rest slept40-1
// case: async_generator_dyn
async function* letters(): AsyncGenerator<string> {
  const held = "a" + 1;
  yield held;
  await sleep(1);
  yield "b" + 2;
}

async function* counted(n: i64): AsyncGenerator<string> {
  for (let i = 0; i < n; i++) {
    await sleep(1);
    yield "n" + i;
  }
}

class Feed {
  name: string;
  source: Dyn<AsyncGenerator<string>>;
  later: Dyn<AsyncGenerator<string>> | null = null;
  constructor(name: string, source: Dyn<AsyncGenerator<string>>) {
    this.name = name;
    this.source = source;
  }
}

async function main() {
  let d: Dyn<AsyncGenerator<string>> = letters();
  const r = await d.next();
  if (r.done === false) console.log("next", r.value);
  for await (const x of d) console.log("loop", x);
  let f = new Feed("f", counted(3));
  const boxed: Dyn<AsyncGenerator<string>> = letters();
  f.later = boxed;
  const q = await f.source.next();
  if (q.done === false) console.log("field", q.value);
  for await (const x of f.source) console.log("field loop", x);
  const later = f.later;
  if (later !== null) {
    let l = later;
    for await (const x of l) console.log("option", x);
  }
}
// expect: next a1
// expect: loop b2
// expect: field n0
// expect: field loop n1
// expect: field loop n2
// expect: option a1
// expect: option b2
// case: async_generator_dyn_dropped
// A box dropped mid-stream drops its generator where it is paused, with what it holds.
async function* endless(count: shared<{ n: Atomic<i64> }>): AsyncGenerator<string> {
  const held = "kept" + 1;
  while (true) {
    count.n.add(1);
    await sleep(1);
    yield held + count.n.load();
  }
}

async function firstTwo(d: Dyn<AsyncGenerator<string>>): Promise<void> {
  let g = d;
  let seen = 0;
  for await (const x of g) {
    console.log(x);
    seen++;
    if (seen === 2) break;
  }
}

async function main() {
  const count = shared({ n: new Atomic(0) });
  await firstTwo(endless(count.clone()));
  let d: Dyn<AsyncGenerator<string>> = endless(count.clone());
  const r = await d.next();
  if (r.done === false) console.log(r.value);
  d = endless(count.clone());
  console.log(count.n.load());
}
// expect: kept11
// expect: kept12
// expect: kept13
// expect: 3
// case: async_generator_dyn_not_send
// error: a 'Dyn<AsyncGenerator<i64>>' may cross to another thread, so it can't hold a 'Cell<i64>'
async function* local(c: Cell<i64>): AsyncGenerator<i64> {
  await sleep(1);
  yield c.get();
}

async function main() {
  const d: Dyn<AsyncGenerator<i64>> = local(new Cell(1));
}
// case: dyn_promise_refused
// error: 'Dyn' takes the interface its values implement
async function one(): Promise<i64> { return 1; }
async function main() {
  const d: Dyn<Promise<i64>> = one();
}
