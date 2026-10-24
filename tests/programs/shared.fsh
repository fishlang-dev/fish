// case: shared_counter
// expect: 40000 400 last
type State = { hits: i64; names: string[] };

async function work(state: shared<State>, n: i64): Promise<i64> {
  for (let i = 0; i < 100; i++) {
    state.update((s) => {
      s.hits++;
    });
    if (i % 25 === 0) await yieldNow();
  }
  state.update((s) => s.names.push("task" + n));
  return n;
}

async function main() {
  const state = shared<State>({ hits: 0, names: [] });
  let handles: JoinHandle<i64>[] = [];
  for (let n = 0; n < 400; n++) handles.push(spawn(work(state.clone(), n)));
  for (let n = 0; n < 400; n++) {
    const h = handles.pop()!;
    await h;
  }
  const hits = state.update((s) => s.hits);
  const count = state.update((s) => s.names.length);
  const last = state.update((s) => s.names.length > 0 ? "last" : "none");
  console.log(hits, count, last);
}
// case: shared_fields
// expect: 4000 4000 api 3
// expect: 3 queries
class Pool {
  queries: Atomic<i64> = new Atomic(0);
  log: Lock<string[]> = new Lock<string[]>([]);
}

async function query(pool: Ref<Pool>, sql: string): Promise<i64> {
  await yieldNow();
  pool.log.update((l) => l.push(sql));
  return pool.queries.add(1);
}

type State = { hits: i64; seen: Atomic<i64>; name: string; db: Pool };

async function handle(state: shared<State>, n: i64): Promise<i64> {
  state.update((s) => s.hits++);
  state.seen.add(1);
  if (n < 3) {
    const row = await query(state.db, "select " + n);
  }
  return n;
}

async function main() {
  const state = shared<State>({ hits: 0, seen: new Atomic(0), name: "api", db: new Pool() });
  let handles: JoinHandle<i64>[] = [];
  for (let n = 0; n < 4000; n++) handles.push(spawn(handle(state.clone(), n)));
  for (let n = 0; n < 4000; n++) {
    const h = handles.pop()!;
    await h;
  }
  const hits = state.hits;
  const name = state.name;
  console.log(hits, state.seen.load(), name, state.db.queries.load());
  const logged = state.db.log.update((l) => l.length);
  console.log(logged, "queries");
}
// case: shared_holds_cell
// error: a 'shared' value is used from many threads at once, so it can't hold a 'Cell<i64>', which changes without a lock; use an 'Atomic' or a 'Lock' instead
function main() {
  const s = shared({ count: new Cell(0) });
}
// case: shared_holds_handle
// error: a 'shared' value can't hold a JoinHandle
async function f(): Promise<string> { return "res" + "ult"; }
async function main() {
  const st = shared({ h: spawn(f()), n: 1 });
  const a = st.h;
  const b = st.h;
  const x = await a;
  const y = await b;
  console.log(x, y);
}
// case: shared_holds_reference
// error: so it can't hold a 'Ref<i64>', which borrows from one place, which other threads can't keep alive
type View = { n: Ref<i64> };

function main() {
  const n = 1;
  const v: View = { n: n };
  const s = shared(v);
}
// case: shared_interior_in_update
// error: inside 'update': other tasks borrow 's.seen' without the lock, so it changes only through its own methods
function main() {
  const state = shared({ hits: 0, seen: new Atomic(0) });
  state.update((s) => {
    s.hits++;
    s.seen = new Atomic(5);
  });
}
// case: shared_interior_methods_in_update
// expect: 2 1
function main() {
  const state = shared({ hits: 0, seen: new Atomic(0) });
  state.update((s) => {
    s.hits += 2;
    s.seen.add(1);
  });
  console.log(state.hits, state.seen.load());
}
// case: shared_interior_read
// expect: false d 1
// expect: 3
type S = { n: i64; o: Option<Atomic<i64>>; name: string; db: { q: Atomic<i64>; label: string } };
function main() {
  const st = shared<S>({ n: 1, o: new Atomic(3), name: "x" + "", db: { q: new Atomic(0), label: "d" + "" } });
  console.log(st.o === null, st.db.label, st.db.label.length);
  const a: Option<Atomic<i64>> = new Atomic(1);
  if (a !== null) a.add(2);
  if (a !== null) console.log(a.load());
}
// case: shared_move_out
// error: 'state.seen' can't be moved out of 'state', which every clone of it shares; use it where it is
function main() {
  const state = shared({ seen: new Atomic(0) });
  const seen = state.seen;
}
// case: shared_moved_drop
// expect: 1
// expect: 2
function take(s: shared<{ n: i64 }>): i64 {
  return s.n;
}

