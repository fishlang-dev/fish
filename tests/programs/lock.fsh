// case: lock_await
// error: 'update' holds its lock while the callback runs, so the callback can't 'await'
async function main() {
  const n = new Lock(0);
  n.update((v) => {
    await yieldNow();
    v += 1;
  });
}
// case: lock_callback_by_name
// error: callbacks passed to 'update' by name
function main() {
  const n = new Lock(0);
  const bump = (v: Mut<i64>) => {
    v += 1;
  };
  n.update(bump);
}
// case: lock_callback_moves_capture
// expect: 2
class Box2<T> {
  v: Lock<T[]>;
  constructor(v: T) { this.v = new Lock([v]); }
  put(this: Ref<this>, x: T) { this.v.update((xs) => xs.push(x)); }
}
function main() {
  const c = new Box2("a" + "");
  c.put("z" + "");
  console.log(c.v.update((s) => s.length));
}
// case: lock_in_class
// expect: 2 a b
class Log {
  lines: Lock<string[]> = new Lock<string[]>([]);
  count: Atomic<i64> = new Atomic(0);

  write(line: string) {
    this.count.add(1);
    this.lines.update((ls) => ls.push(line));
  }
}

function main() {
  const log = new Log();
  log.write("a" + "");
  log.write("b");
  const lines = log.lines.update((ls) => ls.clone());
  console.log(log.count.load(), lines[0], lines[1]);
}
// case: lock_reentrant_deep
// panic: this lock is already held by an `update` running here
function main() {
  const l0 = new Lock(0);
  const l1 = new Lock(0);
  const l2 = new Lock(0);
  const l3 = new Lock(0);
  const l4 = new Lock(0);
  const l5 = new Lock(0);
  const l6 = new Lock(0);
  const l7 = new Lock(0);
  const l8 = new Lock(0);
  const l9 = new Lock(0);
  const l10 = new Lock(0);
  const l11 = new Lock(0);
  const l12 = new Lock(0);
  const l13 = new Lock(0);
  const l14 = new Lock(0);
  const l15 = new Lock(0);
  const l16 = new Lock(0);
  const r = l0.update((v0) => l1.update((v1) => l2.update((v2) => l3.update((v3) => l4.update((v4) => l5.update((v5) => l6.update((v6) => l7.update((v7) => l8.update((v8) => l9.update((v9) => l10.update((v10) => l11.update((v11) => l12.update((v12) => l13.update((v13) => l14.update((v14) => l15.update((v15) => l16.update((v16) => l16.update((w) => 1))))))))))))))))));
  console.log(r);
}
// case: lock_returns_reference
// error: closures returning references are not supported yet
function main() {
  const items = new Lock<i64[]>([]);
  const inside = items.update((xs) => xs);
}
// case: lock_update
// expect: 3 6
// expect: ab
// expect: 2
function add(lock: Ref<Lock<i64[]>>, n: i64) {
  lock.update((xs) => xs.push(n));
}

function main() {
  const items = new Lock<i64[]>([]);
  add(items, 1);
  add(items, 2);
  add(items, 3);
  const count = items.update((xs) => xs.length);
  const sum = items.update((xs) => {
    let s = 0;
    for (const x of xs) s += x;
    return s;
  });
  console.log(count, sum);
  const name = new Lock("a" + "");
  name.update((s) => {
    s += "b";
  });
  console.log(name.update((s) => s.slice(0, 2)));
  const extra = "unused" + "";
  const popped = items.update((xs) => xs.pop());
  console.log(popped! - 1);
}
