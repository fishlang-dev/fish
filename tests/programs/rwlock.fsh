// case: rwlock_read_await
// error: 'read' holds its lock while the callback runs, so the callback can't 'await'
async function main() {
  const rw = new RwLock(0);
  rw.read((v) => {
    await yieldNow();
  });
}
// case: rwlock_update_await
// error: 'update' holds its lock while the callback runs, so the callback can't 'await'
async function main() {
  const rw = new RwLock(0);
  rw.update((v) => {
    await yieldNow();
    v += 1;
  });
}
// case: rwlock_read_only
// error: cannot push to 'xs' because 'xs' is a shared reference ('Ref'), which only reads
function main() {
  const rw = new RwLock<i64[]>([]);
  rw.read((xs) => xs.push(1));
}
// case: rwlock_no_method
// error: 'RwLock' has no method 'write'; 'read' runs a callback with a read-only view of what it holds, and 'update' with a mutable one
function main() {
  const rw = new RwLock(0);
  rw.write((v) => 1);
}
// case: rwlock_read_update
// expect: 6 3
// expect: ab 2
// expect: 2 a b
function total(rw: Ref<RwLock<i64[]>>): i64 {
  return rw.read((xs) => {
    let s = 0;
    for (const x of xs) s += x;
    return s;
  });
}
function size<T>(rw: Ref<RwLock<T[]>>): i64 {
  return rw.read((xs) => xs.length as i64);
}
class Log {
  lines: RwLock<string[]> = new RwLock<string[]>([]);
  write(line: string) {
    this.lines.update((ls) => ls.push(line));
  }
}
function main() {
  const rw = new RwLock<i64[]>([1, 2]);
  rw.update((xs) => xs.push(3));
  console.log(total(rw), size(rw));
  const name = new RwLock("a" + "");
  name.update((s) => {
    s += "b";
  });
  console.log(name.read((s) => s.slice(0, 2)), name.read((s) => s.length));
  const log = new Log();
  log.write("a" + "");
  log.write("b");
  const lines = log.lines.read((ls) => ls.clone());
  console.log(lines.length, lines[0], lines[1]);
}
// case: rwlock_nested_reads
// expect: 4
function main() {
  const rw = new RwLock(2);
  console.log(rw.read((a) => rw.read((b) => a + b)));
}
// case: rwlock_top_level_const
// expect: 1 2
const config = new RwLock<string[]>(["a"]);
function main() {
  console.log(config.read((xs) => xs.length), config.update((xs) => {
    xs.push("b");
    return xs.length;
  }));
}
// case: rwlock_update_in_read
// panic: this lock is already held by a `read` or an `update` running here
function main() {
  const rw = new RwLock(0);
  rw.read((v) => rw.update((w) => { w += 1; }));
}
// case: rwlock_read_in_update
// panic: this lock is already held by a `read` or an `update` running here
function main() {
  const rw = new RwLock(0);
  rw.update((v) => rw.read((w) => w + 1));
}
// case: rwlock_readers_together
// expect: true 40000
async function reader(s: shared<{ rw: RwLock<i64>; inside: Atomic<i64> }>): Promise<boolean> {
  await yieldNow();
  return s.rw.read((v) => {
    s.inside.add(1);
    for (let i = 0; i < 2000000000 && s.inside.load() < 2; i++) {}
    return s.inside.load() >= 2;
  });
}
async function writer(s: shared<{ rw: RwLock<i64>; inside: Atomic<i64> }>): Promise<void> {
  for (let i = 0; i < 100; i++) {
    s.rw.update((v) => { v += 1; });
    if (i % 25 === 0) await yieldNow();
  }
}
async function main() {
  const s = shared({ rw: new RwLock(0), inside: new Atomic(0) });
  const a = spawn(reader(s.clone()));
  const b = spawn(reader(s.clone()));
  const first = await a;
  const second = await b;
  let handles: JoinHandle<void>[] = [];
  for (let n = 0; n < 400; n++) handles.push(spawn(writer(s.clone())));
  for (let n = 0; n < 400; n++) {
    const h = handles.pop()!;
    await h;
  }
  console.log(first && second, s.rw.read((v) => v + 0));
}
// case: rwlock_poisoned
// expect: writer index out of bounds: the len is 1 but the index is 3
// panic: a task panicked while holding this lock, so the value it guards may be half changed
async function poison(s: shared<{ rw: RwLock<i64> }>): Promise<void> {
  await yieldNow();
  s.rw.update((v) => { const xs = [1]; v = xs[3]; });
}
async function main() {
  const s = shared({ rw: new RwLock(0) });
  try {
    await spawn(poison(s.clone())).join();
  } catch (e) {
    console.log("writer", e.message);
  }
  console.log(s.rw.read((v) => v + 0));
}
// case: rwlock_reader_panic_releases
// expect: reader index out of bounds: the len is 1 but the index is 3
// expect: 1
async function fail(s: shared<{ rw: RwLock<i64> }>): Promise<void> {
  await yieldNow();
  s.rw.read((v) => { const xs = [1]; return xs[3]; });
}
async function main() {
  const s = shared({ rw: new RwLock(0) });
  try {
    await spawn(fail(s.clone())).join();
  } catch (e) {
    console.log("reader", e.message);
  }
  s.rw.update((v) => { v += 1; });
  console.log(s.rw.read((v) => v + 0));
}
// case: rwlock_writer_among_readers
// expect: 100 0 true
type Pair = { a: i64; b: i64 };
type S = { rw: RwLock<Pair>; done: Atomic<boolean>; reads: Atomic<i64>; torn: Atomic<i64> };
async function reader(s: shared<S>): Promise<void> {
  await yieldNow();
  // Bounded, so a writer starved by overlapping reads shows as a wrong line, not a hang.
  while (!s.done.load() && s.reads.load() < 2000000) {
    const same = s.rw.read((p) => {
      let k = 0;
      for (let i = 0; i < 200; i++) k = k + 1;
      return p.a === p.b;
    });
    if (!same) s.torn.add(1);
    s.reads.add(1);
  }
}
async function writer(s: shared<S>): Promise<void> {
  while (s.reads.load() < 1000) await yieldNow();
  for (let n = 0; n < 50; n++) {
    s.rw.update((p) => {
      p.a += 1;
      for (let i = 0; i < 1000; i++) {}
      p.b += 1;
    });
  }
  s.done.store(true);
}
async function main() {
  const s = shared({ rw: new RwLock<Pair>({ a: 0, b: 0 }), done: new Atomic(false), reads: new Atomic(0), torn: new Atomic(0) });
  let hs: JoinHandle<void>[] = [];
  for (let n = 0; n < 3; n++) hs.push(spawn(reader(s.clone())));
  const w = spawn(writer(s.clone()));
  await w;
  for (let n = 0; n < 3; n++) {
    const h = hs.pop()!;
    await h;
  }
  console.log(s.rw.read((p) => p.a + p.b), s.torn.load(), s.reads.load() < 2000000);
}