async function hold(n: i64): Promise<i64> {
  const s = shared({ k: n });
  await yieldNow();
  return s.k;
}

async function main() {
  const s = shared({ n: 1 });
  console.log(take(s));
  const v = await hold(2);
  console.log(v);
}
// case: shared_push_outside_update
// error: because 'state' is shared between threads; change it inside 'state.update(...)'
function main() {
  const state = shared({ names: ["a"] });
  state.names.push("b");
}
// case: shared_read_while_updated
// expect: 600 true
type Config = { label: string; point: { x: i64; y: i64 } };

async function writer(c: shared<Config>, n: i64): Promise<i64> {
  for (let i = 0; i < 50; i++) {
    c.update((s) => {
      s.label = "label" + n + "-" + i;
      s.point = { x: n, y: n };
    });
    await yieldNow();
  }
  return 0;
}

async function reader(c: shared<Config>): Promise<i64> {
  let good = 0;
  for (let i = 0; i < 50; i++) {
    const label = c.label;
    const point = c.point;
    if (label.startsWith("label") && point.x === point.y) good++;
    await yieldNow();
  }
  return good;
}

async function main() {
  const config = shared<Config>({ label: "label" + "", point: { x: 0, y: 0 } });
  let writers: JoinHandle<i64>[] = [];
  let readers: JoinHandle<i64>[] = [];
  for (let n = 0; n < 12; n++) {
    writers.push(spawn(writer(config.clone(), n)));
    readers.push(spawn(reader(config.clone())));
  }
  let good = 0;
  for (let n = 0; n < 12; n++) {
    const w = writers.pop()!;
    await w;
    const r = readers.pop()!;
    const got = await r;
    good += got;
  }
  const label = config.label;
  console.log(good, label.startsWith("label"));
}
// case: shared_reentrant_read
// panic: this lock is already held by an `update` running here
function main() {
  const state = shared({ n: 1, name: "a" });
  const c = state.clone();
  const got = state.update((s) => c.n + s.n);
  console.log(got);
}
// case: shared_unknown_method
// error: 'shared' has no method 'set'; read its fields, change it with 'update', or share it again with 'clone'
function main() {
  const s = shared(1);
  s.set(2);
}
// case: shared_update_alias
// error: inside a shared value's 'update', use 's' only through its fields
function main() {
  const state = shared({ hits: 0, seen: new Atomic(0) });
  state.update((s) => {
    const r = s;
    r.seen = new Atomic(5);
  });
  console.log(state.seen.load());
}
// case: shared_update_capture
// error: a closure inside a shared value's 'update' can't capture 's'
function main() {
  const state = shared({ hits: 0, seen: new Atomic(0) });
  state.update((s) => {
    const f = () => { s.seen = new Atomic(5); };
    f();
  });
  console.log(state.seen.load());
}
// case: shared_user_function
// expect: x
function shared(comptime strings: TemplateStringsArray, ...values: string[]): string { return strings[0]; }
function main() { console.log(shared`x`); }
// case: shared_write_outside_update
// error: cannot assign to 'state.hits' because 'state' is shared between threads; change it inside 'state.update(...)'
function main() {
  const state = shared({ hits: 0 });
  state.hits = 1;
}
