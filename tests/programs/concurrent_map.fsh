// ConcurrentMap: a map sharded over locks, which many tasks read and write at once.
// case: concurrent_map_basics
// expect: 1 null true 2
// expect: 11 6 200 true 2
// expect: 0 false
function main() {
  const m = new ConcurrentMap<string, i64>();
  m.set("a", 1);
  m.set("bb", 2);
  console.log(m.get("a"), m.get("zz"), m.has("bb"), m.size);
  m.update("a", (v) => { v += 10; });
  m.upsert("c", 5, (v) => { v += 1; });
  m.upsert("c", 5, (v) => { v += 1; });
  console.log(m.get("a"), m.get("c"), m.with("bb", (v) => v * 100), m.delete("a"), m.size);
  const one = new ConcurrentMap<i64, i64>({ shards: 1 });
  console.log(one.size, one.update(3, (v) => { v += 1; }));
}
// case: concurrent_map_tasks
// expect: 8000 10
// expect: one
const counts = new ConcurrentMap<string, i64>({ shards: 4 });
async function work(): Promise<void> {
  for (let i = 0; i < 1000; i++) {
    counts.upsert(`k${i % 10}`, 1, (v) => { v += 1; });
    await yieldNow();
  }
}
async function main() {
  let tasks: JoinHandle<void>[] = [];
  for (let t = 0; t < 8; t++) tasks.push(spawn(work()));
  while (tasks.length > 0) {
    const t = tasks.pop()!;
    await t;
  }
  let total = 0;
  for (let i = 0; i < 10; i++) total += counts.get(`k${i}`) ?? 0;
  console.log(total, counts.size);
  const names = shared({ m: new ConcurrentMap<i64, string>() });
  const writer = names.clone();
  await spawn(async () => { writer.m.set(1, "one"); });
  console.log(names.m.get(1));
}
// case: concurrent_map_class_values
// expect: ann 1 3 null
// expect: 1000 1000
class User {
  name: string;
  visits: i64 = 0;
  constructor(name: string) { this.name = name; }
  clone(): User {
    let u = new User(this.name);
    u.visits = this.visits;
    return u;
  }
}
function main() {
  const users = new ConcurrentMap<string, User>();
  users.set("ann", new User("ann"));
  users.update("ann", (u) => { u.visits += 1; });
  const ann = users.get("ann")!;
  console.log(ann.name, ann.visits, users.with("ann", (u) => u.name.length), users.with("bob", (u) => u.visits));
  const many = new ConcurrentMap<i64, i64>({ shards: 7 });
  for (let i = 0; i < 1000; i++) many.set(i, i);
  let found = 0;
  for (let i = 0; i < 1000; i++) if (many.has(i)) found++;
  console.log(many.size, found);
}
// case: concurrent_map_no_await_in_callback
// error: 'await' can only be used inside an 'async' function
async function main() {
  const m = new ConcurrentMap<string, i64>();
  m.update("a", (v) => {
    await yieldNow();
    v += 1;
  });
}
